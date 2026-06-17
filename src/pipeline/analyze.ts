import * as vscode from "vscode";
import * as crypto  from "crypto";
import * as path    from "path";

//import { SUPPORTED_LANGUAGES, MAX_FUNCTIONS, GROQ_AGENTS } from "../core/config";
import { getCached, setCache }                              from "../core/cache";
import { extractChangedLines }                               from "../ast/parser";
import { getAdapter }                                        from "../languages/index";
import { getGitContext, getBlameAuthor,
         getFunctionLastModified }                           from "../git/gitContext";
import { loadPRContext }                                    from "../git/prcontext";
import { getEmbedding, cosineSimilarity }                   from "../rag/embeddings";
import { TEMPLATES, templateSearch }                        from "../rag/templates";
import { insertVector, vectorSearch, getVectorCount,
         getAuthorVectors }                                 from "../rag/lancedb";
import { runAgentWaves }                                    from "../agents/orchestrator";
import { resetTokenUsage, getTokenUsage }                   from "../agents/caller";
import { ensureHistory, writeAuditLog,
         writeScore, readScores,
         loadStyleConfig, readPackageJson, clearHistory }   from "../store/history";
import { loadLastAnalysis, saveLastAnalysis,
         buildIssueSignatures, computeDiffReview }          from "../store/diffReview";
import { publishDiagnostics }                               from "../ui/diagnostics";
import { buildHtml, buildStreamSection }                     from "../ui/htmlBuilder";
import { setupWebviewMessages }                             from "../ui/webview";

import type {
  FunctionInfo, DependenciesResult,
  PageResult, VectorRow, TemporalInfo,
} from "./types";

// ── DNA coaching helpers ──────────────────────────────────────────
interface CodePatterns {
  asyncAwait:  boolean; thenChain:   boolean;
  arrowFns:    number;  regularFns:  number;
  constCount:  number;  varCount:    number;
  hasTypes:    boolean; hasTryCatch: boolean;
  templateLit: boolean; stringConcat: boolean;
}

function detectPatterns(code: string): CodePatterns {
  return {
    asyncAwait:   /\bawait\b/.test(code),
    thenChain:    /\.then\s*\(/.test(code),
    arrowFns:     (code.match(/=>\s*[{(]/g) ?? []).length,
    regularFns:   (code.match(/\bfunction\b/g) ?? []).length,
    constCount:   (code.match(/\bconst\b/g) ?? []).length,
    varCount:     (code.match(/\bvar\b/g) ?? []).length,
    hasTypes:     /:\s*(string|number|boolean|void|Promise|Array|Record)\b/.test(code),
    hasTryCatch:  /\btry\s*\{/.test(code),
    templateLit:  /`[^`]*\$\{/.test(code),
    stringConcat: /\+\s*['"]|['"]\s*\+/.test(code),
  };
}

function buildCoachingNotes(currentCode: string, historicalCodes: string[]): string[] {
  if (historicalCodes.length === 0) { return []; }
  const cur  = detectPatterns(currentCode);
  const hist = historicalCodes.map(detectPatterns);
  const n    = hist.length;
  const pct  = (count: number) => Math.round((count / n) * 100);
  const notes: string[] = [];

  const histAsync = hist.filter(p => p.asyncAwait && !p.thenChain).length;
  if (cur.thenChain && !cur.asyncAwait && pct(histAsync) >= 60) {
    notes.push(`${histAsync}/${n} of your functions use async/await — consider converting .then() chains here.`);
  }

  const histConst = hist.filter(p => p.constCount > 0 && p.varCount === 0).length;
  if (cur.varCount > 0 && pct(histConst) >= 70) {
    notes.push(`You consistently use const/let (${histConst}/${n} functions) — this function contains var.`);
  }

  const histTyped = hist.filter(p => p.hasTypes).length;
  if (!cur.hasTypes && pct(histTyped) >= 70) {
    notes.push(`${histTyped}/${n} of your functions use TypeScript type annotations — this one is untyped.`);
  }

  const histArrow = hist.filter(p => p.arrowFns > 0 && p.regularFns === 0).length;
  if (cur.regularFns > 0 && cur.arrowFns === 0 && pct(histArrow) >= 60) {
    notes.push(`You prefer arrow functions (${histArrow}/${n} functions) — this is a regular function declaration.`);
  }

  const histTry = hist.filter(p => p.hasTryCatch).length;
  if (cur.asyncAwait && !cur.hasTryCatch && pct(histTry) >= 50) {
    notes.push(`You wrap async calls in try/catch (${histTry}/${n} functions) — this async function has no error boundary.`);
  }

  const histTpl = hist.filter(p => p.templateLit).length;
  if (cur.stringConcat && !cur.templateLit && pct(histTpl) >= 60) {
    notes.push(`You prefer template literals (${histTpl}/${n} functions) — this function uses string concatenation.`);
  }

  return notes;
}

// ── Globals (managed by activate) ────────────────────────────────
let statusBarItem:        vscode.StatusBarItem;
let diagnosticCollection: vscode.DiagnosticCollection;
let panel:                vscode.WebviewPanel | undefined;
let changedDecoration:    vscode.TextEditorDecorationType | undefined;
let templatesEmbedded   = false;

export function registerGlobals(
  sb:   vscode.StatusBarItem,
  dc:   vscode.DiagnosticCollection,
): void {
  statusBarItem        = sb;
  diagnosticCollection = dc;
}

export function setStatus(text: string, spin = false): void {
  statusBarItem.text = spin
    ? `$(sync~spin) AI Reviewer: ${text}`
    : `$(sparkle) AI Reviewer: ${text}`;
  statusBarItem.show();
}

// ── Template embedding (on activate) ─────────────────────────────
export async function embedTemplates(): Promise<void> {
  if (templatesEmbedded) { return; }
  setStatus("Embedding templates…", true);
  await Promise.all(TEMPLATES.map(async tpl => {
    const embedding = await getEmbedding(tpl.code);
    if (embedding) { tpl.embedding = embedding; }
  }));
  templatesEmbedded = true;
  setStatus("Ready");
}

// ── Editor decoration ─────────────────────────────────────────────
function decorateFunctions(editor: vscode.TextEditor, functions: FunctionInfo[]): void {
  if (!changedDecoration) {
    changedDecoration = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: "#60a5fa",
      overviewRulerLane:  vscode.OverviewRulerLane.Right,
      backgroundColor:    "#60a5fa08",
      borderColor:        "#60a5fa33",
      borderStyle:        "solid",
      borderWidth:        "0 0 0 2px",
    });
  }
  editor.setDecorations(
    changedDecoration,
    functions.map(f => new vscode.Range(f.start - 1, 0, f.end - 1, 999))
  );
}

// ── Panel factory ─────────────────────────────────────────────────
function getOrCreatePanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (panel) { return panel; }

  panel = vscode.window.createWebviewPanel(
    "aiReviewer",
    "AI Code Reviewer",
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  setupWebviewMessages(panel);

  return panel;
}

// ── Main pipeline ─────────────────────────────────────────────────
export async function analyze(
  doc:     vscode.TextDocument,
  context: vscode.ExtensionContext,
): Promise<void> {

  //if (!SUPPORTED_LANGUAGES.has(doc.languageId)) { return; }

  const wf = vscode.workspace.workspaceFolders?.[0];
  if (!wf) { return; }

  const workspace = wf.uri.fsPath;
  const relative  = path.relative(workspace, doc.fileName);
  const providerLog: string[] = [];

  setStatus("Analyzing…", true);
  resetTokenUsage();

  // ── Pick language adapter ─────────────────────────────────────────
  const adapter = getAdapter(doc.languageId);
  const content = doc.getText();
  const parsed  = adapter.parse(doc.fileName, content);

  // ── Step 1: Parallel context gathering ───────────────────────────
  const [compileErrors, git, pr] = await Promise.all([
    adapter.getCompileErrors(workspace, doc.fileName),
    getGitContext(workspace, relative),
    loadPRContext(workspace),
  ]);

  const styleConfig = loadStyleConfig(workspace);
  const packageJson = readPackageJson(workspace);

  // ── Step 2: AST — find changed / all functions ───────────────────
  const diffLines = extractChangedLines(git.diff);
  let functions   = adapter.findAffectedFunctions(parsed, diffLines);
  if (functions.length === 0) { functions = adapter.collectAllFunctions(parsed); }

  ensureHistory(workspace);
  if (functions.length === 0) { setStatus("No functions detected"); return; }

 
  if (compileErrors.length > 0) {
    vscode.window.showWarningMessage(`AI Reviewer: ${compileErrors.length} compile error(s) detected`);
  }

  // Decorate functions in editor
  const editor = vscode.window.activeTextEditor;
  if (editor?.document === doc) { decorateFunctions(editor, functions); }

  // dependencies are handled inside Group 3 of runAgentWaves
  let dependenciesResult: DependenciesResult | null = null;

  // ── Step 4: Get vector count BEFORE loop (dispatcher needs it) ─
  const vectorCount = await getVectorCount(workspace);

  // ── Step 5: Per-function analysis ────────────────────────────────
  const pageResults: PageResult[] = [];

  for (const fnInfo of functions) {
    const code = adapter.extractFunctionCode(parsed, fnInfo);
    if (!code) { continue; }

    // Cache check
    const cached = getCached(code);
    if (cached) {
      pageResults.push({ fnInfo, analysis: cached, code });
      continue;
    }

    // ── Embedding + blame + last-modified (parallel) ─────────────
    setStatus(`Embedding ${fnInfo.name}…`, true);
    const [embedding, author, lastModifiedDate] = await Promise.all([
      getEmbedding(code),
      getBlameAuthor(workspace, doc.fileName, fnInfo.start),
      getFunctionLastModified(doc.fileName, fnInfo.start, fnInfo.end),
    ]);
    if (!embedding) { continue; }
    const recordId  = crypto.randomBytes(6).toString("hex");
    const row: VectorRow = {
      id:           recordId,
      functionName: fnInfo.name,
      timestamp:    new Date().toISOString(),
      code,
      file:         relative,
      commit:       git.currentCommit,
      author:       author ?? "",
      vector:       embedding,
    };

    const [, historyMatches] = await Promise.all([
      insertVector(workspace, row),
      vectorSearch(workspace, embedding, recordId, 3),
    ]);

    writeAuditLog(workspace, {
      id: recordId, functionName: fnInfo.name,
      timestamp: row.timestamp, code, file: relative,
      commit: git.currentCommit, author: author ?? "",
    });

    // ── Code DNA fingerprint check ─────────────────────────────────
    const DNA_THRESHOLD   = 0.72;
    const DNA_MIN_HISTORY = 3;
    let dnaMismatch = null;

    if (!author) {
      providerLog.push(`🧬 DNA [${fnInfo.name}]: git blame returned null — file not committed or not in a git repo`);
    }

    if (author) {
      const authorVecs = await getAuthorVectors(workspace, author);
      const authorCount = authorVecs.length;

      if (authorCount < DNA_MIN_HISTORY) {
        providerLog.push(`🧬 DNA [${fnInfo.name}]: author="${author}" · ${authorCount}/${DNA_MIN_HISTORY} functions in history (need ${DNA_MIN_HISTORY - authorCount} more)`);
        dnaMismatch = {
          author, similarity: 0, isMatch: true,
          message: `Building DNA fingerprint — ${authorCount}/${DNA_MIN_HISTORY} functions in history`,
        };
      } else {
        const sims    = authorVecs.map(v => cosineSimilarity(embedding, v.vector));
        const avgSim  = sims.reduce((a, b) => a + b, 0) / sims.length;
        const pct     = Math.round(avgSim * 100);
        const isMatch = avgSim >= DNA_THRESHOLD;
        const coachingNotes = isMatch ? [] : buildCoachingNotes(code, authorVecs.map(v => v.code));
        providerLog.push(`🧬 DNA [${fnInfo.name}]: author="${author}" · ${authorCount} vectors · similarity=${pct}% · ${isMatch ? "OK ✓" : "MISMATCH ⚠️"}${coachingNotes.length ? ` · ${coachingNotes.length} coaching tip(s)` : ""}`);
        dnaMismatch = {
          author, similarity: pct, isMatch, coachingNotes,
          message: isMatch
            ? `This function matches ${author}'s coding style.`
            : `This function doesn't look like ${author}'s code (${pct}% style match). Possible copy-paste or AI-generated.`,
        };
      }
    }

    const templateMatches = templateSearch(embedding, 3);

    // ── Temporal Code Decay ───────────────────────────────────────
    let temporalDecay: TemporalInfo | null = null;
    if (lastModifiedDate) {
      const now           = Date.now();
      const ageInDays     = Math.max(0, Math.floor((now - new Date(lastModifiedDate).getTime()) / 86_400_000));
      const lastReviewRec = readScores(workspace)
        .filter(s => s.functionName === fnInfo.name)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
      const lastReviewedDate = lastReviewRec?.timestamp ?? null;
      const daysSinceReview  = lastReviewedDate
        ? Math.max(0, Math.floor((now - new Date(lastReviewedDate).getTime()) / 86_400_000))
        : null;
      const decayLevel = ageInDays <= 30  ? "fresh"   as const
                       : ageInDays <= 90  ? "aging"   as const
                       : ageInDays <= 365 ? "stale"   as const
                       :                   "decayed"  as const;
      const decayMessage = decayLevel === "fresh"
        ? "Recently modified — code is current."
        : decayLevel === "aging"
        ? "Modified over a month ago — consider a review."
        : decayLevel === "stale"
        ? "Not modified in over 3 months — may contain outdated patterns."
        : "Not modified in over a year — likely contains technical debt.";
      temporalDecay = { lastModifiedDate, lastReviewedDate, ageInDays, daysSinceReview, decayLevel, decayMessage };
      providerLog.push(`⏰ Temporal [${fnInfo.name}]: age=${ageInDays}d · level=${decayLevel} · last=${lastModifiedDate.slice(0, 10)}`);
    } else {
      providerLog.push(`⏰ Temporal [${fnInfo.name}]: no git history — file not committed`);
    }

    // ── Build AgentInput ──────────────────────────────────────────
    const agentInput = {
      functionName:     fnInfo.name,
      code,
      language:         adapter.languageLabel,
      testFramework:    adapter.testFramework,
      docFormat:        adapter.docFormat,
      languageStyle:    adapter.defaultStyle,
      templateMatches,
      historyMatches,
      prComments:       pr?.comments.map(c => ({ author: c.author, body: c.body })),
      prTitle:          pr?.title,
      prNumber:         pr?.number,
      styleConfig,
      packageJson,
      lastModifiedDate: lastModifiedDate ?? undefined,
      ageInDays:        temporalDecay?.ageInDays,
    };

    // ── Show skeleton immediately, then stream each section via postMessage ─
    const fnIdx = pageResults.length;
    const fnId  = `fn_${fnIdx}`;
    const p     = getOrCreatePanel(context);

    // Skeleton: all 9 sections show shimmer while agents run
    p.webview.html = buildHtml({
      file: relative, git, vectorCount, pr,
      scores: readScores(workspace), styleConfig,
      results: [...pageResults, {
        fnInfo, code,
        analysis: {
          functionName: fnInfo.name, overallScore: 0,
          quality: null, style: null, security: null, tests: null,
          docs: null, complexity: null, errorHandling: null,
          duplication: null, dependencies: null,
          compileErrors, dnaMismatch, temporalDecay,
        },
      }],
      dependenciesResult, providerLog, isStreaming: true, tokenUsage: getTokenUsage(),
    });
    p.reveal(vscode.ViewColumn.Beside, true);
    setStatus(`Analyzing ${fnInfo.name}…`, true);

    const analysis = await runAgentWaves(
      agentInput, dependenciesResult, compileErrors, providerLog,
      (section, result) => {
        // Each agent fires here as soon as it resolves — stream the section in
        setStatus(`${fnInfo.name}: ${section} done…`, true);
        const html = buildStreamSection(section, result, fnId);
        if (html) {
          p.webview.postMessage({ type: "streamSection", id: `sec-${section}-${fnId}`, html });
        }
      },
    );

    // ── Inject DNA + temporal results ────────────────────────────
    analysis.dnaMismatch   = dnaMismatch;
    analysis.temporalDecay = temporalDecay;

    // ── Diff-aware re-review — compare against the last time this
    //    function was analyzed (by name+file, regardless of code change) ─
    const newIssueSigs = buildIssueSignatures(analysis);
    const prevSnapshot = loadLastAnalysis(workspace, relative, fnInfo.name);
    analysis.diffReview = prevSnapshot
      ? computeDiffReview(prevSnapshot, { overallScore: analysis.overallScore, issues: newIssueSigs })
      : null;
    saveLastAnalysis(workspace, relative, fnInfo.name, {
      overallScore: analysis.overallScore,
      timestamp:    new Date().toISOString(),
      issues:       newIssueSigs,
    });
    if (analysis.diffReview) {
      const diffHtml = buildStreamSection("diffReview", analysis.diffReview, fnId);
      if (diffHtml) {
        p.webview.postMessage({ type: "streamSection", id: `sec-diffReview-${fnId}`, html: diffHtml });
      }
    }

    // ── Update score pill + bar via postMessage (no full-page flash) ──
    const finalScore = analysis.overallScore;
    const finalBar   = "█".repeat(Math.max(0, finalScore)) + "░".repeat(Math.max(0, 10 - finalScore));
    p.webview.postMessage({
      type:   "streamScore",
      pillId: `score-pill-${fnId}`,
      barId:  `bar-${fnId}`,
      score:  finalScore,
      bar:    finalBar,
    });

    // ── Persist score ─────────────────────────────────────────────
    if (analysis.overallScore > 0) {
      writeScore(workspace, {
        timestamp:    new Date().toISOString(),
        functionName: fnInfo.name,
        file:         relative,
        score:        analysis.overallScore,
      });
    }

    setCache(code, analysis);
    pageResults.push({ fnInfo, analysis, code });

  }

  // ── Step 5: Publish diagnostics ──────────────────────────────────
  publishDiagnostics(
    diagnosticCollection,
    doc,
    pageResults.map(r => ({ fnInfo: r.fnInfo, analysis: r.analysis }))
  );

  // ── Step 6: Build & show webview ─────────────────────────────────
  const scores = readScores(workspace);

  const p = getOrCreatePanel(context);
  p.webview.html = buildHtml({
    file:               relative,
    git,
    vectorCount,
    pr,
    scores,
    styleConfig,
    results:            pageResults,
    dependenciesResult,
    providerLog,
    tokenUsage:         getTokenUsage(),
  });
  p.reveal(vscode.ViewColumn.Beside, true);

  // ── Step 7: Status bar summary ───────────────────────────────────
  const totalIssues = pageResults.reduce((n, r) => n
    + (r.analysis.quality?.issues?.length            ?? 0)
    + (r.analysis.security?.vulnerabilities?.length  ?? 0)
    + (r.analysis.style?.violations?.length          ?? 0)
    + (r.analysis.errorHandling?.issues?.length      ?? 0)
    + (r.analysis.complexity?.issues?.length         ?? 0)
    + (r.analysis.duplication?.issues?.length        ?? 0), 0);

  const hasCritical = pageResults.some(r =>
    r.analysis.security?.vulnerabilities?.some((v: any) => v.severity === "critical" || v.severity === "high") ||
    r.analysis.errorHandling?.issues?.some((i: any) => i.severity === "critical")
  );

  setStatus(
    hasCritical       ? "Critical issue detected"
    : totalIssues > 0 ? `${totalIssues} issue(s)`
    :                   "All good ✓"
  );

  const action = await vscode.window.showInformationMessage(
    `AI Review: ${pageResults.length} fn · ${totalIssues} issue(s) · Groq+Gemini${hasCritical ? " · CRITICAL" : ""}`,
    "Open Panel"
  );
  if (action === "Open Panel") { p.reveal(vscode.ViewColumn.Beside, true); }
}

// ── Clear history command ─────────────────────────────────────────
export async function clearAll(): Promise<void> {
  const wf = vscode.workspace.workspaceFolders?.[0];
  if (!wf) { return; }

  const { clearCache }       = await import("../core/cache");
  const { clearVectorStore } = await import("../rag/lancedb");

  clearCache();
  clearHistory(wf.uri.fsPath);
  await clearVectorStore(wf.uri.fsPath);
  templatesEmbedded = false;

  diagnosticCollection.clear();
  vscode.window.showInformationMessage("AI Reviewer: history, cache and vector store cleared.");
}