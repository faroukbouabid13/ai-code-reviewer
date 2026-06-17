import type {
  GitContext, PRContext, StyleConfig, ScoreRecord,
  PageResult, DependenciesResult, TokenUsage, DebateResult, DiffReview,
} from "../pipeline/types";

// ── HTML escape ───────────────────────────────────────────────────
function esc(str: string): string {
  return (str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function sevColor(s: string): string {
  if (s === "critical") { return "#dc2626"; }
  if (s === "high")     { return "#ea580c"; }
  if (s === "error")    { return "#f97316"; }
  if (s === "warning")  { return "#eab308"; }
  return "#60a5fa";
}

// ── Token usage card ─────────────────────────────────────────────
function buildTokenUsageHtml(usage: TokenUsage[]): string {
  if (!usage.length) { return ""; }
  const fmt = (n: number) => n.toLocaleString();
  const totalPrompt = usage.reduce((s, t) => s + t.promptTokens,     0);
  const totalCompl  = usage.reduce((s, t) => s + t.completionTokens, 0);
  const totalAll    = usage.reduce((s, t) => s + t.totalTokens,      0);
  const maxTotal    = Math.max(...usage.map(t => t.totalTokens), 1);

  const rows = usage.map(t => {
    const barPct = Math.round((t.totalTokens / maxTotal) * 100);
    const label  = `${t.provider} · ${t.model.split("/").pop()}`;
    return `<div class="tok-row">
      <span class="tok-provider">${esc(label)}</span>
      <div class="tok-bar-wrap"><div class="tok-bar" style="width:${barPct}%"></div></div>
      <span class="tok-nums">${fmt(t.promptTokens)} in / ${fmt(t.completionTokens)} out</span>
      <span class="tok-total">${fmt(t.totalTokens)}</span>
    </div>`;
  }).join("");

  return `<div class="tok-card">
    <div class="tok-head">📊 Token usage · this run</div>
    <div class="tok-rows">${rows}</div>
    <div class="tok-summary">
      <span>Total</span>
      <span>${fmt(totalPrompt)} prompt + ${fmt(totalCompl)} completion</span>
      <span class="tok-grand">${fmt(totalAll)} tokens</span>
    </div>
  </div>`;
}

// ── Two Agents Debate card (grey-zone scores 4-7 only) ─────────────
function buildDebateCardHtml(debate: DebateResult, sid: string): string {
  const side = (label: string, icon: string, color: string, s: DebateResult["strictEngineer"]) => `
    <div class="debate-side" style="border-color:${color}44">
      <div class="debate-side-head" style="color:${color}">${icon} ${label} — <span class="debate-verdict">${esc(s.verdict)}</span></div>
      <p class="debate-opening">${esc(s.openingStatement)}</p>
      <ul class="debate-args">
        ${(s.arguments ?? []).map(a => `<li><strong>${esc(a.issue)}</strong> — ${esc(a.reasoning)}</li>`).join("")}
      </ul>
    </div>`;
  return `<div id="${sid}" class="debate-card">
    <div class="debate-head">⚖ Two Agents Debate — borderline score, hear both sides</div>
    <div class="debate-grid">
      ${side("Strict Senior Engineer", "🛑", "#f87171", debate.strictEngineer)}
      ${side("Pragmatic Developer",    "✅", "#4ade80", debate.pragmaticDeveloper)}
    </div>
    <p class="debate-footer">Your call — weigh both sides against your deadline and blast radius.</p>
  </div>`;
}

// ── Diff-aware re-review card (only when a prior review exists) ───
const DIFF_CAT_LABEL: Record<string, string> = {
  security: "Security", quality: "Quality", errorHandling: "Error handling",
  complexity: "Complexity", style: "Style", duplication: "Duplication",
};

function buildDiffReviewHtml(diff: DiffReview, sid: string): string {
  const arrow      = diff.scoreDelta > 0 ? "▲" : diff.scoreDelta < 0 ? "▼" : "→";
  const deltaColor = diff.scoreDelta > 0 ? "#4ade80" : diff.scoreDelta < 0 ? "#f87171" : "#9ca3af";

  const catRows = Object.entries(diff.byCategory)
    .filter(([, d]) => d.added.length || d.resolved.length || d.unchanged)
    .map(([cat, d]) => `
      <div class="diff-cat-row">
        <span class="diff-cat-label">${DIFF_CAT_LABEL[cat] ?? cat}</span>
        <span class="diff-cat-counts">
          ${d.added.length    ? `<span class="diff-added">+${d.added.length} new</span>`            : ""}
          ${d.resolved.length ? `<span class="diff-resolved">-${d.resolved.length} resolved</span>` : ""}
          ${d.unchanged       ? `<span class="diff-unchanged">${d.unchanged} unchanged</span>`      : ""}
        </span>
      </div>
      ${d.added.length    ? `<ul class="diff-list diff-list-added">${d.added.map(a => `<li>+ ${esc(a)}</li>`).join("")}</ul>`       : ""}
      ${d.resolved.length ? `<ul class="diff-list diff-list-resolved">${d.resolved.map(a => `<li>− ${esc(a)}</li>`).join("")}</ul>` : ""}
    `).join("");

  return `<div id="${sid}" class="diff-card">
    <div class="diff-head">
      <span>↻ Since last review</span>
      <span class="diff-score" style="color:${deltaColor}">${diff.previousScore}/10 ${arrow} ${diff.currentScore}/10</span>
    </div>
    <div class="diff-summary">
      <span class="diff-added">+${diff.totalAdded} new</span>
      <span class="diff-resolved">-${diff.totalResolved} resolved</span>
      <span class="diff-unchanged">${diff.totalUnchanged} unchanged</span>
    </div>
    ${catRows || "<p class='muted' style='padding:4px 0'>No issues in either review.</p>"}
  </div>`;
}

// ── Dashboard (Chart.js) ──────────────────────────────────────────
function buildDashboard(scores: ScoreRecord[]): string {
  if (!scores.length) { return "<p class='muted'>No score history yet.</p>"; }

  const byFn: Record<string, ScoreRecord[]> = {};
  scores.forEach(s => { if (!byFn[s.functionName]) { byFn[s.functionName] = []; } byFn[s.functionName].push(s); });

  const colors   = ["#60a5fa","#a78bfa","#4ade80","#f97316","#eab308","#f472b6","#34d399","#fb923c","#e879f9"];
  const allDates = [...new Set(scores.map(s => s.timestamp.slice(0, 10)))].sort();

  const datasets = Object.entries(byFn).map(([fn, recs], i) => {
    const color  = colors[i % colors.length];
    const points = allDates.map(d => {
      const rec = recs.filter(r => r.timestamp.slice(0, 10) === d);
      return rec.length > 0 ? parseFloat((rec.reduce((s, r) => s + r.score, 0) / rec.length).toFixed(1)) : null;
    });
    return `{label:${JSON.stringify(fn)},data:${JSON.stringify(points)},borderColor:"${color}",backgroundColor:"${color}22",tension:0.3,spanGaps:true,pointRadius:4}`;
  }).join(",");

  return `<div style="position:relative;height:200px;margin-bottom:8px"><canvas id="scoreChart"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
<script>(function(){const ctx=document.getElementById('scoreChart');if(!ctx)return;new Chart(ctx,{type:'line',data:{labels:${JSON.stringify(allDates)},datasets:[${datasets}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9ca3af',font:{size:10}}}},scales:{x:{ticks:{color:'#6b7280',font:{size:10}},grid:{color:'#ffffff08'}},y:{min:0,max:10,ticks:{color:'#6b7280',font:{size:10}},grid:{color:'#ffffff08'}}}}});})();</script>`;
}

// ── Provider routing panel ────────────────────────────────────────
function buildProviderLog(log: string[]): string {
  return `<div class="agent-section">
    <div class="agent-head" style="background:#0f172a;color:#94a3b8">Provider routing</div>
    <div style="padding:8px 12px;display:flex;flex-wrap:wrap;gap:6px">
      ${log.map(l => {
        const isGroq = l.includes("Groq") && l.includes("fulfilled");
        const isFail = l.includes("failed") || l.includes("rejected");
        const col = isFail ? "#f87171" : isGroq ? "#fb923c" : "#60a5fa";
        const bg  = isFail ? "#dc262615" : isGroq ? "#d9770615" : "#1d4ed815";
        return `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${bg};color:${col};font-family:monospace">${esc(l)}</span>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Loading placeholder card ──────────────────────────────────────
function loadingSection(label: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : "";
  return `<div class="agent-section sk-section"${idAttr}>
    <div class="agent-head sk-head">⟳ ${label} — analyzing…</div>
    <div class="sk-line"></div>
    <div class="sk-line" style="width:68%"></div>
    <div class="sk-line" style="width:50%"></div>
  </div>`;
}

// ── Per-section streaming patch (called from analyze.ts via postMessage) ──
export function buildStreamSection(section: string, result: any, fnId: string): string {
  const sid = `sec-${section}-${fnId}`;
  const tw  = (text: string) =>
    `<p class="summary tw" style="padding:8px 12px">${esc(text ?? "")}</p>`;

  const issueRows = (issues: any[], color?: string) =>
    (issues ?? []).map((iss: any) => {
      const desc = iss.description ?? iss.message ?? iss.text ?? iss.detail ?? iss.rule ?? "";
      const sug  = iss.suggestion  ?? iss.fix ?? iss.recommendation ?? "";
      const code = iss.fixedCode   ?? iss.fixed_code ?? "";
      const sev  = (iss.severity   ?? iss.level ?? "info").toUpperCase();
      const c    = color ?? sevColor(iss.severity ?? iss.level ?? "info");
      if (!desc && !sug && !code) { return ""; }
      return `<div class="issue" style="border-left:3px solid ${c};margin:6px">
        <span class="badge" style="background:${c}22;color:${c}">${esc(sev)}</span>
        ${desc ? `<p class="idesc">${esc(desc)}</p>` : ""}
        ${sug  ? `<p class="isug">${esc(sug)}</p>`  : ""}
        ${code && code.length > 10 ? `<pre class="code">${esc(code)}</pre>` : ""}
      </div>`;
    }).join("") || "<p class='muted' style='padding:8px 12px'>No issues found.</p>";

  switch (section) {
    case "security":
      if (result?.securityScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head red">Security · ${result.securityScore}/10</div>
        ${tw(result.summary)}
        ${issueRows(result.vulnerabilities ?? [])}
      </div>`;

    case "quality":
      if (result?.score === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head amber">Quality · ${result.score}/10</div>
        ${tw(result.summary)}
        ${issueRows(result.issues ?? [])}
      </div>`;

    case "refactor":
      if (!result) { return `<div id="${sid}"></div>`; }
      return `<div id="${sid}" class="refactor-card">
        <div class="refactor-head">
          <span>✦ Suggested refactor</span>
          <button class="refactor-copy-btn" onclick="copyRefactor('${sid}')">Copy</button>
        </div>
        <pre class="code refactor-code" id="refactor-code-${sid}">${esc(result)}</pre>
      </div>`;

    case "errorHandling":
      if (result?.errorHandlingScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head errhandle">Error handling · ${result.errorHandlingScore}/10</div>
        ${tw(result.summary)}
        ${issueRows(result.issues ?? [])}
      </div>`;

    case "complexity":
      if (result?.complexityScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head complexity">Complexity · ${result.complexityScore}/10</div>
        ${tw(result.summary)}
        <div class="complexity-stats">
          <div class="stat-box"><span class="stat-val">${result.cyclomaticComplexity ?? "?"}</span><span class="stat-lbl">Cyclomatic</span></div>
          <div class="stat-box"><span class="stat-val">${esc(String(result.cognitiveComplexity ?? "?"))}</span><span class="stat-lbl">Cognitive</span></div>
          <div class="stat-box"><span class="stat-val">${result.linesOfCode ?? "?"}</span><span class="stat-lbl">Lines</span></div>
          <div class="stat-box"><span class="stat-val">${result.maxNestingDepth ?? "?"}</span><span class="stat-lbl">Max depth</span></div>
          <div class="stat-box"><span class="stat-val">${result.parameterCount ?? "?"}</span><span class="stat-lbl">Params</span></div>
        </div>
        ${issueRows(result.issues ?? [], "#8b5cf6")}
      </div>`;

    case "style":
      if (result?.styleScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head purple">Style · ${result.styleScore}/10</div>
        ${tw(result.summary)}
        ${issueRows(result.violations ?? [], "#a78bfa")}
      </div>`;

    case "duplication":
      if (result?.duplicationScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head duplication">Duplication · ${result.duplicationScore}/10</div>
        ${tw(result.summary)}
        ${result.isDuplicate ? `<div class="dup-warning">Duplicate detected — ${result.similarityPercent}% similar</div>` : ""}
        ${issueRows(result.issues ?? [], "#f59e0b")}
      </div>`;

    case "docs":
      if (result?.hasAdequateDocs === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head coral">Docs · ${result.hasAdequateDocs ? "Adequate" : "Missing"}</div>
        ${tw(result.summary)}
        ${result.jsdocBlock ? `<pre class="code" style="margin:4px 8px 8px">${esc(result.jsdocBlock)}</pre>` : ""}
      </div>`;

    case "tests":
      if (result?.testCount === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head teal">Tests · ${result.testCount} generated</div>
        ${tw(result.summary)}
        ${result.testCode ? `<pre class="code" style="margin:4px 8px 8px">${esc(result.testCode)}</pre>` : ""}
      </div>`;

    case "dependencies":
      if (result?.dependencyScore === undefined) { return ""; }
      return `<div id="${sid}" class="agent-section">
        <div class="agent-head deps">Dependencies · ${result.dependencyScore}/10</div>
        ${tw(result.summary)}
        ${issueRows(result.issues ?? [])}
      </div>`;

    case "debate":
      if (!result) { return `<div id="${sid}"></div>`; }
      return buildDebateCardHtml(result, sid);

    case "diffReview":
      if (!result) { return `<div id="${sid}"></div>`; }
      return buildDiffReviewHtml(result, sid);

    default:
      return "";
  }
}

// ── Function card ─────────────────────────────────────────────────
function buildFunctionCard(r: PageResult, idx: number, streaming = false): string {
  const { analysis, fnInfo, code } = r;
  const fnId  = `fn_${idx}`;
  const sid   = (s: string) => `sec-${s}-${fnId}`;  // stable section IDs for streaming patches
  const score = analysis.overallScore;
  const bar   = "█".repeat(Math.max(0, score)) + "░".repeat(Math.max(0, 10 - score));

  const diffReviewHtml = analysis.diffReview
    ? buildDiffReviewHtml(analysis.diffReview, sid('diffReview'))
    : (streaming ? `<div id="${sid('diffReview')}"></div>` : "");

  const compileHtml = analysis.compileErrors.length > 0 ? `
    <div class="compile-banner">
      <span class="compile-title">Compile errors (${analysis.compileErrors.length})</span>
      ${analysis.compileErrors.map(e => `<div class="compile-err">Line ${e.line}: ${esc(e.message)}</div>`).join("")}
    </div>` : "";

  const issueList = (issues: any[], color?: string) =>
    issues.map((iss: any) => {
      // Defensive field name resolution — model sometimes uses different names
      const desc = iss.description ?? iss.message ?? iss.text ?? iss.detail ?? iss.rule ?? iss.issue ?? "";
      const sug  = iss.suggestion  ?? iss.fix ?? iss.recommendation ?? iss.action ?? "";
      const code = iss.fixedCode   ?? iss.fixed_code ?? iss.fixCode ?? "";
      const sev  = (iss.severity   ?? iss.level ?? "info").toUpperCase();
      const c    = color ?? sevColor(iss.severity ?? iss.level ?? "info");
      // Skip completely empty issues — nothing to show
      if (!desc && !sug && !code) { return ""; }
      return `<div class="issue" style="border-left:3px solid ${c};margin:6px">
        <span class="badge" style="background:${c}22;color:${c}">${esc(sev)}</span>
        ${desc ? `<p class="idesc">${esc(desc)}</p>` : ""}
        ${sug  ? `<p class="isug">${esc(sug)}</p>`   : ""}
        ${code && code.length > 10 ? `<pre class="code">${esc(code)}</pre>` : ""}
      </div>`;
    }).join("") || "<p class='muted' style='padding:8px 12px'>No issues found.</p>";

  const dnaHtml = analysis.dnaMismatch ? (() => {
    const dna      = analysis.dnaMismatch!;
    const building = dna.similarity === 0 && dna.isMatch;
    const border   = building ? "#6b7280" : dna.isMatch ? "#16a34a" : "#dc2626";
    const bg       = building ? "#ffffff08" : dna.isMatch ? "#16a34a15" : "#dc262615";
    const label    = building ? "🧬 Building DNA Fingerprint"
                   : dna.isMatch ? "🧬 Code DNA Match ✓"
                   : "🧬 Code DNA Mismatch";
    const barColor = dna.isMatch
      ? "linear-gradient(90deg,#16a34a,#4ade80)"
      : "linear-gradient(90deg,#dc2626,#f59e0b,#7c3aed)";
    const pctLine  = building
      ? `<span class="dna-pct" style="color:#9ca3af">${esc(dna.message)}</span>`
      : `<div class="dna-bar-wrap"><div class="dna-bar" style="width:${dna.similarity}%;background:${barColor}"></div></div>
         <span class="dna-pct" style="color:${border}">${dna.similarity}% match with ${esc(dna.author)}'s historical style</span>`;
    const coachingHtml = (dna.coachingNotes?.length)
      ? `<div class="dna-coaching">
           <span class="dna-coaching-title">Style coaching</span>
           <ul class="dna-coaching-list">${dna.coachingNotes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
         </div>`
      : "";
    return `<div class="dna-warning" style="border-color:${border};background:${bg}">
      <span class="dna-icon">🧬</span>
      <div style="flex:1">
        <strong style="color:${border}">${label}</strong> — ${esc(dna.message)}
        ${pctLine}
        ${coachingHtml}
      </div>
    </div>`;
  })() : "";

  const decayColors = {
    fresh:   { border: "#16a34a", text: "#4ade80" },
    aging:   { border: "#eab308", text: "#facc15" },
    stale:   { border: "#f97316", text: "#fb923c" },
    decayed: { border: "#dc2626", text: "#f87171" },
  };
  const decayHtml = analysis.temporalDecay ? (() => {
    const td  = analysis.temporalDecay!;
    const c   = decayColors[td.decayLevel];
    const barPct = Math.min(100, Math.round((td.ageInDays / 365) * 100));
    const reviewLine = td.lastReviewedDate
      ? `Last reviewed ${td.daysSinceReview}d ago`
      : "Never AI-reviewed";
    return `<div class="decay-card" style="border-color:${c.border};background:${c.border}12">
      <div class="decay-header">
        <span class="decay-level" style="color:${c.text}">⏰ ${td.decayLevel} code</span>
        <span class="decay-age" style="color:${c.text}">${td.ageInDays}d old · ${td.lastModifiedDate.slice(0,10)}</span>
      </div>
      <div class="decay-bar-wrap"><div class="decay-bar" style="width:${barPct}%;background:${c.border}"></div></div>
      <div class="decay-meta">
        <span>${esc(td.decayMessage)}</span>
        <span class="decay-review">${reviewLine}</span>
      </div>
    </div>`;
  })() : "";

  const securityChecklistHtml = (analysis.security?.checkedItems ?? []).length > 0 ? (() => {
    const items = analysis.security!.checkedItems!;
    const passed = items.filter(i => i.includes(": PASS")).length;
    const failed = items.filter(i => i.includes(": FAIL")).length;
    const rows   = items.map(item => {
      const isFail = item.includes(": FAIL");
      const col    = isFail ? "#f87171" : "#4ade80";
      const icon   = isFail ? "✗" : "✓";
      return `<div style="display:flex;gap:6px;padding:2px 0;font-size:11px;font-family:monospace">
        <span style="color:${col};flex-shrink:0;width:14px">${icon}</span>
        <span style="color:${isFail ? col : "#6b7280"}">${esc(item)}</span>
      </div>`;
    }).join("");
    return `<details style="margin:4px 8px 8px">
      <summary style="cursor:pointer;font-size:11px;color:#6b7280;user-select:none;padding:4px 0">
        Checklist — ${passed} passed · <span style="color:#f87171">${failed} failed</span>
      </summary>
      <div style="padding:6px 10px;background:#0d1117;border-radius:6px;margin-top:4px">${rows}</div>
    </details>`;
  })() : "";

  const securityHtml = analysis.security ? `
    <div id="${sid('security')}" class="agent-section">
      <div class="agent-head red">Security · ${analysis.security.securityScore}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.security.summary)}</p>
      ${securityChecklistHtml}
      ${issueList(analysis.security.vulnerabilities ?? [])}
    </div>` : (streaming ? loadingSection("Security", sid("security")) : "");

  const errorHandlingHtml = analysis.errorHandling ? `
    <div id="${sid('errorHandling')}" class="agent-section">
      <div class="agent-head errhandle">Error handling · ${analysis.errorHandling.errorHandlingScore}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.errorHandling.summary)}</p>
      ${issueList(analysis.errorHandling.issues ?? [])}
    </div>` : (streaming ? loadingSection("Error handling", sid("errorHandling")) : "");

  const qualityHtml = analysis.quality ? `
    <div id="${sid('quality')}" class="agent-section">
      <div class="agent-head amber">Quality · ${analysis.quality.score}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.quality.summary)}</p>
      ${analysis.quality.prInsight ? `<div class="pr-insight" style="margin:0 8px 8px">PR insight: ${esc(analysis.quality.prInsight)}</div>` : ""}
      ${analysis.quality.matchedTemplate ? `<p class="matched" style="padding:0 12px 8px">Matched template: ${esc(analysis.quality.matchedTemplate)}</p>` : ""}
      ${issueList(analysis.quality.issues ?? [])}
    </div>` : (streaming ? loadingSection("Quality", sid("quality")) : "");

  const refactorCode = analysis.quality?.refactoredFunction ?? null;
  const refactorHtml = refactorCode
    ? `<div id="${sid('refactor')}" class="refactor-card">
        <div class="refactor-head">
          <span>✦ Suggested refactor</span>
          <button class="refactor-copy-btn" onclick="copyRefactor('${sid('refactor')}')">Copy</button>
        </div>
        <pre class="code refactor-code" id="refactor-code-${sid('refactor')}">${esc(refactorCode)}</pre>
      </div>`
    : (streaming ? `<div id="${sid('refactor')}"></div>` : "");

  const complexityHtml = analysis.complexity ? `
    <div id="${sid('complexity')}" class="agent-section">
      <div class="agent-head complexity">Complexity · ${analysis.complexity.complexityScore}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.complexity.summary)}</p>
      <div class="complexity-stats">
        <div class="stat-box"><span class="stat-val">${analysis.complexity.cyclomaticComplexity}</span><span class="stat-lbl">Cyclomatic</span></div>
        <div class="stat-box"><span class="stat-val">${esc(analysis.complexity.cognitiveComplexity)}</span><span class="stat-lbl">Cognitive</span></div>
        <div class="stat-box"><span class="stat-val">${analysis.complexity.linesOfCode}</span><span class="stat-lbl">Lines</span></div>
        <div class="stat-box"><span class="stat-val">${analysis.complexity.maxNestingDepth}</span><span class="stat-lbl">Max depth</span></div>
        <div class="stat-box"><span class="stat-val">${analysis.complexity.parameterCount}</span><span class="stat-lbl">Params</span></div>
      </div>
      ${issueList(analysis.complexity.issues ?? [], "#8b5cf6")}
    </div>` : (streaming ? loadingSection("Complexity", sid("complexity")) : "");

  const duplicationHtml = analysis.duplication ? `
    <div id="${sid('duplication')}" class="agent-section">
      <div class="agent-head duplication">Duplication · ${analysis.duplication.duplicationScore}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.duplication.summary)}</p>
      ${analysis.duplication.isDuplicate ? `<div class="dup-warning">Duplicate detected — ${analysis.duplication.similarityPercent}% similar</div>` : ""}
      ${issueList(analysis.duplication.issues ?? [], "#f59e0b")}
    </div>` : (streaming ? loadingSection("Duplication", sid("duplication")) : "");

  const styleHtml = analysis.style ? `
    <div id="${sid('style')}" class="agent-section">
      <div class="agent-head purple">Style · ${analysis.style.styleScore}/10</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.style.summary)}</p>
      ${issueList(analysis.style.violations ?? [], "#a78bfa")}
    </div>` : (streaming ? loadingSection("Style", sid("style")) : "");

  const testsHtml = analysis.tests ? `
    <div id="${sid('tests')}" class="agent-section">
      <div class="agent-head teal">Tests · ${analysis.tests.testCount} generated</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.tests.summary)}</p>
      ${analysis.tests.testCode ? `<pre class="code" style="margin:4px 8px 8px">${esc(analysis.tests.testCode)}</pre>` : ""}
    </div>` : (streaming ? loadingSection("Tests", sid("tests")) : "");

  const docsHtml = analysis.docs ? `
    <div id="${sid('docs')}" class="agent-section">
      <div class="agent-head coral">Docs · ${analysis.docs.hasAdequateDocs ? "Adequate" : "Missing"}</div>
      <p class="summary" style="padding:8px 12px">${esc(analysis.docs.summary)}</p>
      ${analysis.docs.jsdocBlock ? `<pre class="code" style="margin:4px 8px 8px">${esc(analysis.docs.jsdocBlock)}</pre>` : ""}
    </div>` : (streaming ? loadingSection("Docs", sid("docs")) : "");

  const debateHtml = analysis.debate
    ? buildDebateCardHtml(analysis.debate, sid('debate'))
    : (streaming ? `<div id="${sid('debate')}"></div>` : "");

  const bestFix = analysis.quality?.refactoredFunction
    || analysis.errorHandling?.issues?.find((i: any) => i.fixedCode)?.fixedCode
    || null;

  const autoFixBtn = bestFix
    ? `<button class="fix-btn" onclick="applyFix('${esc(fnInfo.name)}','${fnId}')">Apply fix</button>`
    : "";

  return `
  <div class="fn-card ${analysis.compileErrors.length > 0 ? "has-errors" : ""}">
    <textarea id="refactor-${fnId}" style="display:none">${esc(bestFix ?? "")}</textarea>
    <textarea id="code-${fnId}"     style="display:none">${esc(code)}</textarea>
    <div class="fn-head">
      <span class="fn-name">⚙ ${esc(fnInfo.name)}</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${autoFixBtn}
        <span id="score-pill-${fnId}" class="score-pill ${score <= 4 ? "low" : score <= 7 ? "mid" : "high"}">${score > 0 ? score + "/10" : "…"}</span>
      </div>
    </div>
    <div id="bar-${fnId}" class="bar">${score > 0 ? bar : "░".repeat(10)}</div>
    ${diffReviewHtml}${dnaHtml}${decayHtml}${compileHtml}${securityHtml}${qualityHtml}${refactorHtml}${errorHandlingHtml}
    ${complexityHtml}${styleHtml}${duplicationHtml}${docsHtml}${testsHtml}${debateHtml}
    <div class="sec" style="padding:0 4px">Chat about ${esc(fnInfo.name)}</div>
    <div class="chat-box" id="chat-${fnId}"></div>
    <div class="chat-input-row">
      <input class="chat-input" id="input-${fnId}" placeholder="Ask anything about this function…" onkeydown="if(event.key==='Enter')sendChat('${fnId}')"/>
      <button class="chat-send" onclick="sendChat('${fnId}')">Send</button>
    </div>
  </div>`;
}

// ── Main HTML builder ─────────────────────────────────────────────
export function buildHtml(data: {
  file:               string;
  git:                GitContext;
  vectorCount:        number;
  pr:                 PRContext | null;
  scores:             ScoreRecord[];
  styleConfig:        StyleConfig | null;
  results:            PageResult[];
  dependenciesResult: DependenciesResult | null;
  providerLog:        string[];
  isStreaming?:       boolean;
  tokenUsage?:        TokenUsage[];
}): string {

  const prHtml = data.pr ? `
  <div class="pr-card">
    <div class="pr-head">
      <span class="pr-number">PR #${data.pr.number}</span>
      <span class="pr-state ${data.pr.state}">${data.pr.state.toUpperCase()}</span>
      <span class="pr-source">${data.pr.source}</span>
    </div>
    <p class="pr-title">${esc(data.pr.title)}</p>
    <p class="pr-meta">${esc(data.pr.author)} · ${esc(data.pr.branch)} → ${esc(data.pr.baseBranch)}</p>
    ${data.pr.comments.length > 0 ? `<div class="sec">Reviewer comments</div>
    ${data.pr.comments.map(c => `<div class="pr-comment"><span class="pr-comment-author">${esc(c.author)}</span><p class="pr-comment-body">${esc(c.body)}</p></div>`).join("")}` : ""}
  </div>` : "<p class='muted'>No PR context found.</p>";

  const depsHtml = data.dependenciesResult ? `
  <div class="agent-section">
    <div class="agent-head deps">Dependencies · ${data.dependenciesResult.dependencyScore}/10</div>
    <p class="summary" style="padding:8px 12px">${esc(data.dependenciesResult.summary)}</p>
    ${(data.dependenciesResult.issues ?? []).map((v: any) => `
      <div class="issue" style="border-left:3px solid ${sevColor(v.severity)};margin:6px">
        <span class="badge" style="background:${sevColor(v.severity)}22;color:${sevColor(v.severity)}">${v.severity.toUpperCase()}</span>
        <p class="idesc">${esc(v.package)} — ${esc(v.issue)}</p>
        <p class="isug">${esc(v.suggestion)}</p>
      </div>`).join("") || "<p class='muted' style='padding:8px 12px'>No dependency issues.</p>"}
  </div>` : "<p class='muted'>No package.json found.</p>";

  const styleBadge = data.styleConfig
    ? `<span class="badge-pill style-ok">Style config loaded</span>`
    : `<span class="badge-pill style-no">No style config</span>`;

  const commitsHtml = data.git.recentCommits.length > 0
    ? data.git.recentCommits.map(c =>
        `<div class="commit"><span class="chash">${esc(c.hash)}</span><span class="cdate">${esc(c.date)}</span><span class="cauthor">${esc(c.author)}</span><span class="cmsg">${esc(c.message)}</span></div>`
      ).join("")
    : "<p class='muted'>No commits found.</p>";

  const fnsHtml = data.results.map((r, i) => buildFunctionCard(r, i, data.isStreaming)).join("") || "<p class='muted'>No functions detected.</p>";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Code Reviewer</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family,sans-serif);font-size:13px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);padding:16px;line-height:1.6}
h1{font-size:15px;font-weight:600;margin-bottom:4px}
.badges{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.badge-pill{padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700}
.ver{background:#7c3aed22;color:#a78bfa}.db{background:#16a34a22;color:#4ade80}.pr-b{background:#1d4ed822;color:#60a5fa}
.style-ok{background:#16a34a22;color:#4ade80}.style-no{background:#dc262622;color:#f87171}
.groq-pill{background:#d9770615;color:#fb923c}.gemini-pill{background:#1d4ed815;color:#60a5fa}
.fp{font-size:11px;opacity:.5;margin-bottom:10px;word-break:break-all}
.git-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;padding:8px 10px;background:var(--vscode-editorWidget-background);border-radius:6px;border:1px solid var(--vscode-editorWidget-border,#333)}
.pill{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.branch{background:#1d4ed822;color:#60a5fa}.rtype{background:#7c3aed22;color:#a78bfa}
.remote-url{font-size:11px;opacity:.4;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;opacity:.5;margin:14px 0 4px}
.commit{display:grid;grid-template-columns:60px 80px 110px 1fr;gap:8px;font-size:11px;padding:4px 0;border-bottom:1px solid #ffffff08}
.chash{color:#60a5fa;font-family:monospace}.cdate,.cauthor{opacity:.5}.cmsg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-card{margin:12px 0;padding:12px;border-radius:8px;background:#1d4ed808;border:1px solid #1d4ed833}
.pr-head{display:flex;gap:8px;align-items:center;margin-bottom:6px}.pr-number{font-weight:700;color:#60a5fa}
.pr-state{padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700}
.pr-state.open{background:#16a34a22;color:#4ade80}.pr-state.closed{background:#dc262622;color:#f87171}
.pr-source{font-size:10px;opacity:.5;text-transform:uppercase}
.pr-title{font-weight:600;margin-bottom:4px}.pr-meta{font-size:11px;opacity:.5;margin-bottom:6px}
.pr-comment{padding:6px 8px;margin:4px 0;border-radius:6px;background:#ffffff05;border-left:2px solid #1d4ed844}
.pr-comment-author{font-weight:700;font-size:11px;color:#60a5fa;margin-right:8px}
.pr-comment-body{font-size:12px;margin-top:4px;opacity:.8}
.pr-insight{padding:8px 10px;border-radius:6px;background:#1d4ed810;border-left:3px solid #60a5fa;font-size:12px;color:#93c5fd}
.fn-card{margin:16px 0;padding:14px;background:var(--vscode-editorWidget-background);border-radius:8px;border:1px solid var(--vscode-editorWidget-border,#333)}
.fn-card.has-errors{border-color:#dc2626}
.fn-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.fn-name{font-weight:700;font-size:14px}
.score-pill{padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700}
.score-pill.low{background:#dc262622;color:#f87171}.score-pill.mid{background:#eab30822;color:#eab308}.score-pill.high{background:#16a34a22;color:#4ade80}
.bar{font-family:monospace;font-size:12px;color:#60a5fa;margin-bottom:8px;letter-spacing:1px}
.summary{opacity:.75;font-style:italic}.matched{font-size:12px;color:#a78bfa}
.compile-banner{padding:10px 12px;margin:8px 0;border-radius:6px;background:#dc262210;border:1px solid #dc262640}
.compile-title{font-weight:700;font-size:12px;color:#f87171;display:block;margin-bottom:4px}
.compile-err{font-size:11px;color:#fca5a5;font-family:monospace;margin:2px 0}
.agent-section{margin:10px 0;border-radius:6px;overflow:hidden;border:1px solid #ffffff10}
.agent-head{padding:8px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.agent-head.amber{background:#d9770620;color:#fb923c}.agent-head.purple{background:#7c3aed20;color:#a78bfa}
.agent-head.red{background:#dc262620;color:#f87171}.agent-head.teal{background:#0f6e5620;color:#34d399}
.agent-head.coral{background:#99390020;color:#fb923c}.agent-head.complexity{background:#6d28d920;color:#c084fc}
.agent-head.errhandle{background:#b4530020;color:#fb923c}.agent-head.duplication{background:#92400e20;color:#fbbf24}
.agent-head.deps{background:#1e3a5f20;color:#60a5fa}
.complexity-stats{display:flex;gap:8px;padding:8px 12px;flex-wrap:wrap}
.stat-box{padding:6px 12px;border-radius:6px;background:#ffffff08;text-align:center;min-width:70px}
.stat-val{display:block;font-size:18px;font-weight:700;color:#60a5fa}.stat-lbl{display:block;font-size:10px;opacity:.5;text-transform:uppercase}
.dup-warning{margin:6px;padding:8px 12px;border-radius:6px;background:#d9770620;color:#fb923c;font-size:12px;font-weight:600}
.issue{padding:10px 12px;border-radius:6px;background:#ffffff05}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700;margin-bottom:4px}
.idesc{font-weight:600;margin:2px 0}.isug{opacity:.7;font-size:12px;margin:2px 0 6px}
.code{background:#0d1117;color:#e6edf3;padding:10px 12px;border-radius:6px;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;overflow-x:auto;white-space:pre;border:1px solid #30363d}
.refactor{border-color:#4ade8044}.muted{opacity:.4;font-size:12px;font-style:italic}
hr{border:none;border-top:1px solid #ffffff0f;margin:16px 0}
.footer{opacity:.3;font-size:11px;text-align:center;margin-top:8px}
.fix-btn{padding:4px 12px;border-radius:6px;border:1px solid #16a34a55;background:#16a34a22;color:#4ade80;font-size:11px;font-weight:700;cursor:pointer}
.fix-btn:hover{background:#16a34a44}
.chat-box{min-height:40px;max-height:220px;overflow-y:auto;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:8px;margin-top:6px;font-size:12px}
.chat-input-row{display:flex;gap:6px;margin-top:6px}
.chat-input{flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:6px 10px;color:var(--vscode-editor-foreground);font-size:12px}
.chat-send{padding:6px 14px;border-radius:6px;border:none;background:#1d4ed833;color:#60a5fa;font-size:12px;font-weight:700;cursor:pointer}
.chat-msg-user{color:#60a5fa;margin-bottom:4px;font-weight:600}.chat-msg-ai{color:#e6edf3;margin-bottom:8px}.chat-thinking{color:#6b7280;font-style:italic}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.sk-section{opacity:.65;border-color:#ffffff08 !important}
.sk-head{background:#ffffff06 !important;color:#374151 !important;font-style:italic}
.sk-line{height:10px;border-radius:5px;margin:8px 12px;background:linear-gradient(90deg,#1e293b 25%,#2d3f55 50%,#1e293b 75%);background-size:200% 100%;animation:shimmer 1.4s ease-in-out infinite}
.stream-in{animation:fadeUp .35s ease-out}
.tw-cursor::after{content:"▋";animation:blink .7s step-start infinite;color:#60a5fa;font-weight:300;margin-left:1px}
.dna-warning{display:flex;gap:10px;align-items:flex-start;margin:8px;padding:10px 12px;border-radius:8px;background:#7c3aed18;border:1px solid #7c3aed55}
.dna-icon{font-size:20px;line-height:1;flex-shrink:0}.dna-bar-wrap{margin:6px 0 2px;height:6px;background:#ffffff10;border-radius:3px;overflow:hidden}
.dna-bar{height:100%;background:linear-gradient(90deg,#dc2626,#f59e0b,#7c3aed);border-radius:3px}
.dna-pct{font-size:11px;color:#a78bfa;opacity:.8}
.decay-card{margin:8px;padding:10px 12px;border-radius:8px;border:1px solid}
.decay-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.decay-level{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.decay-age{font-size:12px;font-weight:700;font-family:monospace}
.decay-bar-wrap{height:4px;background:#ffffff10;border-radius:2px;overflow:hidden;margin-bottom:6px}
.decay-bar{height:100%;border-radius:2px}
.decay-meta{font-size:11px;opacity:.8;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px}
.decay-review{font-style:italic;opacity:.7}
.dna-coaching{margin-top:8px;padding:8px 10px;border-radius:6px;background:#ffffff08;border-left:2px solid #f59e0b}
.dna-coaching-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#f59e0b;display:block;margin-bottom:4px}
.dna-coaching-list{margin:0;padding-left:16px;font-size:12px;color:#d1d5db;line-height:1.7}
.dna-coaching-list li{margin:1px 0}
.tok-card{margin:10px 0;padding:12px;border-radius:8px;background:#0f172a;border:1px solid #1e3a5f}
.tok-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#60a5fa;margin-bottom:10px}
.tok-rows{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
.tok-row{display:grid;grid-template-columns:160px 1fr 160px 70px;gap:8px;align-items:center;font-size:11px}
.tok-provider{font-family:monospace;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tok-bar-wrap{height:5px;background:#ffffff0a;border-radius:3px;overflow:hidden}
.tok-bar{height:100%;background:linear-gradient(90deg,#1d4ed8,#60a5fa);border-radius:3px}
.tok-nums{color:#6b7280;text-align:right;font-family:monospace}
.tok-total{color:#93c5fd;font-weight:700;font-family:monospace;text-align:right}
.tok-summary{display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #1e3a5f;font-size:11px;color:#6b7280}
.tok-grand{font-size:13px;font-weight:700;color:#60a5fa;font-family:monospace}
.refactor-card{margin:10px 0;border-radius:8px;border:1px solid #4ade8044;background:#0d1f0d;overflow:hidden}
.refactor-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#16a34a18;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4ade80}
.refactor-code{margin:0;border-radius:0;border:none;border-top:1px solid #4ade8022}
.refactor-copy-btn{padding:2px 10px;border-radius:6px;border:1px solid #4ade8055;background:#16a34a22;color:#4ade80;font-size:10px;font-weight:700;cursor:pointer}
.refactor-copy-btn:hover{background:#16a34a44}
.debate-card{margin:10px 0;padding:12px;border-radius:8px;background:#1e1b1308;border:1px solid #f59e0b33}
.debate-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#f59e0b;margin-bottom:10px}
.debate-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.debate-side{padding:10px;border-radius:8px;border:1px solid;background:#ffffff05}
.debate-side-head{font-size:11px;font-weight:700;margin-bottom:6px}
.debate-verdict{text-transform:uppercase;letter-spacing:.04em;opacity:.85}
.debate-opening{font-style:italic;opacity:.85;font-size:12px;margin-bottom:6px}
.debate-args{margin:0;padding-left:16px;font-size:12px;color:#d1d5db;line-height:1.6}
.debate-args li{margin:4px 0}
.debate-footer{margin-top:10px;font-size:11px;opacity:.6;text-align:center}
@media (max-width:520px){.debate-grid{grid-template-columns:1fr}}
.diff-card{margin:0 0 10px;padding:10px 12px;border-radius:8px;background:#0f172a;border:1px solid #1e3a5f}
.diff-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#60a5fa;margin-bottom:6px}
.diff-score{font-family:monospace;font-size:12px}
.diff-summary{display:flex;gap:10px;font-size:11px;font-weight:700;margin-bottom:6px}
.diff-added{color:#f87171}.diff-resolved{color:#4ade80}.diff-unchanged{color:#6b7280;font-weight:400}
.diff-cat-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px}
.diff-cat-label{opacity:.7}.diff-cat-counts{display:flex;gap:8px}
.diff-list{margin:0 0 4px;padding-left:18px;font-size:11px;opacity:.8;line-height:1.5}
.diff-list-added{color:#fca5a5}.diff-list-resolved{color:#86efac}
</style>
</head><body>
<h1>AI Code Reviewer</h1>
<div class="badges">
  <span class="badge-pill ver">v10 · 9 agents · modular</span>
  <span class="badge-pill db">${data.vectorCount} vectors</span>
  ${data.pr ? `<span class="badge-pill pr-b">PR #${data.pr.number} · ${data.pr.source}</span>` : ""}
  ${styleBadge}
  <span class="badge-pill groq-pill">Groq → security · quality · errors · tests · duplication</span>
  <span class="badge-pill gemini-pill">Gemini → style · complexity · docs · dependencies</span>
</div>
<p class="fp">${esc(data.file)}</p>
<div class="git-bar">
  <span class="pill branch">🌿 ${esc(data.git.branch || "unknown")}</span>
  <span class="pill rtype">${esc(data.git.remoteType)}</span>
  ${data.git.remote ? `<span class="remote-url">${esc(data.git.remote)}</span>` : ""}
</div>
<div class="sec">Code quality dashboard</div>
${buildDashboard(data.scores)}
<hr>
<div class="sec">Provider routing</div>
${buildProviderLog(data.providerLog)}
${data.tokenUsage?.length ? buildTokenUsageHtml(data.tokenUsage) : ""}
<hr>
<div class="sec">Git history</div>
${commitsHtml}
<hr>
<div class="sec">Pull request context</div>
${prHtml}
<hr>
<div class="sec">Dependencies</div>
${depsHtml}
<hr>
<div class="sec">Functions — 9 agents</div>
${fnsHtml}
<hr>
<p class="footer">AI Code Reviewer · Groq Llama 3.3 70B + Gemini 2.0 Flash · 9 agents · modular architecture</p>
<script>
const vscode = acquireVsCodeApi();
function applyFix(fnName,fnId){const el=document.getElementById('refactor-'+fnId);if(!el)return;vscode.postMessage({type:'applyFix',fnName,refactoredCode:el.value});}
function copyRefactor(cardId){const el=document.getElementById('refactor-code-'+cardId);if(!el)return;navigator.clipboard.writeText(el.textContent||'').then(()=>{const btn=el.closest('.refactor-card')?.querySelector('.refactor-copy-btn');if(btn){btn.textContent='Copied!';setTimeout(()=>{btn.textContent='Copy';},1500);}});}
function sendChat(fnId){
  const input=document.getElementById('input-'+fnId);
  const chatBox=document.getElementById('chat-'+fnId);
  const codeEl=document.getElementById('code-'+fnId);
  if(!input||!chatBox||!codeEl)return;
  const question=input.value.trim();if(!question)return;input.value='';
  const um=document.createElement('p');um.className='chat-msg-user';um.textContent='You: '+question;chatBox.appendChild(um);
  const th=document.createElement('p');th.className='chat-thinking';th.id='thinking-'+fnId;th.textContent='AI is thinking...';chatBox.appendChild(th);
  chatBox.scrollTop=chatBox.scrollHeight;
  vscode.postMessage({type:'chat',fnCode:codeEl.value,question,chatBoxId:'chat-'+fnId,thinkingId:'thinking-'+fnId});
}
function runTypewriter(container){
  if(!container)return;
  container.querySelectorAll('.tw').forEach(el=>{
    const full=el.textContent||'';
    el.textContent='';
    el.classList.add('tw-cursor');
    let i=0;
    const spd=Math.max(6,Math.min(22,1600/Math.max(full.length,1)));
    const tick=()=>{
      if(i<full.length){el.textContent+=full[i++];setTimeout(tick,spd);}
      else{el.classList.remove('tw-cursor');}
    };
    setTimeout(tick,60);
  });
}
window.addEventListener('message',event=>{
  const msg=event.data;
  if(msg.type==='chatResponse'){
    const th=document.getElementById(msg.thinkingId);if(th)th.remove();
    const cb=document.getElementById(msg.chatBoxId);
    if(cb){const am=document.createElement('p');am.className='chat-msg-ai';am.textContent='AI: '+msg.response;cb.appendChild(am);cb.scrollTop=cb.scrollHeight;}
  }
  if(msg.type==='streamSection'&&msg.id&&msg.html){
    const el=document.getElementById(msg.id);
    if(el){
      el.outerHTML=msg.html;
      const fresh=document.getElementById(msg.id);
      if(fresh){fresh.classList.add('stream-in');runTypewriter(fresh);}
    }
  }
  if(msg.type==='streamScore'){
    const pill=document.getElementById(msg.pillId);
    if(pill){pill.textContent=msg.score+'/10';pill.className='score-pill '+(msg.score<=4?'low':msg.score<=7?'mid':'high');}
    const bar=document.getElementById(msg.barId);
    if(bar)bar.textContent=msg.bar;
  }
});
</script>
</body></html>`;
}