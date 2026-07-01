import type {
  GitContext, PRContext, StyleConfig, ScoreRecord,
  PageResult, DependenciesResult, TokenUsage, RateLimitEntry, DebateResult, DiffReview,
} from "../pipeline/types";

// ── HTML escape ───────────────────────────────────────────────────
function esc(str: string): string {
  return (str ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

function sevColor(s: string): string {
  if (s === "critical") { return "#dc2626"; }
  if (s === "high")     { return "#ea580c"; }
  if (s === "error")    { return "#f97316"; }
  if (s === "warning")  { return "#eab308"; }
  return "#60a5fa";
}

// ── Score ring (SVG) ──────────────────────────────────────────────
function ring(score: number, id: string): string {
  const r = 22;
  const c = +(2 * Math.PI * r).toFixed(2);
  const offset = +(c * (1 - Math.max(0, Math.min(10, score)) / 10)).toFixed(2);
  const col = score <= 0 ? "#374151" : score <= 4 ? "#f87171" : score <= 7 ? "#eab308" : "#4ade80";
  const label = score > 0 ? String(score) : "…";
  return `<svg id="${id}" width="56" height="56" viewBox="0 0 56 56">
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="#ffffff12" stroke-width="4"/>
    <circle cx="28" cy="28" r="${r}" fill="none" stroke="${col}" stroke-width="4"
      stroke-dasharray="${c}" stroke-dashoffset="${offset}"
      transform="rotate(-90 28 28)" stroke-linecap="round"
      style="transition:stroke-dashoffset .5s ease,stroke .5s ease"/>
    <text x="28" y="33" text-anchor="middle" fill="${col}" font-size="13" font-weight="700">${label}</text>
  </svg>`;
}


// ── Language class from file extension ────────────────────────────
function langClass(file: string): string {
  if (file.endsWith(".ts") || file.endsWith(".tsx")) { return "language-typescript"; }
  if (file.endsWith(".js") || file.endsWith(".jsx")) { return "language-javascript"; }
  if (file.endsWith(".py"))   { return "language-python"; }
  if (file.endsWith(".go"))   { return "language-go"; }
  if (file.endsWith(".java")) { return "language-java"; }
  return "language-plaintext";
}

// ── Token usage card ─────────────────────────────────────────────
function fmtRetry(ms: number): string {
  if (!ms) { return "unknown wait"; }
  const s = Math.ceil(ms / 1000);
  if (s < 60)   { return `${s}s`; }
  if (s < 3600) { return `${Math.floor(s/60)}m ${s%60}s`; }
  const h = Math.floor(s/3600); const m = Math.floor((s%3600)/60);
  return `${h}h ${m}m`;
}

function buildTokenUsageHtml(usage: TokenUsage[], rateLimits?: RateLimitEntry[]): string {
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
  const rlSection = rateLimits?.length ? `
    <div class="tok-rl-head">Rate limits hit this run</div>
    ${rateLimits.map(r => `<div class="tok-rl-row">
      <span class="tok-rl-badge">${esc(r.provider)}</span>
      <span class="tok-rl-agent">${esc(r.agent)}</span>
      <span class="tok-rl-wait">retry in ${fmtRetry(r.retryAfterMs)}</span>
    </div>`).join("")}` : "";
  return `<div class="tok-card">
    <div class="tok-head">📊 Token usage · this run</div>
    <div class="tok-rows">${rows}</div>
    <div class="tok-summary">
      <span>Total</span>
      <span>${fmt(totalPrompt)} prompt + ${fmt(totalCompl)} completion</span>
      <span class="tok-grand">${fmt(totalAll)} tokens</span>
    </div>
    ${rlSection}
  </div>`;
}

// ── Two Agents Debate card ─────────────────────────────────────────
function buildDebateCardHtml(debate: DebateResult, sid: string): string {
  const side = (label: string, icon: string, color: string, s: DebateResult["strictEngineer"]) => `
    <div class="debate-side" style="border-color:${color}44">
      <div class="debate-side-head" style="color:${color}">${icon} ${label} — <span class="debate-verdict">${esc(s.verdict)}</span></div>
      <p class="debate-opening">${esc(s.openingStatement)}</p>
      <ul class="debate-args">
        ${(s.arguments ?? []).map(a => `<li><strong>${esc(a.issue)}</strong> — ${esc(a.reasoning)}</li>`).join("")}
      </ul>
    </div>`;
  return `<details id="${sid}" class="agent-section agent-details" open>
    <summary class="agent-head" style="background:#f59e0b18;color:#f59e0b">${agentIcon(SVG.scales)} Two Agents Debate</summary>
    <div class="agent-body">
      <p style="font-size:11px;opacity:.5;padding:6px 12px">Borderline score — hear both sides</p>
      <div class="debate-grid">
        ${side("Strict Senior Engineer", "🛑", "#f87171", debate.strictEngineer)}
        ${side("Pragmatic Developer",    "✅", "#4ade80", debate.pragmaticDeveloper)}
      </div>
      <p class="debate-footer">Your call — weigh both sides against your deadline and blast radius.</p>
    </div>
  </details>`;
}

// ── Diff-aware re-review card ──────────────────────────────────────
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
  const colors   = ["#60a5fa","#E08040","#4ade80","#f97316","#eab308","#f472b6","#34d399","#fb923c","#e879f9"];
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
  return `<div style="padding:8px 0;display:flex;flex-wrap:wrap;gap:6px">
    ${log.map(l => {
      const isGroq = l.includes("Groq") && l.includes("fulfilled");
      const isFail = l.includes("failed") || l.includes("rejected");
      const col = isFail ? "#f87171" : isGroq ? "#fb923c" : "#60a5fa";
      const bg  = isFail ? "#dc262615" : isGroq ? "#d9770615" : "#1d4ed815";
      return `<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${bg};color:${col};font-family:monospace">${esc(l)}</span>`;
    }).join("")}
  </div>`;
}

// ── Loading skeleton ──────────────────────────────────────────────
function loadingSection(label: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : "";
  return `<div class="agent-section sk-section"${idAttr}>
    <div class="agent-head sk-head">⟳ ${label} — analyzing…</div>
    <div class="sk-line"></div>
    <div class="sk-line" style="width:68%"></div>
    <div class="sk-line" style="width:50%"></div>
  </div>`;
}

// ── Issue row builder (shared) ────────────────────────────────────
function issueRows(issues: any[], color?: string): string {
  return (issues ?? []).map((iss: any) => {
    const desc = iss.description ?? iss.message ?? iss.text ?? iss.detail ?? iss.rule ?? "";
    const sug  = iss.suggestion  ?? iss.fix ?? iss.recommendation ?? "";
    const code = iss.fixedCode   ?? iss.fixed_code ?? "";
    const sev  = (iss.severity   ?? iss.level ?? "info").toUpperCase();
    const c    = color ?? sevColor(iss.severity ?? iss.level ?? "info");
    if (!desc && !sug && !code) { return ""; }
    return `<div class="issue" style="border-left:3px solid ${c}">
      <span class="badge" style="background:${c}22;color:${c}">${esc(sev)}</span>
      ${desc ? `<p class="idesc">${esc(desc)}</p>` : ""}
      ${sug  ? `<p class="isug">${esc(sug)}</p>`  : ""}
      ${code && code.length > 10 ? `<pre class="code"><code>${esc(code)}</code></pre>` : ""}
    </div>`;
  }).join("") || "<p class='muted' style='padding:8px 12px'>No issues found.</p>";
}

// ── Per-section streaming patch ───────────────────────────────────
export function buildStreamSection(section: string, result: any, fnId: string): string {
  const sid = `sec-${section}-${fnId}`;
  const tw  = (text: string) =>
    `<p class="summary tw" style="padding:8px 12px">${esc(text ?? "")}</p>`;

  switch (section) {
    case "security":
      if (result?.securityScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head red">Security · ${result.securityScore}/10</summary>
        <div class="agent-body">${tw(result.summary)}${issueRows(result.vulnerabilities ?? [])}</div>
      </details>`;

    case "quality":
      if (result?.score === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head amber">Quality · ${result.score}/10</summary>
        <div class="agent-body">${tw(result.summary)}${issueRows(result.issues ?? [])}</div>
      </details>`;

    case "refactor":
      if (!result) { return `<div id="${sid}"></div>`; }
      return `<div id="${sid}" class="refactor-card">
        <div class="refactor-head">
          <span>✦ Suggested refactor</span>
          <button class="refactor-copy-btn" onclick="copyRefactor('${sid}')">Copy</button>
        </div>
        <pre class="code refactor-code" id="refactor-code-${sid}"><code>${esc(result)}</code></pre>
      </div>`;

    case "errorHandling":
      if (result?.errorHandlingScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head errhandle">Error handling · ${result.errorHandlingScore}/10</summary>
        <div class="agent-body">${tw(result.summary)}${issueRows(result.issues ?? [])}</div>
      </details>`;

    case "complexity":
      if (result?.complexityScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head complexity">Complexity · ${result.complexityScore}/10</summary>
        <div class="agent-body">
          ${tw(result.summary)}
          <div class="complexity-stats">
            <div class="stat-box"><span class="stat-val">${result.cyclomaticComplexity ?? "?"}</span><span class="stat-lbl">Cyclomatic</span></div>
            <div class="stat-box"><span class="stat-val">${esc(String(result.cognitiveComplexity ?? "?"))}</span><span class="stat-lbl">Cognitive</span></div>
            <div class="stat-box"><span class="stat-val">${result.linesOfCode ?? "?"}</span><span class="stat-lbl">Lines</span></div>
            <div class="stat-box"><span class="stat-val">${result.maxNestingDepth ?? "?"}</span><span class="stat-lbl">Max depth</span></div>
            <div class="stat-box"><span class="stat-val">${result.parameterCount ?? "?"}</span><span class="stat-lbl">Params</span></div>
          </div>
          ${issueRows(result.issues ?? [], "#8b5cf6")}
        </div>
      </details>`;

    case "style":
      if (result?.styleScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head purple">Style · ${result.styleScore}/10</summary>
        <div class="agent-body">${tw(result.summary)}${issueRows(result.violations ?? [], "#E08040")}</div>
      </details>`;

    case "duplication":
      if (result?.duplicationScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head duplication">Duplication · ${result.duplicationScore}/10</summary>
        <div class="agent-body">
          ${tw(result.summary)}
          ${result.isDuplicate ? `<div class="dup-warning">Duplicate detected — ${result.similarityPercent}% similar</div>` : ""}
          ${issueRows(result.issues ?? [], "#f59e0b")}
        </div>
      </details>`;

    case "docs":
      if (result?.hasAdequateDocs === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head coral">Docs · ${result.hasAdequateDocs ? "Adequate" : "Missing"}</summary>
        <div class="agent-body">
          ${tw(result.summary)}
          ${result.jsdocBlock ? `<pre class="code" style="margin:4px 8px 8px"><code>${esc(result.jsdocBlock)}</code></pre>` : ""}
        </div>
      </details>`;

    case "tests":
      if (result?.testCount === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head teal">Tests · ${result.testCount} generated</summary>
        <div class="agent-body">
          ${tw(result.summary)}
          ${result.testCode ? `<pre class="code" style="margin:4px 8px 8px"><code>${esc(result.testCode)}</code></pre>` : ""}
        </div>
      </details>`;

    case "dependencies":
      if (result?.dependencyScore === undefined) { return ""; }
      return `<details id="${sid}" class="agent-section agent-details" open>
        <summary class="agent-head deps">Dependencies · ${result.dependencyScore}/10</summary>
        <div class="agent-body">${tw(result.summary)}${issueRows(result.issues ?? [])}</div>
      </details>`;

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

// ── Shared issue list renderer ────────────────────────────────────
function issueList(issues: any[], lang = "language-typescript", color?: string): string {
  const rows = issues.map((iss: any) => {
    const desc = iss.description ?? iss.message ?? iss.text ?? iss.detail ?? iss.rule ?? iss.issue ?? "";
    const sug  = iss.suggestion  ?? iss.fix ?? iss.recommendation ?? iss.action ?? "";
    const code = iss.fixedCode   ?? iss.fixed_code ?? iss.fixCode ?? "";
    const sev  = (iss.severity   ?? iss.level ?? "info").toUpperCase();
    const c    = color ?? sevColor(iss.severity ?? iss.level ?? "info");
    if (!desc && !sug && !code) { return ""; }
    return `<div class="issue" style="border-left:3px solid ${c}">
      <span class="badge" style="background:${c}22;color:${c}">${esc(sev)}</span>
      ${desc ? `<p class="idesc">${esc(desc)}</p>` : ""}
      ${sug  ? `<p class="isug">${esc(sug)}</p>`   : ""}
      ${code && code.length > 10 ? `<pre class="code"><code class="${lang}">${esc(code)}</code></pre>` : ""}
    </div>`;
  }).join("");
  return rows || "<p class='muted' style='padding:8px 12px'>No issues found.</p>";
}

// ── Shared DNA / Decay builders ───────────────────────────────────
function buildDnaHtml(analysis: any): string {
  if (!analysis.dnaMismatch) { return ""; }
  const dna      = analysis.dnaMismatch;
  const building = dna.similarity === 0 && dna.isMatch;
  const border   = building ? "#6b7280" : dna.isMatch ? "#16a34a" : "#dc2626";
  const bg       = building ? "#ffffff08" : dna.isMatch ? "#16a34a15" : "#dc262615";
  const label    = building ? "🧬 Building DNA Fingerprint"
                 : dna.isMatch ? "🧬 Code DNA Match ✓" : "🧬 Code DNA Mismatch";
  const barColor = dna.isMatch
    ? "linear-gradient(90deg,#16a34a,#4ade80)"
    : "linear-gradient(90deg,#dc2626,#f59e0b,#7c3aed)";
  const pctLine  = building
    ? `<span class="dna-pct" style="color:#9ca3af">${esc(dna.message)}</span>`
    : `<div class="dna-bar-wrap"><div class="dna-bar" style="width:${dna.similarity}%;background:${barColor}"></div></div>
       <span class="dna-pct" style="color:${border}">${dna.similarity}% match with ${esc(dna.author)}'s historical style</span>`;
  const coaching = (dna.coachingNotes?.length)
    ? `<div class="dna-coaching"><span class="dna-coaching-title">Style coaching</span>
       <ul class="dna-coaching-list">${dna.coachingNotes.map((n: string) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "";
  return `<div class="dna-warning" style="border-color:${border};background:${bg}">
    <span class="dna-icon">🧬</span>
    <div style="flex:1"><strong style="color:${border}">${label}</strong> — ${esc(dna.message)}
    ${pctLine}${coaching}</div></div>`;
}

function buildDecayHtml(analysis: any): string {
  if (!analysis.temporalDecay) { return ""; }
  const td  = analysis.temporalDecay;
  const colors: Record<string, { border: string; text: string }> = {
    fresh:   { border: "#16a34a", text: "#4ade80" },
    aging:   { border: "#eab308", text: "#facc15" },
    stale:   { border: "#f97316", text: "#fb923c" },
    decayed: { border: "#dc2626", text: "#f87171" },
  };
  const c      = colors[td.decayLevel] ?? colors.fresh;
  const barPct = Math.min(100, Math.round((td.ageInDays / 365) * 100));
  const revLine = td.lastReviewedDate ? `Last reviewed ${td.daysSinceReview}d ago` : "Never AI-reviewed";
  return `<div class="decay-card" style="border-color:${c.border};background:${c.border}12">
    <div class="decay-header">
      <span class="decay-level" style="color:${c.text}">⏰ ${td.decayLevel} code</span>
      <span class="decay-age"   style="color:${c.text}">${td.ageInDays}d old · ${td.lastModifiedDate.slice(0,10)}</span>
    </div>
    <div class="decay-bar-wrap"><div class="decay-bar" style="width:${barPct}%;background:${c.border}"></div></div>
    <div class="decay-meta"><span>${esc(td.decayMessage)}</span><span class="decay-review">${revLine}</span></div>
  </div>`;
}

// ── fn block header (shared) ──────────────────────────────────────
function fnBlockHead(name: string, score: number, extra = ""): string {
  const col = !score ? "#6b7280" : score <= 4 ? "#f87171" : score <= 7 ? "#eab308" : "#28a745";
  return `<div class="fn-block-head">
    <span class="fn-block-name">⚙ ${esc(name)}</span>
    <span class="fn-block-score" style="color:${col};background:${col}18;border:1px solid ${col}30">${score || "?"}/10</span>
    ${extra}
  </div>`;
}

// ── Security tab: per-function block ─────────────────────────────
function buildFnSecBlock(r: PageResult, idx: number, streaming = false, lang = "language-typescript"): string {
  const { analysis, fnInfo, code } = r;
  const fnId = `fn_${idx}`;
  const sid  = (s: string) => `sec-${s}-${fnId}`;

  const bestFix = analysis.quality?.refactoredFunction
    || analysis.errorHandling?.issues?.find((i: any) => i.fixedCode)?.fixedCode || null;

  const reviewLines = [`Overall score: ${analysis.overallScore}/10`];
  if (analysis.security?.summary) { reviewLines.push(`Security: ${analysis.security.summary}`); }
  (analysis.security?.vulnerabilities ?? []).slice(0, 2).forEach((v: any) => {
    if (v.description) { reviewLines.push(`- [security/${v.severity}] ${v.description}`); }
  });

  const checklistHtml = (analysis.security?.checkedItems ?? []).length > 0 ? (() => {
    const items  = analysis.security!.checkedItems!;
    const passed = items.filter((i: string) => i.includes(": PASS")).length;
    const failed = items.filter((i: string) => i.includes(": FAIL")).length;
    const rows   = items.map((item: string) => {
      const isFail = item.includes(": FAIL");
      const col    = isFail ? "#f87171" : "#4ade80";
      return `<div style="display:flex;gap:6px;padding:2px 0;font-size:11px;font-family:monospace">
        <span style="color:${col};width:14px;flex-shrink:0">${isFail ? "✗" : "✓"}</span>
        <span style="color:${isFail ? col : "#6b7280"}">${esc(item)}</span></div>`;
    }).join("");
    return `<details style="margin:4px 8px 8px">
      <summary style="cursor:pointer;font-size:11px;color:#6b7280;user-select:none;padding:4px 0">
        Checklist — ${passed} passed · <span style="color:#f87171">${failed} failed</span>
      </summary>
      <div style="padding:6px 10px;background:#0d1117;border-radius:6px;margin-top:4px">${rows}</div>
    </details>`;
  })() : "";

  const securityHtml = analysis.security
    ? `<details id="${sid("security")}" class="agent-details" open>
        <summary class="red">${agentIcon(SVG.shield)} Security · ${analysis.security.securityScore}/10</summary>
        <div class="agent-body">
          <p class="summary" style="padding:8px 12px">${esc(analysis.security.summary)}</p>
          ${checklistHtml}${issueList(analysis.security.vulnerabilities ?? [], lang)}
        </div>
      </details>`
    : (streaming ? loadingSection("Security", sid("security")) : "");

  const diffReviewHtml = analysis.diffReview
    ? buildDiffReviewHtml(analysis.diffReview, sid("diffReview"))
    : (streaming ? `<div id="${sid("diffReview")}"></div>` : "");

  const debateHtml = analysis.debate
    ? buildDebateCardHtml(analysis.debate, sid("debate"))
    : (streaming ? `<div id="${sid("debate")}"></div>` : "");

  const compileHtml = analysis.compileErrors.length > 0
    ? `<div class="compile-banner">
        <span class="compile-title">Compile errors (${analysis.compileErrors.length})</span>
        ${analysis.compileErrors.map((e: any) => `<div class="compile-err">Line ${e.line}: ${esc(e.message)}</div>`).join("")}
      </div>` : "";

  return `<div class="fn-block${analysis.compileErrors.length > 0 ? " has-errors" : ""}">
    <textarea id="refactor-${fnId}" style="display:none">${esc(bestFix ?? "")}</textarea>
    <textarea id="code-${fnId}"     style="display:none">${esc(code)}</textarea>
    <textarea id="review-${fnId}"   style="display:none">${esc(reviewLines.join("\n"))}</textarea>
    <span     id="score-pill-${fnId}" style="display:none"></span>
    <div      id="bar-${fnId}"        style="display:none"></div>
    <div      id="ring-wrap-${fnId}"  style="display:none">${ring(analysis.overallScore, `ring-${fnId}`)}</div>
    ${fnBlockHead(fnInfo.name, analysis.overallScore)}
    ${buildDnaHtml(analysis)}
    ${buildDecayHtml(analysis)}
    ${compileHtml}${diffReviewHtml}${securityHtml}${debateHtml}
  </div>`;
}

// ── Per-agent tab block (one agent, one function) ─────────────────
function buildFnSection(r: PageResult, idx: number, agent: string, streaming = false, lang = "language-typescript"): string {
  const { analysis, fnInfo } = r;
  const fnId = `fn_${idx}`;
  const sid  = (s: string) => `sec-${s}-${fnId}`;
  let body = "";

  switch (agent) {
    case "quality": {
      const bestFix = analysis.quality?.refactoredFunction
        || analysis.errorHandling?.issues?.find((i: any) => i.fixedCode)?.fixedCode || null;
      const autoFixBtn = bestFix
        ? `<button class="fix-btn" onclick="applyFix('${esc(fnInfo.name)}','${fnId}',${fnInfo.start},${fnInfo.end})">⚡ Apply fix</button>`
        : "";
      const qHtml = analysis.quality
        ? `<details id="${sid("quality")}" class="agent-details" open>
            <summary class="amber">${agentIcon(SVG.verified)} Quality · ${analysis.quality.score}/10</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.quality.summary)}</p>
              ${analysis.quality.prInsight ? `<div class="pr-insight" style="margin:0 8px 8px">PR insight: ${esc(analysis.quality.prInsight)}</div>` : ""}
              ${analysis.quality.matchedTemplate ? `<p class="matched" style="padding:0 12px 8px">Matched template: ${esc(analysis.quality.matchedTemplate)}</p>` : ""}
              ${issueList(analysis.quality.issues ?? [], lang)}
            </div>
          </details>`
        : (streaming ? loadingSection("Quality", sid("quality")) : "");
      return `<div class="fn-block">${fnBlockHead(fnInfo.name, analysis.overallScore, autoFixBtn)}${qHtml}</div>`;
    }
    case "refactor": {
      const bestFix = analysis.quality?.refactoredFunction
        || analysis.errorHandling?.issues?.find((i: any) => i.fixedCode)?.fixedCode || null;
      const autoFixBtn = bestFix
        ? `<button class="fix-btn" onclick="applyFix('${esc(fnInfo.name)}','${fnId}',${fnInfo.start},${fnInfo.end})">⚡ Apply fix</button>`
        : "";
      const refactorCode = analysis.quality?.refactoredFunction ?? null;
      const refactorHtml = refactorCode
        ? `<div id="${sid("refactor")}" class="refactor-card">
            <div class="refactor-head">
              <span>✦ Suggested refactor</span>
              <button class="refactor-copy-btn" onclick="copyRefactor('${sid("refactor")}')">Copy</button>
            </div>
            <pre class="code refactor-code" id="refactor-code-${sid("refactor")}"><code class="${lang}">${esc(refactorCode)}</code></pre>
          </div>`
        : (streaming ? `<div id="${sid("refactor")}"></div>` : "<p class='muted' style='padding:16px'>No refactor suggestion available.</p>");
      return `<div class="fn-block">${fnBlockHead(fnInfo.name, analysis.overallScore, autoFixBtn)}${refactorHtml}</div>`;
    }
    case "errorHandling":
      body = analysis.errorHandling
        ? `<details id="${sid("errorHandling")}" class="agent-details" open>
            <summary class="errhandle">${agentIcon(SVG.warning)} Error handling · ${analysis.errorHandling.errorHandlingScore}/10</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.errorHandling.summary)}</p>
              ${issueList(analysis.errorHandling.issues ?? [], lang)}
            </div>
          </details>`
        : (streaming ? loadingSection("Error handling", sid("errorHandling")) : "");
      break;
    case "complexity":
      body = analysis.complexity
        ? `<details id="${sid("complexity")}" class="agent-details" open>
            <summary class="complexity">${agentIcon(SVG.tree)} Complexity · ${analysis.complexity.complexityScore}/10</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.complexity.summary)}</p>
              <div class="complexity-stats">
                <div class="stat-box"><span class="stat-val">${analysis.complexity.cyclomaticComplexity}</span><span class="stat-lbl">Cyclomatic</span></div>
                <div class="stat-box"><span class="stat-val">${esc(analysis.complexity.cognitiveComplexity)}</span><span class="stat-lbl">Cognitive</span></div>
                <div class="stat-box"><span class="stat-val">${analysis.complexity.linesOfCode}</span><span class="stat-lbl">Lines</span></div>
                <div class="stat-box"><span class="stat-val">${analysis.complexity.maxNestingDepth}</span><span class="stat-lbl">Max depth</span></div>
                <div class="stat-box"><span class="stat-val">${analysis.complexity.parameterCount}</span><span class="stat-lbl">Params</span></div>
              </div>
              ${issueList(analysis.complexity.issues ?? [], lang, "#8b5cf6")}
            </div>
          </details>`
        : (streaming ? loadingSection("Complexity", sid("complexity")) : "");
      break;
    case "style":
      body = analysis.style
        ? `<details id="${sid("style")}" class="agent-details" open>
            <summary class="purple">${agentIcon(SVG.palette)} Style · ${analysis.style.styleScore}/10</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.style.summary)}</p>
              ${issueList(analysis.style.violations ?? [], lang, "#E08040")}
            </div>
          </details>`
        : (streaming ? loadingSection("Style", sid("style")) : "");
      break;
    case "duplication":
      body = analysis.duplication
        ? `<details id="${sid("duplication")}" class="agent-details" open>
            <summary class="duplication">${agentIcon(SVG.layers)} Duplication · ${analysis.duplication.duplicationScore}/10</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.duplication.summary)}</p>
              ${analysis.duplication.isDuplicate ? `<div class="dup-warning">Duplicate detected — ${analysis.duplication.similarityPercent}% similar</div>` : ""}
              ${issueList(analysis.duplication.issues ?? [], lang, "#f59e0b")}
            </div>
          </details>`
        : (streaming ? loadingSection("Duplication", sid("duplication")) : "");
      break;
    case "docs":
      body = analysis.docs
        ? `<details id="${sid("docs")}" class="agent-details" open>
            <summary class="coral">${agentIcon(SVG.fileText)} Docs · ${analysis.docs.hasAdequateDocs ? "Adequate" : "Missing"}</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.docs.summary)}</p>
              ${analysis.docs.jsdocBlock ? `<pre class="code" style="margin:4px 8px 8px"><code>${esc(analysis.docs.jsdocBlock)}</code></pre>` : ""}
            </div>
          </details>`
        : (streaming ? loadingSection("Docs", sid("docs")) : "");
      break;
    case "tests":
      body = analysis.tests
        ? `<details id="${sid("tests")}" class="agent-details" open>
            <summary class="teal">${agentIcon(SVG.flask)} Tests · ${analysis.tests.testCount} generated</summary>
            <div class="agent-body">
              <p class="summary" style="padding:8px 12px">${esc(analysis.tests.summary)}</p>
              ${analysis.tests.testCode ? `<pre class="code" style="margin:4px 8px 8px"><code class="${lang}">${esc(analysis.tests.testCode)}</code></pre>` : ""}
            </div>
          </details>`
        : (streaming ? loadingSection("Tests", sid("tests")) : "");
      break;
    default: return "";
  }

  return `<div class="fn-block">${fnBlockHead(fnInfo.name, analysis.overallScore)}${body}</div>`;
}

// ── Stitch SVG icons (no CDN) ─────────────────────────────────────
const SVG = {
  bug:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 10h1a1 1 0 0 1 0 8h-1M5 10H4a1 1 0 0 0 0 8h1M8 6c0-2 1.5-4 4-4s4 2 4 4"/><path d="M12 6v2M8 22v-2M16 22v-2"/></svg>`,
  shield:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  verified: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  tree:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6M13 6h3a2 2 0 0 1 2 2v7"/></svg>`,
  palette:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/></svg>`,
  git:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>`,
  info:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  send:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>`,
  export:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  warning:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  layers:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  flask:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M9 3h6M9 3v7l-4.5 8.5A2 2 0 0 0 6.26 21h11.48a2 2 0 0 0 1.76-2.5L15 10V3"/></svg>`,
  package:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  scales:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><line x1="12" y1="3" x2="12" y2="20"/><path d="M5 20h14"/><path d="M5 9l-3 5h6L5 9zM19 9l-3 5h6l-3-5z"/></svg>`,
  wand:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="18" height="18"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5M12.2 11.8 11 13M3 21 12.2 11.8"/><circle cx="15" cy="9" r="2"/></svg>`,
};

function agentIcon(svg: string): string {
  return svg.replace(/width="18" height="18"/, 'width="14" height="14"');
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
  rateLimits?:        RateLimitEntry[];
}): string {

  const lc = langClass(data.file);

  // ── Overview score averages ──────────────────────────────────────
  const avg = (arr: number[]) => arr.length
    ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10
    : 0;
  const secScores  = data.results.map(r => r.analysis.security?.securityScore    ?? 0).filter(Boolean);
  const qualScores = data.results.map(r => r.analysis.quality?.score             ?? 0).filter(Boolean);
  const cplScores  = data.results.map(r => r.analysis.complexity?.complexityScore ?? 0).filter(Boolean);
  const styScores  = data.results.map(r => r.analysis.style?.styleScore          ?? 0).filter(Boolean);


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
    <div class="agent-head deps">${agentIcon(SVG.package)} Dependencies · ${data.dependenciesResult.dependencyScore}/10</div>
    <p class="summary" style="padding:8px 12px">${esc(data.dependenciesResult.summary)}</p>
    ${(data.dependenciesResult.issues ?? []).map((v: any) => `
      <div class="issue" style="border-left:3px solid ${sevColor(v.severity)}">
        <span class="badge" style="background:${sevColor(v.severity)}22;color:${sevColor(v.severity)}">${v.severity.toUpperCase()}</span>
        <p class="idesc">${esc(v.package)} — ${esc(v.issue)}</p>
        <p class="isug">${esc(v.suggestion)}</p>
      </div>`).join("") || "<p class='muted' style='padding:8px 12px'>No dependency issues.</p>"}
  </div>` : "<p class='muted'>No package.json found.</p>";

  const commitsHtml = data.git.recentCommits.length > 0
    ? data.git.recentCommits.map(c =>
        `<div class="commit"><span class="chash">${esc(c.hash)}</span><span class="cdate">${esc(c.date)}</span><span class="cauthor">${esc(c.author)}</span><span class="cmsg">${esc(c.message)}</span></div>`
      ).join("")
    : "<p class='muted'>No commits found.</p>";

  const noFns = "<p class='muted'>No functions detected.</p>";
  const mkTab = (agent: string) =>
    data.results.map((r, i) => buildFnSection(r, i, agent, data.isStreaming, lc)).join("") || noFns;

  const secFnsHtml        = data.results.map((r, i) => buildFnSecBlock(r, i, data.isStreaming, lc)).join("") || noFns;
  const qualFnsHtml       = mkTab("quality");
  const refactorFnsHtml   = mkTab("refactor");
  const errorFnsHtml      = mkTab("errorHandling");
  const complexityFnsHtml = mkTab("complexity");
  const styleFnsHtml      = mkTab("style");
  const dupFnsHtml        = mkTab("duplication");
  const docsFnsHtml       = mkTab("docs");
  const testsFnsHtml      = mkTab("tests");

  const commitFunctions = data.results.map(r => ({
    name:  r.fnInfo.name,
    score: r.analysis.overallScore,
    issues: [
      ...(r.analysis.quality?.issues?.slice(0, 2).map((i: any) => i.title ?? i.description ?? "") ?? []),
      ...(r.analysis.security?.vulnerabilities?.slice(0, 1).map((v: any) => v.title ?? v.description ?? "") ?? []),
      ...(r.analysis.errorHandling?.issues?.slice(0, 1).map((i: any) => i.title ?? i.description ?? "") ?? []),
    ].filter(Boolean),
  }));
  const commitDataJson = JSON.stringify({ file: data.file, functions: commitFunctions })
    .replace(/<\//g, "<\\/");

  // ── Score card helpers ────────────────────────────────────────────
  const scoreCol = (s: number) => !s ? "#6b7280" : s <= 4 ? "#f87171" : s <= 7 ? "#eab308" : "#28a745";

  function bigScoreCard(label: string, score: number, icon: string, bullets: string[]): string {
    const col = scoreCol(score);
    const bulletHtml = bullets.length
      ? `<ul class="sc-bullets">${bullets.slice(0, 3).map(b => `<li>${esc(b)}</li>`).join("")}</ul>`
      : `<p class="sc-empty">No issues found</p>`;
    return `<div class="sc-card" style="border-top:3px solid ${col}">
      <div class="sc-top">
        <span class="sc-label">${label}</span>
        <span class="sc-icon" style="color:${col}">${icon}</span>
      </div>
      <div class="sc-num" style="color:${col}">${score || "—"}<span class="sc-denom">/10</span></div>
      ${bulletHtml}
    </div>`;
  }

  const secBullets  = data.results.flatMap(r => (r.analysis.security?.vulnerabilities  ?? []).map((v: any) => v.description).filter(Boolean));
  const qualBullets = data.results.flatMap(r => (r.analysis.quality?.issues            ?? []).map((i: any) => i.description).filter(Boolean));
  const cplBullets  = data.results.flatMap(r => (r.analysis.complexity?.issues         ?? []).map((i: any) => i.description ?? r.analysis.complexity?.summary).filter(Boolean));
  const styBullets  = data.results.flatMap(r => (r.analysis.style?.violations          ?? []).map((v: any) => v.description).filter(Boolean));
  const cplFallback = cplBullets.length ? cplBullets : data.results.map(r => r.analysis.complexity?.summary).filter(Boolean) as string[];
  const styFallback = styBullets.length ? styBullets : data.results.map(r => r.analysis.style?.summary).filter(Boolean) as string[];

  const scoreBentoHtml = data.results.length ? `
  <section class="sc-grid">
    ${bigScoreCard("SECURITY",   avg(secScores),  SVG.shield,   secBullets)}
    ${bigScoreCard("QUALITY",    avg(qualScores), SVG.verified, qualBullets)}
    ${bigScoreCard("COMPLEXITY", avg(cplScores),  SVG.tree,     cplFallback)}
    ${bigScoreCard("STYLE",      avg(styScores),  SVG.palette,  styFallback)}
  </section>` : "";

  // inline SVG icons replacing Material Symbols (no CDN)
  const ICO = {
    eye:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    lock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    clock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    warning:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    sync:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
    chevron:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>`,
    terminal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  };

  // find worst-scoring function for code preview
  const worstResult = data.results.length
    ? [...data.results].sort((a, b) => (a.analysis.overallScore || 10) - (b.analysis.overallScore || 10))[0]
    : null;

  const codePreviewHtml = worstResult?.code ? (() => {
    const lines    = (worstResult.code as string).split("\n");
    const startLn  = worstResult.fnInfo.start ?? 1;
    const cplScore = worstResult.analysis.complexity?.complexityScore ?? 10;
    const rendered = lines.map((line: string, idx: number) => {
      const lineNum   = startLn + idx;
      const indent    = line.match(/^(\s*)/)?.[1].length ?? 0;
      const highlight = cplScore < 6 && indent >= 6;
      const style     = highlight
        ? `style="background:rgba(233,107,54,.06);border-left:2px solid #e96b36;padding-left:10px"`
        : `style="padding-left:12px"`;
      return `<div class="cp-line" ${style}>`
           + `<span class="cp-ln">${lineNum}</span>`
           + `<span class="cp-code">${esc(line)}</span>`
           + `</div>`;
    }).join("");
    return `<div class="cp-wrap">
      <div class="cp-head">
        ${ICO.terminal}
        <span class="cp-title">Preview: ${esc(worstResult!.fnInfo.name)}() ${cplScore < 6 ? "complexity issue" : "overview"}</span>
      </div>
      <div class="cp-body">${rendered}</div>
    </div>`;
  })() : "";

  const fnTableHtml = data.results.length ? `
  <section class="fbd-wrap">
    <div class="fbd-header">
      <span class="fbd-title">FUNCTION BREAKDOWN</span>
      <span class="fbd-count">${data.results.length} FUNCTION${data.results.length !== 1 ? "S" : ""} DETECTED</span>
    </div>
    <div class="fbd-list">
    ${data.results.map((r, i) => {
      const s          = r.analysis.overallScore;
      const cnt        = (r.analysis.security?.vulnerabilities?.length ?? 0)
                       + (r.analysis.quality?.issues?.length           ?? 0)
                       + (r.analysis.errorHandling?.issues?.length     ?? 0)
                       + (r.analysis.style?.violations?.length         ?? 0);
      const hasCrit    = (r.analysis.security?.vulnerabilities ?? []).some((v: any) => v.severity === "critical");
      const hasCplWarn = (r.analysis.complexity?.complexityScore ?? 10) < 6;
      const isAsync    = /\basync\b/.test((r.code as string | undefined) ?? "");
      const isPrivate  = r.fnInfo.name.startsWith("_") || r.fnInfo.name.startsWith("#");

      // Stitch semantic colors: secondary = green (good), tertiary = orange (warn), error = red
      const badgeCol = s >= 8 ? "#28a745" : s >= 5 ? "#ffb599" : s > 0 ? "#f87171" : "#64748b";
      const leftBorder = hasCrit ? "border-left:2px solid #f87171"
                       : hasCplWarn ? "border-left:2px solid #ffb599" : "";
      const findingsCol = cnt > 0 ? (hasCrit ? "#f87171" : "#ffb599") : "#dfc0b5";

      const meta: string[] = [];
      if (isPrivate) { meta.push(`<span class="fbd-meta">${ICO.lock}<span>Private</span></span>`); }
      else           { meta.push(`<span class="fbd-meta">${ICO.eye}<span>Public</span></span>`); }
      if (isAsync)   { meta.push(`<span class="fbd-meta">${ICO.sync}<span>Async</span></span>`); }
      if (hasCplWarn){ meta.push(`<span class="fbd-meta fbd-meta-warn">${ICO.warning}<span>Complexity Warning</span></span>`); }
      if (hasCrit)   { meta.push(`<span class="fbd-meta fbd-meta-err">${ICO.warning}<span>Critical Security</span></span>`); }

      return `<div class="fbd-row" style="${leftBorder}" onclick="switchTab('${hasCrit ? "security" : "quality"}');scrollToFn('fn_${i}')">
        <div class="fbd-num">${String(i + 1).padStart(2, "0")}</div>
        <div class="fbd-info">
          <div class="fbd-name-row">
            <span class="fbd-name">${esc(r.fnInfo.name)}</span>
            <span class="fbd-badge" style="color:${badgeCol};background:${badgeCol}18;border-color:${badgeCol}30">${s || "—"}</span>
          </div>
          <div class="fbd-metas">${meta.join("")}</div>
        </div>
        <div class="fbd-right">
          <div>
            <p class="fbd-findings-lbl" style="color:${findingsCol}">FINDINGS</p>
            <p class="fbd-findings-num" style="color:${findingsCol}">${cnt}</p>
          </div>
          <span class="fbd-chevron">${ICO.chevron}</span>
        </div>
      </div>`;
    }).join("")}
    </div>
  </section>
  ${codePreviewHtml}` : "";



  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Code Reviewer</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
/* ── Reset + Layout ──────────────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-thumb{background:#31353c;border-radius:10px}
::-webkit-scrollbar-track{background:transparent}
html,body{height:100%;overflow:hidden;background:#0f141a;color:#dfe2eb;font-family:system-ui,-apple-system,var(--vscode-font-family,sans-serif);font-size:13px}
body{display:flex}
/* ── Side navigation ─────────────────────────────────────────────── */
.side-nav{display:flex;flex-direction:column;width:64px;background:#1c2026;border-right:1px solid #58423a;padding:12px 0;align-items:center;flex-shrink:0}
.nav-logo{width:32px;height:32px;border-radius:4px;background:#e96b36;color:#4f1700;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;margin-bottom:24px;flex-shrink:0;user-select:none}
.nav-items{display:flex;flex-direction:column;gap:8px;flex:1}
.nav-btn{width:40px;height:40px;border-radius:4px;border:none;background:none;color:#dfc0b5;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
.nav-btn:hover{background:rgba(255,255,255,.05);color:#dfe2eb}
.nav-btn.active{background:rgba(233,107,54,.15);color:#ffb599;border-left:2px solid #ffb599;margin-left:-1px}
.nav-bottom{display:flex;flex-direction:column;gap:8px}
/* ── Main wrapper ────────────────────────────────────────────────── */
.main-wrapper{display:flex;flex-direction:column;flex:1;min-width:0;height:100%}
/* ── Top bar ─────────────────────────────────────────────────────── */
.top-bar{display:flex;justify-content:space-between;align-items:center;height:40px;padding:0 12px;background:#0f141a;border-bottom:1px solid #58423a;flex-shrink:0;gap:8px}
.top-bar-left{display:flex;align-items:center;gap:12px;min-width:0;flex:1}
.top-bar-title{font-size:11px;font-weight:700;letter-spacing:.05em;color:#ffb599;white-space:nowrap}
.top-bar-sep{width:1px;height:16px;background:#58423a;flex-shrink:0}
.top-bar-file{font-size:12px;color:#dfc0b5;font-family:JetBrains Mono,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.top-bar-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.btn-sm{padding:3px 10px;border:1px solid #58423a;background:none;color:#dfe2eb;font-size:10px;font-weight:600;cursor:pointer;transition:background .15s;font-family:inherit;white-space:nowrap;letter-spacing:.02em}
.btn-sm:hover{background:rgba(255,255,255,.05)}
.btn-sm:disabled{opacity:.5;cursor:not-allowed}
.btn-sm-primary{padding:3px 10px;background:#e96b36;color:#0f141a;font-size:10px;font-weight:700;border:none;cursor:pointer;transition:opacity .15s;white-space:nowrap;letter-spacing:.02em}
.btn-sm-primary:hover{opacity:.9}
.btn-sm-primary:disabled{opacity:.5;cursor:not-allowed}
.gh-user-label{font-size:12px;font-weight:700;color:#28a745;font-family:monospace}
/* ── Scrollable content ──────────────────────────────────────────── */
.main-scroll{flex:1;overflow-y:auto;padding:16px;background:#0f141a}
.tab-content{display:none}
.tab-content.active{display:block}
/* ── Score cards grid ────────────────────────────────────────────── */
.sc-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px}
.sc-card{background:#1c2026;border:1px solid #58423a;padding:14px 16px;min-width:0;overflow:hidden}
.sc-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.sc-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#dfc0b5}
.sc-icon{flex-shrink:0}
.sc-num{font-size:42px;font-weight:700;line-height:1;font-family:JetBrains Mono,Consolas,monospace;margin-bottom:10px}
.sc-denom{font-size:16px;color:#6b7280;margin-left:2px}
.sc-bullets{margin:0;padding-left:14px;font-size:11px;color:#dfc0b5;line-height:1.7;list-style:disc}
.sc-bullets li{word-break:break-word}
.sc-empty{font-size:11px;color:#4ade80;opacity:.7}
/* ── Function breakdown ──────────────────────────────────────────── */
.fbd-wrap{background:#1c2026;border:1px solid #58423a;overflow:hidden;margin:16px 0}
.fbd-header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#181c22;border-bottom:1px solid #58423a}
.fbd-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#dfe2eb}
.fbd-count{font-size:10px;color:#dfc0b5;font-family:JetBrains Mono,Consolas,monospace;letter-spacing:.04em}
.fbd-list{display:flex;flex-direction:column}
.fbd-row{display:flex;align-items:center;padding:10px 12px;cursor:pointer;border-bottom:1px solid #58423a25;transition:background .12s}
.fbd-row:last-child{border-bottom:none}
.fbd-row:hover{background:rgba(255,255,255,.025)}
.fbd-row:hover .fbd-chevron{opacity:1}
.fbd-num{width:40px;flex-shrink:0;text-align:center;font-family:JetBrains Mono,Consolas,monospace;font-size:11px;color:#64748b}
.fbd-info{flex:1;padding:0 12px;min-width:0}
.fbd-name-row{display:flex;align-items:center;gap:10px;margin-bottom:5px}
.fbd-name{font-family:JetBrains Mono,Consolas,monospace;font-size:13px;color:#dfe2eb;font-weight:500}
.fbd-badge{padding:1px 6px;font-size:10px;font-weight:700;font-family:JetBrains Mono,Consolas,monospace;border:1px solid;letter-spacing:.02em}
.fbd-metas{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.fbd-meta{display:flex;align-items:center;gap:4px;font-size:11px;color:#dfc0b5}
.fbd-meta-warn{color:#ffb599}
.fbd-meta-err{color:#f87171}
.fbd-right{display:flex;align-items:center;gap:12px;flex-shrink:0;text-align:right}
.fbd-findings-lbl{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px}
.fbd-findings-num{font-size:15px;font-weight:700;line-height:1}
.fbd-chevron{opacity:0;transition:opacity .15s;color:#64748b}
/* ── Code preview ────────────────────────────────────────────────── */
.cp-wrap{background:#0f141a;border:1px solid #58423a;overflow:hidden;margin-bottom:16px}
.cp-head{display:flex;align-items:center;gap:8px;padding:8px 16px;background:#181c22;border-bottom:1px solid #58423a}
.cp-title{font-size:11px;color:#dfc0b5;font-family:JetBrains Mono,Consolas,monospace;letter-spacing:.02em}
.cp-body{padding:8px 0;overflow-x:auto;font-family:JetBrains Mono,Consolas,monospace;font-size:12px;line-height:1.7}
.cp-line{display:flex;min-width:0}
.cp-ln{color:#64748b40;width:40px;text-align:right;padding-right:14px;flex-shrink:0;user-select:none;font-size:11px}
.cp-code{color:#dfe2eb;white-space:pre;flex:1;padding-right:16px}
/* ── Function block (Security / Quality tabs) ────────────────────── */
.fn-block{background:#1c2026;border:1px solid #58423a;overflow:hidden;margin-bottom:12px}
.fn-block.has-errors{border-left:2px solid #f87171}
.fn-block-head{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#181c22;border-bottom:1px solid #58423a}
.fn-block-name{font-family:JetBrains Mono,Consolas,monospace;font-size:13px;color:#dfe2eb;font-weight:600;flex:1}
.fn-block-score{padding:2px 8px;font-size:11px;font-weight:700;font-family:JetBrains Mono,Consolas,monospace;border:1px solid}
.score-pill{display:none}
/* ── Agent detail sections ───────────────────────────────────────── */
details.agent-details{border-bottom:1px solid #58423a;overflow:hidden}
details.agent-details:last-child{border-bottom:none}
details.agent-details>summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;padding:9px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;user-select:none;border-left:3px solid transparent}
details.agent-details>summary::-webkit-details-marker{display:none}
details.agent-details>summary svg,.agent-head svg{width:14px;height:14px;vertical-align:middle;margin-right:5px;opacity:.85;flex-shrink:0}
details.agent-details>summary::after{content:"▾";font-size:12px;opacity:.5;transition:transform .18s;margin-left:8px;flex-shrink:0}
details.agent-details:not([open])>summary::after{transform:rotate(-90deg)}
details.agent-details>.agent-body{background:#1c2026;border-top:1px solid #58423a}
details.agent-details>summary.amber  {background:#eab30808;color:#eab308;border-left-color:#eab308}
details.agent-details>summary.red    {background:#f8717108;color:#f87171;border-left-color:#f87171}
details.agent-details>summary.purple {background:#a78bfa08;color:#a78bfa;border-left-color:#a78bfa}
details.agent-details>summary.teal   {background:#34d39908;color:#34d399;border-left-color:#34d399}
details.agent-details>summary.coral  {background:#fb923c08;color:#fb923c;border-left-color:#fb923c}
details.agent-details>summary.complexity{background:#c084fc08;color:#c084fc;border-left-color:#c084fc}
details.agent-details>summary.errhandle {background:#fb923c08;color:#fb923c;border-left-color:#fb923c}
details.agent-details>summary.duplication{background:#fbbf2408;color:#fbbf24;border-left-color:#fbbf24}
details.agent-details>summary.deps   {background:#60a5fa08;color:#60a5fa;border-left-color:#60a5fa}
/* ── Complexity stats ────────────────────────────────────────────── */
.complexity-stats{display:flex;gap:8px;padding:12px 16px;flex-wrap:wrap}
.stat-box{padding:8px 14px;background:#181c22;border:1px solid #58423a;text-align:center;min-width:72px}
.stat-val{display:block;font-size:20px;font-weight:700;color:#ffb599;font-family:JetBrains Mono,Consolas,monospace}
.stat-lbl{display:block;font-size:9px;color:#dfc0b5;text-transform:uppercase;letter-spacing:.06em;margin-top:2px}
/* ── Issues ──────────────────────────────────────────────────────── */
.issue{padding:10px 16px;border-bottom:1px solid #58423a18;background:transparent}
.issue:last-child{border-bottom:none}
.badge{display:inline-block;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.06em;margin-bottom:5px;border:1px solid}
.idesc{font-weight:600;font-size:12px;color:#dfe2eb;margin:2px 0}
.isug{font-size:12px;color:#dfc0b5;margin:3px 0 0;line-height:1.5}
.summary{font-size:12px;color:#dfc0b5;font-style:italic;padding:10px 16px;border-bottom:1px solid #58423a18}
.matched{font-size:12px;color:#ffb599;padding:0 16px 8px}
.muted{color:#64748b;font-size:12px;font-style:italic;padding:12px 16px}
.dup-warning{padding:8px 16px;background:#fbbf2408;border-left:3px solid #fbbf24;color:#fbbf24;font-size:12px;font-weight:600}
/* ── Compile banner ──────────────────────────────────────────────── */
.compile-banner{padding:10px 16px;background:#f8717108;border-left:3px solid #f87171;border-bottom:1px solid #58423a}
.compile-title{font-weight:700;font-size:11px;color:#f87171;display:block;margin-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
.compile-err{font-size:11px;color:#fca5a5;font-family:JetBrains Mono,Consolas,monospace;margin:2px 0}
/* ── Chat messages (global footer) ──────────────────────────────── */
.chat-msg-user{color:#ffb599;margin-bottom:4px;font-weight:600;font-size:12px}
.chat-msg-ai{color:#dfc0b5;margin-bottom:8px;font-size:12px;line-height:1.6}
.chat-thinking{color:#64748b;font-style:italic;font-size:12px}
/* ── Code block ──────────────────────────────────────────────────── */
.code{background:#0f141a;padding:10px 16px;font-family:JetBrains Mono,Consolas,var(--vscode-editor-font-family,monospace);font-size:12px;overflow-x:auto;border-top:1px solid #58423a;margin:0}
.code code{background:none;padding:0;border:none;display:block;white-space:pre;color:#dfe2eb;font-family:inherit;font-size:inherit}
.hljs{background:transparent !important;padding:0 !important}
/* ── Refactor card ───────────────────────────────────────────────── */
.refactor-card{border-top:1px solid #58423a;overflow:hidden}
.refactor-head{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#181c22;border-bottom:1px solid #58423a;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#28a745}
.refactor-code{margin:0;border:none}
.refactor-copy-btn{padding:2px 8px;border:1px solid #28a74540;background:#28a74512;color:#28a745;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.04em}
.refactor-copy-btn:hover{background:#28a74520}
/* ── Apply Fix button ────────────────────────────────────────────── */
.fix-btn{padding:3px 10px;border:1px solid #ffb59940;background:#ffb59910;color:#ffb599;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.04em;font-family:inherit}
.fix-btn:hover{background:#ffb59920}
/* ── DNA / Decay ─────────────────────────────────────────────────── */
.dna-warning{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid #58423a;border-left:3px solid}
.dna-icon{font-size:18px;line-height:1;flex-shrink:0;margin-top:1px}
.dna-bar-wrap{margin:8px 0 3px;height:4px;background:#ffffff0a;overflow:hidden}
.dna-bar{height:100%}.dna-pct{font-size:11px;color:#dfc0b5}
.dna-coaching{margin-top:10px;padding:8px 12px;background:#0f141a;border-left:2px solid #eab308}
.dna-coaching-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#eab308;display:block;margin-bottom:4px}
.dna-coaching-list{margin:0;padding-left:14px;font-size:12px;color:#dfc0b5;line-height:1.7}
.decay-card{padding:12px 16px;border-bottom:1px solid #58423a;border-left:3px solid}
.decay-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.decay-level{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.decay-age{font-size:11px;font-weight:700;font-family:JetBrains Mono,Consolas,monospace}
.decay-bar-wrap{height:3px;background:#ffffff0a;overflow:hidden;margin-bottom:8px}
.decay-bar{height:100%}
.decay-meta{font-size:11px;color:#dfc0b5;display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px}
.decay-review{font-style:italic;opacity:.7}
/* ── Debate ──────────────────────────────────────────────────────── */
.debate-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#58423a;margin:12px 0}
@media(max-width:520px){.debate-grid{grid-template-columns:1fr}}
.debate-side{padding:12px 16px;background:#1c2026;border-left:3px solid}
.debate-side-head{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.debate-verdict{opacity:.85}
.debate-opening{font-style:italic;font-size:12px;color:#dfc0b5;margin-bottom:6px}
.debate-args{margin:0;padding-left:16px;font-size:12px;color:#dfc0b5;line-height:1.7}
.debate-args li{margin:3px 0}
.debate-footer{padding:8px 16px;font-size:11px;color:#64748b;text-align:center;border-top:1px solid #58423a}
/* ── Diff card ───────────────────────────────────────────────────── */
.diff-card{padding:12px 16px;border-bottom:1px solid #58423a}
.diff-head{display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#ffb599;margin-bottom:8px}
.diff-score{font-family:JetBrains Mono,Consolas,monospace;font-size:12px}
.diff-summary{display:flex;gap:12px;font-size:11px;font-weight:700;margin-bottom:8px}
.diff-added{color:#f87171}.diff-resolved{color:#28a745}.diff-unchanged{color:#64748b;font-weight:400}
.diff-cat-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:11px;color:#dfc0b5}
.diff-cat-label{opacity:.7}.diff-cat-counts{display:flex;gap:10px}
.diff-list{margin:2px 0 6px;padding-left:16px;font-size:11px;line-height:1.6}
.diff-list-added{color:#fca5a5}.diff-list-resolved{color:#86efac}
/* ── Token usage ─────────────────────────────────────────────────── */
.tok-card{margin:12px 0;background:#1c2026;border:1px solid #58423a;overflow:hidden}
.tok-head{padding:8px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#ffb599;background:#181c22;border-bottom:1px solid #58423a}
.tok-rows{display:flex;flex-direction:column;padding:8px 0}
.tok-row{display:grid;grid-template-columns:160px 1fr 140px 70px;gap:8px;align-items:center;font-size:11px;padding:4px 16px}
.tok-provider{font-family:JetBrains Mono,Consolas,monospace;color:#dfe2eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tok-bar-wrap{height:3px;background:#ffffff0a;overflow:hidden}
.tok-bar{height:100%;background:linear-gradient(90deg,#e96b36,#ffb599)}
.tok-nums{color:#dfc0b5;text-align:right;font-family:JetBrains Mono,Consolas,monospace}
.tok-total{color:#ffb599;font-weight:700;font-family:JetBrains Mono,Consolas,monospace;text-align:right}
.tok-summary{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-top:1px solid #58423a;font-size:11px;color:#dfc0b5}
.tok-grand{font-size:13px;font-weight:700;color:#ffb599;font-family:JetBrains Mono,Consolas,monospace}
.tok-rl-head{padding:6px 16px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#f87171;border-top:1px solid #58423a}
.tok-rl-row{display:flex;gap:8px;align-items:center;padding:3px 16px;font-size:11px}
.tok-rl-badge{background:#f8717120;color:#f87171;padding:1px 6px;font-family:JetBrains Mono,Consolas,monospace;font-size:10px;flex-shrink:0}
.tok-rl-agent{color:#dfc0b5;flex:1}
.tok-rl-wait{color:#f87171;font-family:JetBrains Mono,Consolas,monospace;font-size:10px;flex-shrink:0}
/* ── PR / Git tab ────────────────────────────────────────────────── */
.sec{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#dfc0b560;margin:16px 0 6px}
.commit{display:grid;grid-template-columns:60px 80px 110px 1fr;gap:8px;font-size:11px;padding:5px 0;border-bottom:1px solid #58423a18}
.chash{color:#ffb599;font-family:JetBrains Mono,Consolas,monospace}
.cdate,.cauthor{color:#64748b}.cmsg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dfc0b5}
.pr-card{margin:12px 0;background:#1c2026;border:1px solid #58423a;border-left:3px solid #ffb599;overflow:hidden}
.pr-head{display:flex;gap:8px;align-items:center;padding:8px 16px;background:#181c22;border-bottom:1px solid #58423a}
.pr-number{font-weight:700;color:#ffb599;font-family:JetBrains Mono,Consolas,monospace}
.pr-state{padding:1px 7px;font-size:9px;font-weight:700;letter-spacing:.06em;border:1px solid}
.pr-state.open{background:#28a74510;color:#28a745;border-color:#28a74530}
.pr-state.closed{background:#f8717110;color:#f87171;border-color:#f8717130}
.pr-source{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.pr-title{font-weight:600;margin:0;color:#dfe2eb;padding:8px 16px 2px}
.pr-meta{font-size:11px;color:#dfc0b5;padding:0 16px 8px}
.pr-comment{padding:8px 16px;border-top:1px solid #58423a18}
.pr-comment-author{font-weight:700;font-size:11px;color:#ffb599;margin-right:8px}
.pr-comment-body{font-size:12px;color:#dfc0b5;margin-top:3px;line-height:1.5}
.pr-insight{padding:8px 16px;background:#ffb59908;border-left:3px solid #ffb599;font-size:12px;color:#dfe2eb}
/* ── Commit result ───────────────────────────────────────────────── */
.commit-result{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 12px;background:#181c22;border-bottom:1px solid #58423a}
.commit-result-label{font-size:10px;color:#dfc0b5;white-space:nowrap;text-transform:uppercase;letter-spacing:.06em}
.commit-text{flex:1;background:#0f141a;color:#ffb599;padding:4px 10px;border:1px solid #58423a;font-family:JetBrains Mono,Consolas,monospace;font-size:12px;word-break:break-all}
.commit-copy-btn{padding:3px 8px;border:1px solid #ffb59940;background:#ffb59910;color:#ffb599;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap}
.commit-copy-btn:hover{background:#ffb59920}
/* ── Global chat footer ──────────────────────────────────────────── */
.chat-footer{padding:12px 16px;background:#0f141a;border-top:1px solid #58423a;flex-shrink:0}
.chat-global-box{max-height:120px;overflow-y:auto;font-size:12px;padding:0 0 8px;display:none}
.chat-global-bar{display:flex;align-items:center;gap:10px;background:#181c22;border:1px solid #58423a;padding:8px 14px;transition:border-color .15s}
.chat-global-bar:focus-within{border-color:#ffb599}
.chat-input-global{flex:1;background:none;border:none;color:#dfe2eb;font-size:13px;outline:none;font-family:inherit}
.chat-input-global::placeholder{color:#dfc0b560}
.chat-global-kbd{display:inline-flex;padding:2px 6px;background:#0f141a;font-size:10px;color:#dfc0b5;border:1px solid #58423a;font-family:JetBrains Mono,Consolas,monospace}
.chat-send-btn{width:32px;height:32px;background:#e96b36;color:#0f141a;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .15s;flex-shrink:0}
.chat-send-btn:hover{opacity:.9}
/* ── Misc ────────────────────────────────────────────────────────── */
.footer{font-size:11px;text-align:center;margin-top:20px;color:#64748b}
hr{border:none;border-top:1px solid #58423a;margin:16px 0}
/* ── Animations ──────────────────────────────────────────────────── */
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.sk-section{opacity:.65;border-color:#ffffff08 !important}
.sk-head{background:#ffffff06 !important;color:#374151 !important;font-style:italic}
.sk-line{height:10px;border-radius:5px;margin:8px 12px;background:linear-gradient(90deg,#1e293b 25%,#2d3f55 50%,#1e293b 75%);background-size:200% 100%;animation:shimmer 1.4s ease-in-out infinite}
.stream-in{animation:fadeUp .35s ease-out}
.tw-cursor::after{content:"▋";animation:blink .7s step-start infinite;color:#60a5fa;font-weight:300;margin-left:1px}
</style>
</head>
<body>

<!-- ── Side navigation ──────────────────────────────────────────── -->
<aside class="side-nav">
  <div class="nav-logo">F</div>
  <div class="nav-items">
    <button class="nav-btn active" data-tab="overview"      title="Overview &amp; Issues">${SVG.bug}</button>
    <button class="nav-btn"        data-tab="security"      title="Security">${SVG.shield}</button>
    <button class="nav-btn"        data-tab="quality"       title="Quality">${SVG.verified}</button>
    <button class="nav-btn"        data-tab="refactor"      title="Suggested Refactor">${SVG.wand}</button>
    <button class="nav-btn"        data-tab="errorhandling" title="Error Handling">${SVG.warning}</button>
    <button class="nav-btn"        data-tab="style"         title="Style">${SVG.palette}</button>
    <button class="nav-btn"        data-tab="complexity"    title="Complexity">${SVG.tree}</button>
    <button class="nav-btn"        data-tab="duplication"   title="Duplication">${SVG.layers}</button>
    <button class="nav-btn"        data-tab="docs"          title="Docs">${SVG.fileText}</button>
    <button class="nav-btn"        data-tab="tests"         title="Tests">${SVG.flask}</button>
    <button class="nav-btn"        data-tab="gitdeps"       title="Git &amp; Dependencies">${SVG.git}</button>
  </div>
  <div class="nav-bottom">
    <button class="nav-btn" onclick="exportMarkdown()" title="Export Markdown">${SVG.export}</button>
    <button class="nav-btn" onclick="" title="Info">${SVG.info}</button>
  </div>
</aside>

<!-- ── Main wrapper ──────────────────────────────────────────────── -->
<div class="main-wrapper">

  <!-- Top bar -->
  <header class="top-bar">
    <div class="top-bar-left">
      <span class="top-bar-title">AI CODE REVIEWER</span>
      <div class="top-bar-sep"></div>
      <span class="top-bar-file">${esc(basename(data.file))}</span>
      <span id="remote-url-display" style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${esc(data.git.remote ?? "")}</span>
    </div>
    <div class="top-bar-right">
      <button class="btn-sm" id="commit-btn" onclick="genCommitMsg()">✍ Commit msg</button>
      <button class="btn-sm" onclick="exportMarkdown()">📄 Export</button>
      <div class="top-bar-sep"></div>
      <button class="btn-sm-primary" id="github-login-btn" onclick="githubLogin()">Connect GitHub</button>
      <div id="github-user" style="display:none;align-items:center;gap:6px">
        <span id="github-username" class="gh-user-label"></span>
        <button class="btn-sm" onclick="githubLogout()">Sign out</button>
        <button class="btn-sm-primary" id="post-pr-btn" style="display:none" onclick="postToPR()">Post to PR</button>
        <span id="pr-posted-msg" style="color:#4ade80;font-size:11px;display:none">✓ Posted!</span>
      </div>
    </div>
  </header>

  <!-- Commit message result (shown inline below top bar) -->
  <div id="commit-result" class="commit-result" style="display:none">
    <span class="commit-result-label">Suggested:</span>
    <code id="commit-text" class="commit-text"></code>
    <button class="commit-copy-btn" onclick="copyCommitMsg()">Copy</button>
  </div>

  <!-- Scrollable content -->
  <main class="main-scroll">

    <!-- ── OVERVIEW TAB (default) ────────────────────────────────── -->
    <div id="tab-overview" class="tab-content active">
      ${scoreBentoHtml}
      ${fnTableHtml}
      ${data.tokenUsage?.length ? buildTokenUsageHtml(data.tokenUsage, data.rateLimits) : ""}
      <p class="footer">AI Code Reviewer · 9 agents · Groq + Gemini + NVIDIA NIM</p>
    </div>

    <!-- ── SECURITY TAB ──────────────────────────────────────────── -->
    <div id="tab-security" class="tab-content">
      ${secFnsHtml}
      <div class="sec" style="margin-top:16px">Provider routing</div>
      ${buildProviderLog(data.providerLog)}
    </div>

    <!-- ── QUALITY TAB ──────────────────────────────────────────── -->
    <div id="tab-quality" class="tab-content">
      ${qualFnsHtml}
      <div class="sec" style="margin-top:16px">Score history</div>
      ${buildDashboard(data.scores)}
    </div>

    <!-- ── REFACTOR TAB ─────────────────────────────────────────── -->
    <div id="tab-refactor" class="tab-content">
      ${refactorFnsHtml}
    </div>

    <!-- ── ERROR HANDLING TAB ───────────────────────────────────── -->
    <div id="tab-errorhandling" class="tab-content">
      ${errorFnsHtml}
    </div>

    <!-- ── STYLE TAB ────────────────────────────────────────────── -->
    <div id="tab-style" class="tab-content">
      ${styleFnsHtml}
    </div>

    <!-- ── COMPLEXITY TAB ───────────────────────────────────────── -->
    <div id="tab-complexity" class="tab-content">
      ${complexityFnsHtml}
    </div>

    <!-- ── DUPLICATION TAB ──────────────────────────────────────── -->
    <div id="tab-duplication" class="tab-content">
      ${dupFnsHtml}
    </div>

    <!-- ── DOCS TAB ─────────────────────────────────────────────── -->
    <div id="tab-docs" class="tab-content">
      ${docsFnsHtml}
    </div>

    <!-- ── TESTS TAB ────────────────────────────────────────────── -->
    <div id="tab-tests" class="tab-content">
      ${testsFnsHtml}
    </div>

    <!-- ── GIT & DEPS TAB ────────────────────────────────────────── -->
    <div id="tab-gitdeps" class="tab-content">
      <div class="sec">Git history</div>
      ${commitsHtml}
      <hr>
      <div class="sec">Pull request context</div>
      ${prHtml}
      <hr>
      <div class="sec">Dependencies</div>
      ${depsHtml}
    </div>

  </main>

  <!-- Global chat footer -->
  <footer class="chat-footer">
    <div id="global-chat-box" class="chat-global-box"></div>
    <div class="chat-global-bar">
      ${SVG.sparkles}
      <input class="chat-input-global" id="global-chat-input"
        placeholder="Ask AI about this file or ask to refactor…"
        onkeydown="if(event.key==='Enter')sendGlobalChat()"/>
      <kbd class="chat-global-kbd">↵ Enter</kbd>
      <button class="chat-send-btn" onclick="sendGlobalChat()">${SVG.send}</button>
    </div>
  </footer>

</div><!-- /.main-wrapper -->

<script id="commit-data" type="application/json">${commitDataJson}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
<script>
const vscode=acquireVsCodeApi();

// ── Side nav tab switching ────────────────────────────────────────
function switchTab(tab){
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.nav-btn[data-tab]').forEach(el=>el.classList.remove('active'));
  const content=document.getElementById('tab-'+tab);
  if(content)content.classList.add('active');
  const btn=document.querySelector('.nav-btn[data-tab="'+tab+'"]');
  if(btn)btn.classList.add('active');
}
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn=>{
  btn.addEventListener('click',()=>switchTab(btn.dataset.tab));
});

// ── Scroll to function card ───────────────────────────────────────
function scrollToFn(fnId){
  switchTab('overview');
  setTimeout(()=>{
    const pill=document.getElementById('score-pill-'+fnId);
    const card=pill?.closest('.fn-card');
    if(card){card.scrollIntoView({behavior:'smooth',block:'start'});}
    else{document.querySelector('.fn-card')?.scrollIntoView({behavior:'smooth'});}
  },50);
}

// ── Score ring ────────────────────────────────────────────────────
function buildRingHTML(score){
  const r=22,c=+(2*Math.PI*r).toFixed(2);
  const offset=+(c*(1-Math.max(0,Math.min(10,score))/10)).toFixed(2);
  const col=score<=4?'#f87171':score<=7?'#eab308':'#4ade80';
  return '<svg width="56" height="56" viewBox="0 0 56 56">'
    +'<circle cx="28" cy="28" r="'+r+'" fill="none" stroke="#ffffff12" stroke-width="4"/>'
    +'<circle cx="28" cy="28" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="4" '
    +'stroke-dasharray="'+c+'" stroke-dashoffset="'+offset+'" '
    +'transform="rotate(-90 28 28)" stroke-linecap="round" '
    +'style="transition:stroke-dashoffset .5s ease,stroke .5s ease"/>'
    +'<text x="28" y="33" text-anchor="middle" fill="'+col+'" font-size="13" font-weight="700">'+score+'</text>'
    +'</svg>';
}

// ── Highlight.js ──────────────────────────────────────────────────
function highlightAll(){if(window.hljs){hljs.configure({cssSelector:'pre.code code'});hljs.highlightAll();}}
function highlightSection(el){if(!window.hljs)return;el.querySelectorAll('pre.code code:not([data-highlighted])').forEach(c=>{hljs.highlightElement(c);});}

// ── Apply fix ─────────────────────────────────────────────────────
function applyFix(fnName,fnId,startLine,endLine){const el=document.getElementById('refactor-'+fnId);if(!el)return;vscode.postMessage({type:'applyFix',fnName,refactoredCode:el.value,startLine,endLine});}

// ── Copy refactor ─────────────────────────────────────────────────
function copyRefactor(cardId){const el=document.getElementById('refactor-code-'+cardId);if(!el)return;navigator.clipboard.writeText(el.textContent||'').then(()=>{const btn=el.closest('.refactor-card')?.querySelector('.refactor-copy-btn');if(btn){btn.textContent='Copied!';setTimeout(()=>{btn.textContent='Copy';},1500);}});}

// ── Global chat ───────────────────────────────────────────────────
function sendGlobalChat(){
  const input=document.getElementById('global-chat-input');
  const box=document.getElementById('global-chat-box');
  if(!input||!box)return;
  const question=input.value.trim();if(!question)return;input.value='';
  const firstCode=document.querySelector('textarea[id^="code-fn"]');
  const firstReview=document.querySelector('textarea[id^="review-fn"]');
  if(!firstCode){box.style.display='block';const p=document.createElement('p');p.style.cssText='color:#dfc0b5;font-size:12px;font-style:italic';p.textContent='Run a review first, then ask questions here.';box.appendChild(p);return;}
  box.style.display='block';
  const um=document.createElement('p');um.style.cssText='color:#ffb599;font-weight:600;margin-bottom:4px;font-size:12px';um.textContent='You: '+question;box.appendChild(um);
  const th=document.createElement('p');th.style.cssText='color:#64748b;font-style:italic;font-size:12px';th.id='global-thinking';th.textContent='Thinking…';box.appendChild(th);
  box.scrollTop=box.scrollHeight;
  vscode.postMessage({type:'chat',fnCode:firstCode.value,reviewContext:firstReview?.value??'',question,chatBoxId:'global-chat-box',thinkingId:'global-thinking'});
}

// ── Typewriter ────────────────────────────────────────────────────
function runTypewriter(container){
  if(!container)return;
  container.querySelectorAll('.tw').forEach(el=>{
    const full=el.textContent||'';el.textContent='';el.classList.add('tw-cursor');
    let i=0;const spd=Math.max(6,Math.min(22,1600/Math.max(full.length,1)));
    const tick=()=>{if(i<full.length){el.textContent+=full[i++];setTimeout(tick,spd);}else{el.classList.remove('tw-cursor');}};
    setTimeout(tick,60);
  });
}

// ── Commit message ────────────────────────────────────────────────
function genCommitMsg(){
  const btn=document.getElementById('commit-btn');
  if(btn){btn.disabled=true;btn.textContent='Generating…';}
  const raw=document.getElementById('commit-data')?.textContent||'{}';
  const d=JSON.parse(raw);
  vscode.postMessage({type:'generateCommitMessage',file:d.file,functions:d.functions});
}
function copyCommitMsg(){
  const el=document.getElementById('commit-text');
  if(!el)return;
  navigator.clipboard.writeText(el.textContent||'').then(()=>{
    const btn=document.querySelector('.commit-copy-btn');
    if(btn){btn.textContent='Copied!';setTimeout(()=>{btn.textContent='Copy';},1500);}
  });
}

// ── GitHub / Export ───────────────────────────────────────────────
function exportMarkdown(){vscode.postMessage({type:'exportMarkdown'});}
function githubLogin(){
  const btn=document.getElementById('github-login-btn');
  if(btn){btn.textContent='Connecting…';btn.setAttribute('disabled','');}
  vscode.postMessage({type:'githubLogin'});
}
function githubLogout(){vscode.postMessage({type:'githubLogout'});}
function postToPR(){
  const btn=document.getElementById('post-pr-btn');
  if(btn){btn.textContent='Posting…';btn.setAttribute('disabled','');}
  vscode.postMessage({type:'postToPR'});
}

// ── Message handler ───────────────────────────────────────────────
window.addEventListener('message',event=>{
  const msg=event.data;
  if(msg.type==='githubConnected'){
    document.getElementById('github-login-btn').style.display='none';
    const userDiv=document.getElementById('github-user');
    userDiv.style.display='flex';
    document.getElementById('github-username').textContent='@'+msg.login;
    document.getElementById('post-pr-btn').style.display='inline-flex';
  }
  if(msg.type==='githubLoginFailed'){
    const btn=document.getElementById('github-login-btn');
    btn.textContent='Connect GitHub';btn.removeAttribute('disabled');
  }
  if(msg.type==='githubDisconnected'){
    document.getElementById('github-user').style.display='none';
    const btn=document.getElementById('github-login-btn');
    btn.style.display='inline-flex';btn.textContent='Connect GitHub';btn.removeAttribute('disabled');
    document.getElementById('pr-posted-msg').style.display='none';
  }
  if(msg.type==='repoChanged'){
    const el=document.getElementById('remote-url-display');
    if(el){el.textContent=msg.fullName||'';}
  }
  if(msg.type==='prPosted'){
    const btn=document.getElementById('post-pr-btn');
    btn.textContent='Post to PR';btn.removeAttribute('disabled');
    const posted=document.getElementById('pr-posted-msg');
    posted.textContent='✓ PR #'+msg.prNumber;posted.style.display='inline';
    setTimeout(()=>{posted.style.display='none';},4000);
  }
  if(msg.type==='commitMessageResult'){
    const btn=document.getElementById('commit-btn');
    if(btn){btn.disabled=false;btn.textContent='✍ Commit msg';}
    const result=document.getElementById('commit-result');
    const text=document.getElementById('commit-text');
    if(result&&text){text.textContent=msg.message;result.style.display='flex';}
  }
  if(msg.type==='chatResponse'){
    const th=document.getElementById(msg.thinkingId);if(th)th.remove();
    const cb=document.getElementById(msg.chatBoxId);
    if(cb){
      const am=document.createElement('p');
      am.style.cssText='color:#94a3b8;margin-bottom:8px;font-size:12px';
      am.textContent='AI: '+msg.response;
      cb.appendChild(am);cb.scrollTop=cb.scrollHeight;
    }
  }
  if(msg.type==='streamSection'&&msg.id&&msg.html){
    const el=document.getElementById(msg.id);
    if(el){
      el.outerHTML=msg.html;
      const fresh=document.getElementById(msg.id);
      if(fresh){fresh.classList.add('stream-in');runTypewriter(fresh);highlightSection(fresh);}
    }
  }
  if(msg.type==='streamScore'){
    const fnId=msg.pillId.replace('score-pill-','');
    const wrap=document.getElementById('ring-wrap-'+fnId);
    if(wrap)wrap.innerHTML=buildRingHTML(msg.score);
    const pill=document.getElementById(msg.pillId);
    if(pill){pill.textContent=msg.score+'/10';}
    const bar=document.getElementById(msg.barId);
    if(bar)bar.textContent='';
  }
});

// ── Init ──────────────────────────────────────────────────────────
window.addEventListener('load',()=>{
  highlightAll();
  vscode.postMessage({type:'webviewReady'});
});
</script>
</body></html>`;
}
