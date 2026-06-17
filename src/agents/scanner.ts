/**
 * agents/scanner.ts
 * ─────────────────────────────────────────────────────────────────
 * Static code scanner — runs entirely locally with no API calls.
 * Analyses the raw TypeScript source string and produces CodeSignals
 * that tell the dispatcher which agents are actually needed.
 *
 * This is the key to avoiding unnecessary API calls:
 *   - A pure math function → skip security, errorHandling, duplication
 *   - A well-documented function → skip docs
 *   - No history in LanceDB → skip duplication
 *   - No async keywords → skip errorHandling
 * ─────────────────────────────────────────────────────────────────
 */

export interface CodeSignals {
  // ── Always-run agents (never skippable) ──────────────────────
  // security and quality always run — security is non-negotiable,
  // quality is the core agent.

  // ── errorHandling signals ─────────────────────────────────────
  hasAsync:          boolean;   // async keyword or Promise usage
  hasThenChain:      boolean;   // .then() without .catch()
  hasJsonParse:      boolean;   // JSON.parse without try/catch check
  hasNullAccess:     boolean;   // chained property access (a.b.c)

  // ── complexity signals ────────────────────────────────────────
  hasDeepNesting:    boolean;   // 3+ levels of { blocks
  hasHighParams:     boolean;   // 5+ parameters
  hasManyBranches:   boolean;   // 6+ if/else/switch/ternary

  // ── style signals ─────────────────────────────────────────────
  hasStyleViolation: boolean;   // var / console.log / any / snake_case / eval

  // ── docs signals ──────────────────────────────────────────────
  hasMissingDocs:    boolean;   // no JSDoc comment above the function

  // ── tests signals ─────────────────────────────────────────────
  hasTestableLogic:  boolean;   // function has branches/returns worth testing

  // ── duplication signals ───────────────────────────────────────
  hasHistory:        boolean;   // LanceDB has entries (passed in from outside)

  // ── security signals (upgrade priority) ──────────────────────
  hasSecurityRisk:   boolean;   // eval, innerHTML, hardcoded strings, SQL concat

  // ── dependencies signals ──────────────────────────────────────
  hasPackageJson:    boolean;   // package.json exists (passed in from outside)

  // ── meta ──────────────────────────────────────────────────────
  lineCount:         number;
  paramCount:        number;
  maxNestingDepth:   number;
}

/**
 * Scan a function's source code and return CodeSignals.
 * All detection is regex/string-based — fast, zero latency.
 *
 * @param code           - Raw TypeScript source of the function
 * @param hasHistory     - Whether LanceDB has history entries for this project
 * @param hasPackageJson - Whether package.json exists in the workspace
 */
export function scanCode(
  code:          string,
  hasHistory     = false,
  hasPackageJson = false,
): CodeSignals {

  const lines = code.split("\n");
  const lineCount = lines.filter(l => l.trim().length > 0).length;

  // ── Async detection ───────────────────────────────────────────
  const hasAsync     = /\basync\b|\bPromise\b/.test(code);
  const hasThenChain = /\.then\s*\(/.test(code) && !/\.catch\s*\(/.test(code);
  const hasJsonParse = /JSON\.parse/.test(code);

  // ── Null access heuristic (3+ dots in one expression) ─────────
  const hasNullAccess = /\w+\.\w+\.\w+/.test(code);

  // ── Nesting depth via bracket counting ────────────────────────
  let depth = 0, maxDepth = 0;
  for (const ch of code) {
    if (ch === "{") { depth++; maxDepth = Math.max(maxDepth, depth); }
    else if (ch === "}") { depth = Math.max(0, depth - 1); }
  }
  // Subtract 1 for the function body itself
  const actualMaxDepth = Math.max(0, maxDepth - 1);
  const hasDeepNesting = actualMaxDepth >= 3;

  // ── Parameter count ───────────────────────────────────────────
  const paramMatch = code.match(/(?:function\s+\w+|=>|\w+\s*=\s*(?:async\s*)?\()\s*\(([^)]*)\)/);
  const paramStr   = paramMatch ? paramMatch[1] : "";
  const paramCount = paramStr.trim().length === 0 ? 0 : paramStr.split(",").length;
  const hasHighParams = paramCount >= 5;

  // ── Branch count ──────────────────────────────────────────────
  const branchMatches = (code.match(/\bif\b|\belse\b|\bswitch\b|\bcase\b|\?\s*[^:]/g) ?? []).length;
  const hasManyBranches = branchMatches >= 6;

  // ── Style violations ──────────────────────────────────────────
  const hasStyleViolation = (
    /\bvar\s+/.test(code)           ||  // var keyword
    /console\.(log|warn|error)/.test(code) ||  // console calls
    /:\s*any\b/.test(code)          ||  // any type
    /\beval\s*\(/.test(code)        ||  // eval
    // snake_case function name
    /function\s+[a-z]+_[a-z]/.test(code) ||
    /const\s+[a-z]+_[a-z]+\s*=\s*(?:async\s*)?\(/.test(code)
  );

  // ── Missing JSDoc ─────────────────────────────────────────────
  // Check if there's a JSDoc block (/** ... */) anywhere before the function
  const hasJsDoc = /\/\*\*[\s\S]*?\*\//.test(code);
  const hasMissingDocs = !hasJsDoc;

  // ── Testable logic ────────────────────────────────────────────
  // Worth testing if it has branches or meaningful return values
  const hasTestableLogic = branchMatches > 0 || /\breturn\b/.test(code);

  // ── Security risks ────────────────────────────────────────────
  const hasSecurityRisk = (
    /\beval\s*\(/.test(code)            ||  // eval
    /innerHTML\s*=/.test(code)          ||  // XSS
    /dangerouslySetInnerHTML/.test(code)||  // React XSS
    // Hardcoded secrets heuristic (key/secret/password = "...")
    /(?:key|secret|password|token|apikey)\s*[=:]\s*["'][^"']{6,}["']/i.test(code) ||
    // SQL string concatenation
    /(SELECT|INSERT|UPDATE|DELETE).*\+\s*\w/.test(code)
  );

  return {
    hasAsync,
    hasThenChain,
    hasJsonParse,
    hasNullAccess,
    hasDeepNesting,
    hasHighParams,
    hasManyBranches,
    hasStyleViolation,
    hasMissingDocs,
    hasTestableLogic,
    hasHistory,
    hasSecurityRisk,
    hasPackageJson,
    lineCount,
    paramCount,
    maxNestingDepth: actualMaxDepth,
  };
}

/**
 * Human-readable summary of which agents will run.
 * Used in the provider routing log panel.
 */
export function explainDispatch(signals: CodeSignals, agents: string[]): string {
  const skipped = [
    "security","quality","errorHandling","complexity",
    "style","docs","tests","duplication","dependencies",
  ].filter(a => !agents.includes(a));

  return [
    `Running: ${agents.join(", ")}`,
    skipped.length > 0 ? `Skipped: ${skipped.join(", ")} (not needed)` : "",
    `Lines: ${signals.lineCount} · Params: ${signals.paramCount} · Max nesting: ${signals.maxNestingDepth}`,
  ].filter(Boolean).join(" | ");
}