import * as vscode from "vscode";
import * as ts     from "typescript";
import { parseSourceFile }       from "../ast/parser";
import { callAgent }             from "../agents/caller";
import { generateCommitMessage } from "../agents/commitMessage";
import { getExportData }         from "../pipeline/analysisStore";
import { buildMarkdown }         from "./markdownBuilder";
import { signIn, signOut, getSession, getRepoToken } from "../git/githubAuth";
import { detectOpenPR, postPRComment } from "../git/postPRComment";

const CHAT_SYSTEM = `You are a code review assistant. The developer has received an AI review of their code and is asking a follow-up question.

RULES:
- Answer the specific question asked — do not re-run the full review.
- Reference the actual issues from the review context when relevant.
- Be direct and concrete: name the exact fix, line, or pattern.
- Keep answers to 2-4 sentences. No markdown fences. No bullet lists unless the question explicitly asks for a list.
- If the question is unrelated to the code or review, answer briefly and steer back to the code.`;

export function setupWebviewMessages(panel: vscode.WebviewPanel): void {
  panel.webview.onDidReceiveMessage(async msg => {

    // ── Apply auto-fix ───────────────────────────────────────────
    if (msg.type === "applyFix") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const lang = editor.document.languageId;
      const isTs = lang === "typescript" || lang === "javascript"
                || lang === "typescriptreact" || lang === "javascriptreact";

      // Non-TS/JS languages: use the line range sent by the webview directly
      if (!isTs && msg.startLine > 0 && msg.endLine > 0) {
        const s = msg.startLine - 1;  // fnInfo lines are 1-indexed
        const e = msg.endLine   - 1;
        const range = new vscode.Range(
          new vscode.Position(s, 0),
          new vscode.Position(e, editor.document.lineAt(e).text.length)
        );
        await editor.edit(eb => eb.replace(range, msg.refactoredCode));
        vscode.window.showInformationMessage(`AI Reviewer: Applied fix to ${msg.fnName}`);
        return;
      }

      // TypeScript / JavaScript: use AST to locate the exact node
      const source = parseSourceFile(editor.document.fileName);
      let foundStart = -1, foundEnd = -1;

      function visitFix(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === msg.fnName) {
          foundStart = source.getLineAndCharacterOfPosition(node.getStart()).line;
          foundEnd   = source.getLineAndCharacterOfPosition(node.getEnd()).line;
        }
        if (ts.isVariableStatement(node)) {
          const decl = node.declarationList.declarations[0];
          if (decl && ts.isIdentifier(decl.name) && decl.name.text === msg.fnName) {
            foundStart = source.getLineAndCharacterOfPosition(node.getStart()).line;
            foundEnd   = source.getLineAndCharacterOfPosition(node.getEnd()).line;
          }
        }
        ts.forEachChild(node, visitFix);
      }
      visitFix(source);

      if (foundStart >= 0) {
        const range = new vscode.Range(
          new vscode.Position(foundStart, 0),
          new vscode.Position(foundEnd, editor.document.lineAt(foundEnd).text.length)
        );
        await editor.edit(eb => eb.replace(range, msg.refactoredCode));
        vscode.window.showInformationMessage(`AI Reviewer: Applied fix to ${msg.fnName}`);
      } else {
        // AST lookup failed — fall back to line range if provided
        if (msg.startLine > 0 && msg.endLine > 0) {
          const s = msg.startLine - 1;
          const e = msg.endLine   - 1;
          const range = new vscode.Range(
            new vscode.Position(s, 0),
            new vscode.Position(e, editor.document.lineAt(e).text.length)
          );
          await editor.edit(eb => eb.replace(range, msg.refactoredCode));
          vscode.window.showInformationMessage(`AI Reviewer: Applied fix to ${msg.fnName}`);
        } else {
          vscode.window.showWarningMessage(`AI Reviewer: Could not locate ${msg.fnName}`);
        }
      }
    }

    // ── Generate commit message ──────────────────────────────────
    if (msg.type === "generateCommitMessage") {
      try {
        const message = await generateCommitMessage({ file: msg.file, functions: msg.functions });
        panel.webview.postMessage({ type: "commitMessageResult", message });
      } catch (e: any) {
        panel.webview.postMessage({ type: "commitMessageResult", message: `Error: ${e.message}` });
      }
    }

    // ── GitHub Login ─────────────────────────────────────────────
    if (msg.type === "githubLogin") {
      let session = null;
      try { session = await signIn(); } catch { /* fall through */ }
      if (!session) {
        vscode.window.showWarningMessage("AI Reviewer: GitHub sign-in failed.");
        panel.webview.postMessage({ type: "githubLoginFailed" });
        return;
      }
      panel.webview.postMessage({
        type:      "githubConnected",
        login:     session.user.login,
        avatarUrl: session.user.avatarUrl,
      });
      vscode.window.showInformationMessage(`AI Reviewer: Signed in as @${session.user.login}`);
      return;
    }

    // ── GitHub Logout ─────────────────────────────────────────────
    if (msg.type === "githubLogout") {
      signOut();
      panel.webview.postMessage({ type: "githubDisconnected" });
      return;
    }

    // ── Post Review to PR ─────────────────────────────────────────
    if (msg.type === "postToPR") {
      const data = getExportData();
      if (!data) { vscode.window.showWarningMessage("AI Reviewer: No analysis to post."); return; }

      if (!getSession()) { vscode.window.showWarningMessage("AI Reviewer: Sign in to GitHub first."); return; }

      const repoToken = await getRepoToken();
      if (!repoToken) { vscode.window.showWarningMessage("AI Reviewer: Could not get GitHub repo access."); return; }

      const pr = await detectOpenPR(repoToken, data.git?.remote ?? "", data.git?.branch ?? "");
      if (!pr) { vscode.window.showWarningMessage("AI Reviewer: No open PR found for this branch."); return; }

      const md  = buildMarkdown(data);
      const ok  = await postPRComment(repoToken, pr, md);
      if (ok) {
        vscode.window.showInformationMessage(`AI Reviewer: Review posted to PR #${pr.number} ✓`);
        panel.webview.postMessage({ type: "prPosted", prNumber: pr.number });
      } else {
        vscode.window.showErrorMessage("AI Reviewer: Failed to post review to GitHub.");
      }
      return;
    }

    // ── Export Markdown ──────────────────────────────────────────
    if (msg.type === "exportMarkdown") {
      const data = getExportData();
      if (!data) {
        vscode.window.showWarningMessage("AI Reviewer: No analysis data to export.");
        return;
      }
      const md  = buildMarkdown(data);
      const doc = await vscode.workspace.openTextDocument({ content: md, language: "markdown" });
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: true });
      return;
    }

    // ── Chat ─────────────────────────────────────────────────────
    if (msg.type === "chat") {
      try {
        const reviewBlock = msg.reviewContext
          ? `\n\n<review_context>\n${msg.reviewContext}\n</review_context>`
          : "";
        const chatUser = `<code>\n${msg.fnCode}\n</code>${reviewBlock}\n\nDeveloper question: ${msg.question}`;
        const response = await callAgent(CHAT_SYSTEM, chatUser, "security");

        panel.webview.postMessage({
          type:       "chatResponse",
          chatBoxId:  msg.chatBoxId,
          thinkingId: msg.thinkingId,
          response,
        });
      } catch (e: any) {
        panel.webview.postMessage({
          type:       "chatResponse",
          chatBoxId:  msg.chatBoxId,
          thinkingId: msg.thinkingId,
          response:   `Error: ${e.message}`,
        });
      }
    }
  });
}
