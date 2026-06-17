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
import { registerStatusUpdater } from "./agents/caller";

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

  // ── Commands ────────────────────────────────────────────────────

  const cmdAnalyze = vscode.commands.registerCommand("ai-reviewer.analyze", () => {
    const doc = vscode.window.activeTextEditor?.document;
    if (doc) { analyze(doc, context).catch(console.error); }
    else { vscode.window.showWarningMessage("Open a TypeScript/JavaScript file first."); }
  });

  const cmdClear = vscode.commands.registerCommand("ai-reviewer.clearHistory", async () => {
    await clearAll();
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
    onSave,
    onClose,
  );

  // ── Warm up template embeddings on startup ──────────────────────
  setStatus("Ready");
  embedTemplates().catch(console.error);
}

export function deactivate(): void {
  // VS Code disposes all context.subscriptions automatically.
  // No manual cleanup needed.
}