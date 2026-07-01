/**
 * extension.ts — AI Code Reviewer
 * ─────────────────────────────────────────────────────────────────
 * Entry point only. All logic lives in src/pipeline, src/agents,
 * src/rag, src/git, src/ast, src/ui, src/store, src/core.
 *
 * File structure:
 *   src/
 *     core/       config.ts · cache.ts · parseJSON.ts
 *     git/        gitContext.ts · prContext.ts
 *     ast/        parser.ts · compileCheck.ts
 *     rag/        embeddings.ts · lancedb.ts · templates.ts
 *     agents/     caller.ts · orchestrator.ts · prompts.ts
 *     store/      history.ts
 *     ui/         diagnostics.ts · webview.ts · htmlBuilder.ts
 *     pipeline/   types.ts · analyze.ts
 *     extension.ts  ← you are here
 */

import * as vscode from "vscode";
import {
  analyze,
  embedTemplates,
  registerGlobals,
  clearAll, 
  setStatus,
} from "./pipeline/analyze";
import { registerStatusUpdater, onRateLimitUpdate } from "./agents/caller";
import { installPreCommitHook, ensureGitignore } from "./git/hooks";
import { showOnboardingPanel } from "./ui/onboardingPanel";
import { signIn, signOut, getSession, getRepoToken, tryRestoreSession, onAuthChange } from "./git/githubAuth";
import { fetchUserRepos, getSelectedRepo, setSelectedRepo } from "./git/repoSelector";
import { SidebarProvider } from "./ui/sidebarProvider";
import { initKeyCache } from "./core/config";
import { getActivePanel, setReviewContext } from "./pipeline/analysisStore";
import { getCurrentBranch, getRecentCommits, gitPush, gitCheckoutNewBranch, gitHasUncommittedChanges, gitCommitAll, gitCountAhead, findExistingPR, createGitHubPR, getDefaultBranch } from "./git/pushAndReview";
import { fetchOpenPRs, fetchPRFiles, fetchFileContent } from "./git/prList";
import { generatePRDescription } from "./agents/prDescriptionAgent";
import { parseGitHubRemote } from "./git/postPRComment";
import * as path from "path";
import * as fs   from "fs";

export function activate(context: vscode.ExtensionContext): void {

  // ── Infrastructure ──────────────────────────────────────────────
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("ai-reviewer");

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 100
  );
  statusBarItem.tooltip = "AI Code Reviewer — 9 agents · Groq + Gemini";
  statusBarItem.command = "ai-reviewer.analyze";
  statusBarItem.show();

  // Wire globals so pipeline and caller can update status bar
  registerGlobals(statusBarItem, diagnosticCollection);
  registerStatusUpdater((text, spin) => setStatus(text, spin));

  // Install pre-commit quality gate hook in the workspace git repo
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsRoot) { installPreCommitHook(wsRoot); ensureGitignore(wsRoot); }

  // ── Sidebar ─────────────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebarProvider)
  );

  // ── Push rate-limit updates to sidebar in real time ────────────
  onRateLimitUpdate(entries => sidebarProvider.pushRateLimits(entries));

  // ── Sync auth state across sidebar + main panel ─────────────────
  onAuthChange(session => { 
    sidebarProvider.refresh();
    sidebarProvider.refreshPRList().catch(console.error);
    const panel = getActivePanel();
    if (panel) {
      panel.webview.postMessage(
        session
          ? { type: "githubConnected", login: session.user.login }
          : { type: "githubDisconnected" }
      );
    }
  });

  // ── Commands ────────────────────────────────────────────────────

  const cmdAnalyze = vscode.commands.registerCommand("ai-reviewer.analyze", () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc) { analyze(doc, context).catch(console.error); }
    else { vscode.window.showWarningMessage("Open a TypeScript/JavaScript file first."); }
  });

  const cmdClear = vscode.commands.registerCommand("ai-reviewer.clearHistory", async () => {
    await clearAll();
  });

  const cmdShowWelcome = vscode.commands.registerCommand("ai-reviewer.showWelcome", () => {
    showOnboardingPanel(context, true).catch(console.error);
  });

  const cmdGithubSignIn = vscode.commands.registerCommand("ai-reviewer.githubSignIn", async () => {
    if (getSession()) {
      vscode.window.showInformationMessage(`AI Reviewer: Already signed in as @${getSession()!.user.login}`);
      return;
    }
    const session = await signIn();
    if (session) {
      context.globalState.update("githubExplicitlyConnected", true);
      vscode.window.showInformationMessage(`AI Reviewer: Signed in as @${session.user.login} ✓`);
    } else {
      vscode.window.showWarningMessage("AI Reviewer: GitHub sign-in failed.");
    }
  });

  const cmdGithubSignOut = vscode.commands.registerCommand("ai-reviewer.githubSignOut", async () => {
    if (!getSession()) {
      vscode.window.showInformationMessage("AI Reviewer: Not signed in to GitHub.");
      return;
    }
    const login = getSession()!.user.login;
    signOut();
    setSelectedRepo(null);
    context.globalState.update("githubExplicitlyConnected", false);
    context.globalState.update(`selectedRepo_${login}`, undefined);
    context.workspaceState.update("onboardingSkipped", false);
    vscode.window.showInformationMessage(`AI Reviewer: Signed out of @${login}.`);
  });

  // ── Push & Review ───────────────────────────────────────────────
  const cmdPushAndReview = vscode.commands.registerCommand("ai-reviewer.pushAndReview", async () => {
    const session = getSession();
    if (!session) { vscode.window.showWarningMessage("AI Reviewer: Connect GitHub first."); return; }

    const selected = getSelectedRepo();
    if (!selected) { vscode.window.showWarningMessage("AI Reviewer: Select a repository first."); return; }

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { vscode.window.showWarningMessage("AI Reviewer: No workspace open."); return; }

    const { getExportData } = await import("./pipeline/analysisStore");
    const data = getExportData();

    // Score gate — warn / block before push
    if (data?.results.length) {
      const scores  = data.results.map(r => r.analysis.overallScore).filter(s => s > 0);
      const avg     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      const hasCrit = data.results.some(r =>
        (r.analysis.security?.vulnerabilities as any[] ?? []).some((v: any) => v.severity === "critical")
      );

      if (hasCrit) {
        vscode.window.showErrorMessage(`AI Reviewer: Push blocked — critical security vulnerability detected (score ${avg}/10). Fix it before pushing.`);
        return;
      }
      if (avg < 4) {
        vscode.window.showErrorMessage(`AI Reviewer: Push blocked — score ${avg}/10 is too low. Minimum is 4/10.`);
        return;
      }
      if (avg < 7) {
        const choice = await vscode.window.showWarningMessage(
          `AI Reviewer: Score ${avg}/10 — quality issues found. Push anyway?`,
          "Push anyway", "Cancel"
        );
        if (choice !== "Push anyway") { return; }
      }
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "AI Reviewer", cancellable: false },
      async progress => {
        progress.report({ message: "Checking branch…" });
        let branch = await getCurrentBranch(wsRoot).catch(() => "");
        if (!branch) { vscode.window.showErrorMessage("AI Reviewer: Could not determine current branch."); return; }

        // Auto-create a feature branch if on main/master
        const isDefaultBranch = branch === "main" || branch === "master";
        if (isDefaultBranch) {
          const stamp = new Date().toISOString().slice(0, 10);
          const suggested = `review/${stamp}`;
          const newBranch = await vscode.window.showInputBox({
            prompt:  "You're on the default branch — enter a feature branch name",
            value:   suggested,
            ignoreFocusOut: true,
          });
          if (!newBranch) { return; }
          const checkout = await gitCheckoutNewBranch(wsRoot, newBranch);
          if (!checkout.success) {
            vscode.window.showErrorMessage(`AI Reviewer: Could not create branch — ${checkout.error}`);
            return;
          }
          branch = newBranch;
        }

        // If no commits ahead and no uncommitted changes, nothing to push
        const ahead = await gitCountAhead(wsRoot, "main");
        const dirty = await gitHasUncommittedChanges(wsRoot);
        if (ahead === 0 && !dirty) {
          vscode.window.showWarningMessage("AI Reviewer: No changes to push — edit a file first, then click Push & Review.");
          return;
        }

        // Auto-commit any uncommitted changes
        if (dirty) {
          progress.report({ message: "Committing changes…" });
          const commitMsg = await vscode.window.showInputBox({
            prompt:  "Commit message",
            value:   "wip: save before review",
            ignoreFocusOut: true,
          });
          if (!commitMsg) { return; }
          const committed = await gitCommitAll(wsRoot, commitMsg);
          if (!committed.success) {
            vscode.window.showErrorMessage(`AI Reviewer: Commit failed — ${committed.error}`);
            return;
          }
        }

        progress.report({ message: "Pushing branch…" });
        const pushResult = await gitPush(wsRoot, branch);
        if (!pushResult.success) {
          vscode.window.showErrorMessage(`AI Reviewer: Push failed — ${pushResult.error}`);
          return;
        }

        progress.report({ message: "Checking for existing PR…" });
        const token = await getRepoToken() ?? session.token;

        // Prefer workspace git remote; fall back to sidebar-selected repo
        const remote = data?.git?.remote ?? "";
        const parsed = parseGitHubRemote(remote) ?? (selected ? { owner: selected.owner, repo: selected.repo } : null);
        if (!parsed) {
          vscode.window.showErrorMessage("AI Reviewer: No GitHub remote found. Is this a GitHub repository?");
          return;
        }
        const { owner, repo } = parsed;

        const existing = await findExistingPR(token, owner, repo, branch);
        if (existing) {
          vscode.window.showInformationMessage(`AI Reviewer: Branch pushed. PR #${existing.number} already exists.`);
          vscode.env.openExternal(vscode.Uri.parse(existing.url));
          return;
        }

        progress.report({ message: "Generating PR description…" });
        const commits = await getRecentCommits(wsRoot);
        const scores  = data?.results.map(r => r.analysis.overallScore).filter(s => s > 0) ?? [];
        const avg     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
        const findings: string[] = [];
        data?.results.forEach(r => {
          (r.analysis.security?.vulnerabilities as any[] ?? []).forEach((v: any) => findings.push(v.description));
          (r.analysis.quality?.issues as any[] ?? []).slice(0, 2).forEach((q: any) => findings.push(q.description));
        });

        const { title: genTitle, body: genBody } = await generatePRDescription(commits, avg, findings);

        const title = await vscode.window.showInputBox({
          prompt:  "PR title (edit if needed)",
          value:   genTitle,
          ignoreFocusOut: true,
        });
        if (!title) { return; }

        progress.report({ message: "Creating PR on GitHub…" });
        const base = await getDefaultBranch(token, owner, repo);
        const result = await createGitHubPR(token, owner, repo, title, genBody, branch, base);

        if (!result) {
          vscode.window.showErrorMessage("AI Reviewer: Could not create PR — network error.");
          return;
        }
        if ("error" in result) {
          vscode.window.showErrorMessage(`AI Reviewer: Could not create PR — ${result.error}`);
          return;
        }

        vscode.window.showInformationMessage(`AI Reviewer: PR #${result.number} created ✓`);
        vscode.env.openExternal(vscode.Uri.parse(result.url));
      }
    );
  });

  // ── Review a teammate's PR ───────────────────────────────────────
  const cmdReviewPR = vscode.commands.registerCommand("ai-reviewer.reviewPR", async () => {
    const session = getSession();
    if (!session) { vscode.window.showWarningMessage("AI Reviewer: Connect GitHub first."); return; }

    const selected = getSelectedRepo();
    if (!selected) { vscode.window.showWarningMessage("AI Reviewer: Select a repository first."); return; }

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) { vscode.window.showWarningMessage("AI Reviewer: No workspace open."); return; }

    const token = await getRepoToken() ?? session.token;

    // Fetch open PRs
    const prs = await fetchOpenPRs(token, selected.owner, selected.repo, session.user.login);
    if (!prs.length) { vscode.window.showInformationMessage("AI Reviewer: No open PRs in this repo."); return; }

    // Let user pick a PR
    const prPick = await vscode.window.showQuickPick(
      prs.map(p => ({
        label:       `#${p.number} ${p.title}`,
        description: `@${p.author}${p.reviewRequested ? " $(bell) review requested" : ""}`,
        pr:          p,
      })),
      { placeHolder: "Select a PR to review" }
    );
    if (!prPick) { return; }

    const pr = prPick.pr;

    // Fetch changed files in the PR (supported languages only)
    const files = await fetchPRFiles(token, selected.owner, selected.repo, pr.number);
    if (!files.length) { vscode.window.showWarningMessage("AI Reviewer: No reviewable files in this PR."); return; }

    // Pick a file if multiple
    let chosenFile = files[0];
    if (files.length > 1) {
      const filePick = await vscode.window.showQuickPick(
        files.map(f => ({ label: f.filename, description: f.language, file: f })),
        { placeHolder: "Select file to review" }
      );
      if (!filePick) { return; }
      chosenFile = filePick.file;
    }

    // Fetch file content from GitHub
    const content = await fetchFileContent(token, selected.owner, selected.repo, chosenFile.filename, pr.headSha);
    if (!content) { vscode.window.showErrorMessage("AI Reviewer: Could not fetch file content from GitHub."); return; }

    // Write to temp file in .ai-reviewer/review/
    const reviewDir = path.join(wsRoot, ".ai-reviewer", "review");
    fs.mkdirSync(reviewDir, { recursive: true });
    const tempName = `pr-${pr.number}-${path.basename(chosenFile.filename)}`;
    const tempPath = path.join(reviewDir, tempName);
    fs.writeFileSync(tempPath, content, "utf-8");

    // Store PR context so "Post to PR" knows where to post
    setReviewContext({
      prNumber: pr.number,
      owner:    selected.owner,
      repo:     selected.repo,
      headSha:  pr.headSha,
      filePath: chosenFile.filename,
    });

    // Open in editor and trigger analysis
    const uri = vscode.Uri.file(tempPath);
    const doc  = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    analyze(doc, context).catch(console.error);
  });

  const cmdSelectRepo = vscode.commands.registerCommand("ai-reviewer.selectRepo", async () => {
    const session = getSession();
    if (!session) {
      vscode.window.showWarningMessage("AI Reviewer: Connect GitHub first.");
      return;
    }
    const repos = await fetchUserRepos(session.token);
    if (!repos.length) {
      vscode.window.showWarningMessage("AI Reviewer: No repositories found for this account.");
      return;
    }
    const current = getSelectedRepo();
    const items = repos.map(r => ({
      label:       r.fullName,
      description: r.fullName === current?.fullName ? "$(check) current" : "",
      repo:        r,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a repository for PR context",
      matchOnDescription: false,
    });
    if (!picked) { return; }
    setSelectedRepo(picked.repo);
    context.globalState.update(`selectedRepo_${session.user.login}`, picked.repo);
    sidebarProvider.refresh();
    sidebarProvider.refreshPRList().catch(console.error);
    const activePanel = getActivePanel();
    if (activePanel) {
      activePanel.webview.postMessage({ type: "repoChanged", fullName: picked.repo.fullName });
    }
    vscode.window.showInformationMessage(`AI Reviewer: Repo set to ${picked.repo.fullName} ✓`);
  });

  // ── Quiet-save guard — set by the quietSave command so the next
  //    onDidSaveTextDocument fires without triggering a review ────────
  let suppressNextSave = false;

  const cmdQuietSave = vscode.commands.registerCommand("ai-reviewer.quietSave", async () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) { return; }
    suppressNextSave = true;
    await doc.save();                      // triggers onSave below — flag catches it
    setStatus("Saved (no review)", false);
  });

  // ── Listeners ───────────────────────────────────────────────────

  const onSave = vscode.workspace.onDidSaveTextDocument(doc => {
    if (suppressNextSave) { suppressNextSave = false; return; }
    analyze(doc, context).catch(console.error);
  });

  const onClose = vscode.workspace.onDidCloseTextDocument(doc => {
    diagnosticCollection.delete(doc.uri);
  });

  // ── Register all subscriptions ──────────────────────────────────
  context.subscriptions.push(
    diagnosticCollection,
    statusBarItem,
    cmdAnalyze,
    cmdClear,
    cmdQuietSave,
    cmdShowWelcome,
    cmdGithubSignIn,
    cmdGithubSignOut,
    cmdSelectRepo,
    cmdPushAndReview,
    cmdReviewPR,
    onSave,
    onClose,
  );

  // ── Warm up template embeddings on startup ──────────────────────
  setStatus("Ready");
  embedTemplates().catch(console.error);
  initKeyCache(context.secrets).catch(console.error);

  // ── Restore GitHub session only if user previously opted in ────────
  const explicitlyConnected = context.globalState.get<boolean>("githubExplicitlyConnected");
  if (explicitlyConnected) {
    tryRestoreSession().then(session => {
      if (session) {
        const saved = context.globalState.get<{ owner: string; repo: string; fullName: string }>(
          `selectedRepo_${session.user.login}`
        );
        if (saved) { setSelectedRepo(saved); }
        sidebarProvider.refresh();
      }
      showOnboardingPanel(context).catch(console.error);
    }).catch(console.error);
  } else {
    showOnboardingPanel(context).catch(console.error);
  }
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically.
  // No manual cleanup needed.
}