import type { ExportData } from "../pipeline/analysisStore";
import type { GitHubReview, InlineComment } from "../git/postPRReview";

const SCORE_THRESHOLD = 7;

export function buildGitHubReview(data: ExportData, repoFilePath: string): GitHubReview {
  const { results } = data;

  // Average score across all functions
  const scores = results.map(r => r.analysis.overallScore).filter(s => s > 0);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  // Check for critical issues
  const hasCritical = results.some(r =>
    (r.analysis.security?.vulnerabilities as any[] ?? []).some((v: any) => v.severity === "critical") ||
    (r.analysis.errorHandling?.issues as any[] ?? []).some((i: any) => i.severity === "critical")
  );

  // Decide review event
  let event: "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  if (hasCritical || avgScore < SCORE_THRESHOLD) {
    event = "REQUEST_CHANGES";
  } else if (avgScore >= 8) {
    event = "APPROVE";
  } else {
    event = "COMMENT";
  }

  // Build one inline comment per function
  const comments: InlineComment[] = [];
  for (const { fnInfo, analysis } of results) {
    const lines: string[] = [];

    const vulns: any[] = analysis.security?.vulnerabilities ?? [];
    for (const v of vulns.slice(0, 3)) {
      const icon = v.severity === "critical" ? "🔴" : v.severity === "high" ? "🟠" : "🟡";
      lines.push(`${icon} **Security [${v.severity}]**: ${v.description}`);
    }

    const ehIssues: any[] = analysis.errorHandling?.issues ?? [];
    for (const e of ehIssues.slice(0, 2)) {
      if (e.severity === "critical" || e.severity === "major") {
        lines.push(`⚠️ **Error Handling**: ${e.description}`);
      }
    }

    const qIssues: any[] = analysis.quality?.issues ?? [];
    for (const q of qIssues.slice(0, 2)) {
      lines.push(`📐 **Quality**: ${q.description}`);
    }

    const cxIssues: any[] = analysis.complexity?.issues ?? [];
    if (cxIssues.length && (analysis.complexity?.complexityScore ?? 10) < 6) {
      lines.push(`🔵 **Complexity**: ${analysis.complexity?.summary}`);
    }

    if (lines.length === 0) {
      if (analysis.overallScore >= 8) {
        lines.push(`✅ No significant issues. Score: ${analysis.overallScore}/10`);
      } else {
        continue;
      }
    }

    comments.push({
      path: repoFilePath,
      line: fnInfo.start,
      body: `### \`${analysis.functionName}\` — Score: ${analysis.overallScore}/10\n\n${lines.join("\n")}`,
    });
  }

  // Build summary body
  const rows = results.map(r => {
    const s = r.analysis.overallScore;
    const icon = s >= 8 ? "✅" : s >= 5 ? "⚠️" : "❌";
    return `| \`${r.analysis.functionName}\` | ${icon} ${s}/10 |`;
  }).join("\n");

  const scoreIcon = avgScore >= 8 ? "✅" : avgScore >= SCORE_THRESHOLD ? "⚠️" : "❌";
  const verdict = hasCritical
    ? "⛔ **Critical security issues detected — changes required before merge.**"
    : avgScore >= 8
    ? "✅ **Code quality is good.**"
    : avgScore >= SCORE_THRESHOLD
    ? "⚠️ **Minor issues found. Consider addressing before merge.**"
    : "❌ **Quality below threshold — changes required.**";

  const perCategory = results.map(r =>
    `**\`${r.analysis.functionName}\`**\n` +
    `- Security: ${r.analysis.security?.securityScore ?? "–"}/10\n` +
    `- Quality: ${r.analysis.quality?.score ?? "–"}/10\n` +
    `- Error Handling: ${r.analysis.errorHandling?.errorHandlingScore ?? "–"}/10\n` +
    `- Complexity: ${r.analysis.complexity?.complexityScore ?? "–"}/10`
  ).join("\n\n");

  const body =
`## 🦊 AI Code Reviewer — Score: ${avgScore}/10 ${scoreIcon}

${verdict}

| Function | Score |
|----------|-------|
${rows}

<details>
<summary>Per-category breakdown</summary>

${perCategory}

</details>

*Reviewed by 🦊 [AI Code Reviewer](https://github.com/faroukbouabid13/ai-code-reviewer) — 9 agents · multi-provider*`;

  return { event, body, comments };
}
