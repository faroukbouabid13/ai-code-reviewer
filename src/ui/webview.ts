import * as vscode from "vscode";
import * as ts     from "typescript";
import * as fs     from "fs";
import { parseSourceFile } from "../ast/parser";
import { callAgent }       from "../agents/caller";
import { getAgentPrompt }  from "../agents/prompts";

export function setupWebviewMessages(panel: vscode.WebviewPanel): void {
  panel.webview.onDidReceiveMessage(async msg => {

    // ── Apply auto-fix via AST replacement ──────────────────────
    if (msg.type === "applyFix") {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

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
        vscode.window.showWarningMessage(`AI Reviewer: Could not locate ${msg.fnName}`);
      }
    }

    // ── Chat ─────────────────────────────────────────────────────
    if (msg.type === "chat") {
      try {
        // Reuses quality system prompt (cached) — appends question as user content
        const { system } = getAgentPrompt("quality", {
          functionName: "chat",
          code:         msg.fnCode,
        });
        const chatUser = `The developer is asking a follow-up question about the function above.\n\nQuestion: ${msg.question}\n\nAnswer concisely in 2-4 sentences. No markdown fences.`;
        const response = await callAgent(system, chatUser, "quality");

        panel.webview.postMessage({
          type:        "chatResponse",
          chatBoxId:   msg.chatBoxId,
          thinkingId:  msg.thinkingId,
          response,
        });
      } catch (e: any) {
        panel.webview.postMessage({
          type:        "chatResponse",
          chatBoxId:   msg.chatBoxId,
          thinkingId:  msg.thinkingId,
          response:    `Error: ${e.message}`,
        });
      }
    }
  });
}