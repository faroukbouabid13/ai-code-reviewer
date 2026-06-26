import * as path from "path";
import type { PageResult, DependenciesResult } from "../pipeline/types";

export interface MarkdownExportData {
  file:               string;
  results:            PageResult[];
  dependenciesResult: DependenciesResult | null;
}

function scoreEmoji(s: number): string {
  return s <= 3 ? "🔴" : s <= 6 ? "🟡" : "🟢";
}

function sevBadge(s: string): string {
  if (s === "critical") { return "🔴 CRITICAL"; }
  if (s === "high")     { return "🟠 HIGH"; }
  if (s === "error")    { return "❌ ERROR"; }
  if (s === "warning")  { return "⚠️ WARNING"; }
  return "ℹ️ INFO";
}

function langFromFile(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".py": "python", ".ts": "typescript", ".tsx": "tsx",
    ".js": "javascript", ".jsx": "jsx", ".java": "java", ".go": "go",
  };
  return map[ext] ?? "";
}

function codeBlock(code: string, lang = ""): string[] {
  return ["```" + lang, code, "```"];
}

export function buildMarkdown(data: MarkdownExportData): string {
  const date = new Date().toISOString().slice(0, 10);
  const filename = path.basename(data.file);
  const lang     = langFromFile(data.file);
  const L: string[] = [];

  // ── Header ──────────────────────────────────────────────────────
  L.push(`# AI Code Review — \`${filename}\``);
  L.push(`*Generated ${date} · AI Code Reviewer · 9 agents*`);
  L.push("");
  L.push("---");
  L.push("");

  // ── Summary table ────────────────────────────────────────────────
  if (data.results.length > 0) {
    L.push("## Summary");
    L.push("");
    L.push("| Function | Score | Security | Quality | Error | Complexity | Style |");
    L.push("|---|---|---|---|---|---|---|");
    for (const r of data.results) {
      const a = r.analysis;
      L.push(
        `| \`${r.fnInfo.name}\`` +
        ` | **${a.overallScore}/10** ${scoreEmoji(a.overallScore)}` +
        ` | ${a.security?.securityScore ?? "—"}/10` +
        ` | ${a.quality?.score ?? "—"}/10` +
        ` | ${a.errorHandling?.errorHandlingScore ?? "—"}/10` +
        ` | ${a.complexity?.complexityScore ?? "—"}/10` +
        ` | ${a.style?.styleScore ?? "—"}/10 |`
      );
    }
    L.push("");
    L.push("---");
    L.push("");
  }

  // ── Per-function sections ────────────────────────────────────────
  for (const r of data.results) {
    const a = r.analysis;
    L.push(`## \`${r.fnInfo.name}\` · ${a.overallScore}/10 ${scoreEmoji(a.overallScore)}`);
    L.push("");

    // Security
    if (a.security) {
      L.push(`### 🔐 Security · ${a.security.securityScore}/10`);
      L.push("");
      L.push(`> ${a.security.summary}`);
      L.push("");
      for (const v of a.security.vulnerabilities ?? []) {
        L.push(`**${sevBadge(v.severity)} — ${v.type}**`);
        L.push(`${v.description}`);
        if (v.impact)     { L.push(`*Impact: ${v.impact}*`); }
        if (v.fixedCode)  { L.push(""); L.push(...codeBlock(v.fixedCode, lang)); }
        L.push("");
      }
      if (!(a.security.vulnerabilities ?? []).length) { L.push("No vulnerabilities found."); L.push(""); }
    }

    // Quality
    if (a.quality) {
      L.push(`### ✦ Quality · ${a.quality.score}/10`);
      L.push("");
      L.push(`> ${a.quality.summary}`);
      L.push("");
      for (const i of a.quality.issues ?? []) {
        L.push(`- ${sevBadge(i.severity)} **${i.description ?? ""}**`);
        if (i.suggestion) { L.push(`  *Fix: ${i.suggestion}*`); }
      }
      if ((a.quality.issues ?? []).length) { L.push(""); }
    }

    // Error handling
    if (a.errorHandling) {
      L.push(`### ⚠️ Error Handling · ${a.errorHandling.errorHandlingScore}/10`);
      L.push("");
      L.push(`> ${a.errorHandling.summary}`);
      L.push("");
      for (const i of a.errorHandling.issues ?? []) {
        const label = i.type ? ` **${i.type}**:` : "";
        L.push(`- ${sevBadge(i.severity)}${label} ${i.description ?? ""}`);
        if (i.lineHint) { L.push(`  Line: \`${i.lineHint}\``); }
      }
      if ((a.errorHandling.issues ?? []).length) { L.push(""); }
    }

    // Complexity
    if (a.complexity) {
      L.push(`### 📊 Complexity · ${a.complexity.complexityScore}/10`);
      L.push("");
      L.push(`> ${a.complexity.summary}`);
      L.push("");
      L.push("| Cyclomatic | Cognitive | Lines | Max depth | Params |");
      L.push("|---|---|---|---|---|");
      L.push(`| ${a.complexity.cyclomaticComplexity} | ${a.complexity.cognitiveComplexity} | ${a.complexity.linesOfCode} | ${a.complexity.maxNestingDepth} | ${a.complexity.parameterCount} |`);
      L.push("");
      for (const i of a.complexity.issues ?? []) {
        const label = i.type ? `**${i.type}**: ` : "";
        L.push(`- ${label}${i.description ?? ""}`);
        if (i.suggestion) { L.push(`  *${i.suggestion}*`); }
      }
      if ((a.complexity.issues ?? []).length) { L.push(""); }
    }

    // Style
    if (a.style && (a.style.violations ?? []).length > 0) {
      L.push(`### 🎨 Style · ${a.style.styleScore}/10`);
      L.push("");
      L.push(`> ${a.style.summary}`);
      L.push("");
      for (const v of a.style.violations ?? []) {
        L.push(`- **${v.rule ?? ""}**: ${v.description ?? ""}`);
      }
      L.push("");
    }

    // Suggested refactor
    if (a.quality?.refactoredFunction) {
      L.push("### ✦ Suggested Refactor");
      L.push("");
      L.push(...codeBlock(a.quality.refactoredFunction, lang));
      L.push("");
    }

    // Generated tests
    if (a.tests?.testCode) {
      L.push(`### 🧪 Generated Tests (${a.tests.testCount})`);
      L.push("");
      L.push(`> ${a.tests.summary}`);
      L.push("");
      L.push(...codeBlock(a.tests.testCode, lang));
      L.push("");
    }

    // Generated docs
    if (a.docs?.jsdocBlock) {
      L.push("### 📖 Generated Documentation");
      L.push("");
      L.push(...codeBlock(a.docs.jsdocBlock, lang));
      L.push("");
    }

    // Debate
    if (a.debate) {
      L.push("### ⚖ Debate — Borderline Score");
      L.push("");
      L.push(`**🛑 Strict Engineer** *(${a.debate.strictEngineer.verdict})*`);
      L.push(`> ${a.debate.strictEngineer.openingStatement}`);
      L.push("");
      for (const arg of a.debate.strictEngineer.arguments ?? []) {
        L.push(`- **${arg.issue}**: ${arg.reasoning}`);
      }
      L.push("");
      L.push(`**✅ Pragmatic Developer** *(${a.debate.pragmaticDeveloper.verdict})*`);
      L.push(`> ${a.debate.pragmaticDeveloper.openingStatement}`);
      L.push("");
      for (const arg of a.debate.pragmaticDeveloper.arguments ?? []) {
        L.push(`- **${arg.issue}**: ${arg.reasoning}`);
      }
      L.push("");
    }

    L.push("---");
    L.push("");
  }

  // ── Dependencies ─────────────────────────────────────────────────
  if (data.dependenciesResult) {
    L.push("## 📦 Dependencies");
    L.push("");
    L.push(`> ${data.dependenciesResult.summary}`);
    L.push("");
    for (const i of data.dependenciesResult.issues ?? []) {
      L.push(`- ${sevBadge(i.severity)} **${i.package}** \`${i.currentVersion}\`: ${i.issue}`);
      if (i.suggestion) { L.push(`  *${i.suggestion}*`); }
    }
    if ((data.dependenciesResult.issues ?? []).length) { L.push(""); }
    L.push("---");
    L.push("");
  }

  L.push("*Generated by [AI Code Reviewer](https://github.com/faroukbouabid13/ai-code-reviewer) · 9 agents · Groq + Gemini + NVIDIA NIM*");

  return L.join("\n");
}
