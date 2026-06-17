import * as vscode from "vscode";
import type { FunctionInfo, AnalysisResult } from "../pipeline/types";

export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  doc:        vscode.TextDocument,
  results:    Array<{ fnInfo: FunctionInfo; analysis: AnalysisResult }>
): void {
  const diags: vscode.Diagnostic[] = [];

  for (const { fnInfo, analysis } of results) {

    // Compile errors — exact line
    for (const ce of analysis.compileErrors) {
      const li = Math.max(0, ce.line - 1);
      if (li < doc.lineCount) {
        const d = new vscode.Diagnostic(
          new vscode.Range(li, 0, li, doc.lineAt(li).text.length),
          `[Compile] ${ce.message}`,
          vscode.DiagnosticSeverity.Error
        );
        d.source = "AI Code Reviewer"; diags.push(d);
      }
    }

    const fnLine  = Math.max(0, fnInfo.start - 1);
    const fnRange = fnLine < doc.lineCount
      ? new vscode.Range(fnLine, 0, fnLine, doc.lineAt(fnLine).text.length)
      : new vscode.Range(0, 0, 0, 0);

    // Security vulnerabilities
    for (const v of (analysis.security?.vulnerabilities ?? [])) {
      const sev = v.severity === "critical" || v.severity === "high"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
      const d = new vscode.Diagnostic(fnRange, `[Security:${v.severity}] ${v.type} — ${v.description}`, sev);
      d.source = "AI Code Reviewer"; diags.push(d);
    }

    // Quality issues
    for (const iss of (analysis.quality?.issues ?? [])) {
      const sev = iss.severity === "error"   ? vscode.DiagnosticSeverity.Error
                : iss.severity === "warning"  ? vscode.DiagnosticSeverity.Warning
                :                               vscode.DiagnosticSeverity.Information;
      const d = new vscode.Diagnostic(fnRange, `[Quality] ${iss.description}`, sev);
      d.source = "AI Code Reviewer"; diags.push(d);
    }

    // Error handling issues
    for (const iss of (analysis.errorHandling?.issues ?? [])) {
      const sev = iss.severity === "critical"
        ? vscode.DiagnosticSeverity.Error
        : vscode.DiagnosticSeverity.Warning;
      const d = new vscode.Diagnostic(fnRange, `[ErrorHandling] ${iss.type} — ${iss.description}`, sev);
      d.source = "AI Code Reviewer"; diags.push(d);
    }

    // Style violations
    for (const v of (analysis.style?.violations ?? [])) {
      const d = new vscode.Diagnostic(fnRange, `[Style] ${v.rule}: ${v.description}`, vscode.DiagnosticSeverity.Information);
      d.source = "AI Code Reviewer"; diags.push(d);
    }

    // Duplication
    if (analysis.duplication?.isDuplicate) {
      const d = new vscode.Diagnostic(
        fnRange,
        `[Duplication] ${analysis.duplication.similarityPercent}% similar to existing function`,
        vscode.DiagnosticSeverity.Warning
      );
      d.source = "AI Code Reviewer"; diags.push(d);
    }
  }

  collection.set(doc.uri, diags);
}