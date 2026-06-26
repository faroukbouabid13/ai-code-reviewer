/**
 * agents/orchestrator.ts — 3-group approach
 *
 * Accuracy improvements applied:
 *  §1.3  One focused example per group (nominal case) — shows exact JSON shape
 *  §1.1  Rules include "Reason:" to help model generalise
 *  §1.2  Positive formulation: "write real TypeScript" not "never write null"
 *  temperature: 0.1 on all groups — lower = more deterministic JSON
 *  Output format: single-line JSON template — saves tokens, more room for response
 *
 * Groups:
 *  GROUP 1 → Groq     : security + quality + errorHandling  (deep reasoning)
 *  GROUP 2 → Gemini   : complexity + style + duplication    (pattern detection)
 *  GROUP 3 → Cerebras : docs + tests + dependencies         (generation)
 */

import { callAgent }  from "./caller";
import { parseJSON }  from "../core/parsejson";
import { GROQ_MODEL, GEMINI_MODEL, NVIDIA_MODEL_ERROR,
         NVIDIA_MODEL_G2, NVIDIA_MODEL_G3 } from "../core/config";

import type {
  AnalysisResult, CompileError, DependenciesResult, DebateResult,
} from "../pipeline/types";
import type { AgentInput } from "./prompts";

/* ─────────────────────────────────────────────────────────────────
   SHARED SECTION BUILDERS
   ───────────────────────────────────────────────────────────────── */

const FENCE_MAP: Record<string, string> = {
  typescript: "typescript", javascript: "javascript",
  python: "python", java: "java", go: "go",
};

function langFence(input: AgentInput): string {
  const key = (input.language ?? "TypeScript").toLowerCase().replace(/\s+\d+$/, "");
  return FENCE_MAP[key] ?? key;
}

function codeBlock(input: AgentInput): string {
  return `<function_name>${input.functionName}</function_name>
<code>
\`\`\`${langFence(input)}
${input.code}
\`\`\`
</code>`;
}

function langCtxBlock(input: AgentInput): string {
  if (!input.language || input.language === "TypeScript") { return ""; }
  const parts = [`Language: ${input.language}`];
  if (input.testFramework) { parts.push(`Test framework: ${input.testFramework}`); }
  if (input.docFormat)     { parts.push(`Doc format: ${input.docFormat}`); }
  if (input.languageStyle) { parts.push(`Style conventions: ${input.languageStyle}`); }
  return `<language_context>\n${parts.join("\n")}\n</language_context>`;
}

function fileContextBlock(input: AgentInput): string {
  if (!input.fileContext) { return ""; }
  // Replace double quotes with single quotes so the LLM doesn't mirror
  // the double-quote style into JSON response fields (which breaks parsing)
  const ctx = input.fileContext.replace(/"/g, "'");
  return `<file_context>\n${ctx}\n</file_context>`;
}

function fixedCodeInstruction(input: AgentInput): string {
  const lang = input.language ?? "TypeScript";
  if (lang === "TypeScript" || lang === "JavaScript") {
    return "fixedCode must start with `function`, `async function`, or `const` — never English prose.";
  }
  return `fixedCode must be complete, valid ${lang} code — never English prose.`;
}

function ragBlock(input: AgentInput): string {
  const t = (input.templateMatches ?? [])
    .map((m, i) => `  T${i+1}: "${m.name}" ${(m.similarity*100).toFixed(0)}% — ${m.code}`)
    .join("\n") || "  none";
  const h = (input.historyMatches ?? [])
    .map((m, i) => `  H${i+1}: "${m.functionName}" ${(m.similarity*100).toFixed(0)}% — ${m.code}`)
    .join("\n") || "  none";
  return `<rag><templates>\n${t}\n</templates><history>\n${h}\n</history></rag>`;
}

function prBlock(input: AgentInput): string {
  if (!input.prComments?.length && !input.prTitle) { return ""; }
  const c = (input.prComments ?? []).map(c => `  - ${c.author}: ${c.body}`).join("\n");
  return `<pr>PR #${input.prNumber}: ${input.prTitle}\n${c}</pr>`;
}

function styleBlock(input: AgentInput): string {
  return input.styleConfig
    ? `<style_config>${JSON.stringify(input.styleConfig)}</style_config>`
    : `<style_config>default: camelCase functions, no var/any/console.log/eval, prefer const, async/await over .then()</style_config>`;
}

/* ─────────────────────────────────────────────────────────────────
   SECURITY AGENT — DeepSeek V4 Pro (Think High)
   ───────────────────────────────────────────────────────────────── */

const SECURITY_SYSTEM = `IMPORTANT: Your ENTIRE response must be one JSON object. The very first character must be { and the very last must be }. Never wrap in \`\`\`json fences — any character before { breaks the parser.

You are a senior TypeScript application security engineer. Your sole task: evaluate the function against every item in the MANDATORY CHECKLIST and return a structured JSON report.

══════════════════════════════════════════════════
MANDATORY CHECKLIST — EVALUATE EVERY ITEM
══════════════════════════════════════════════════
 1. SQL/NoSQL injection         — string concat in queries, unsanitised user input
 2. XSS                         — innerHTML, dangerouslySetInnerHTML, unsanitised DOM writes
 3. Hardcoded secrets           — API keys, passwords, tokens as string literals
 4. Code injection              — eval(), new Function(), setTimeout(string)
 5. Prototype pollution         — Object.assign/__proto__ with untrusted input
 6. Path traversal              — unsanitised file paths from user input
 7. Insecure randomness         — Math.random() for tokens, IDs, CSRF values
 8. Missing input validation    — user-controlled data reaches business logic unchecked
 9. Sensitive data in logs      — passwords, tokens, PII in console.log/error
10. Sensitive data in responses — full DB rows, password hashes, internal fields returned to caller
11. Weak token generation       — base64(user+timestamp), sequential IDs, any guessable scheme
12. Timing attacks              — == or === to compare passwords/tokens (must use crypto.timingSafeEqual)
13. Server-side storage misuse  — window/localStorage/sessionStorage referenced in Node.js context

══════════════════════════════════════════════════
SEVERITY → SCORE MAPPING (mandatory, no exceptions)
══════════════════════════════════════════════════
  Any "critical" finding present  →  securityScore MUST be 1–3
  Any "high" finding present      →  securityScore MUST be 4–5
  Any "medium" finding present    →  securityScore MUST be 5–6
  Only "low" findings present     →  securityScore MUST be 7
  Zero vulnerabilities found      →  securityScore MUST be 8–10
  Assigning score ≥7 alongside a critical/high finding is a hard error.

══════════════════════════════════════════════════
OUTPUT RULES
══════════════════════════════════════════════════
- checkedItems[]: one string per checklist item — format exactly "N. <name>: PASS" or "N. <name>: FAIL — <one-line reason>".
  Reason: forces explicit confirmation that no item was silently skipped.
- vulnerabilities[]: one entry per FAIL item. Fields: severity, type, description, impact, fixedCode.
  severity must be exactly one of: "critical" | "high" | "medium" | "low"
- fixedCode: complete corrected function in the SAME LANGUAGE as the input — NEVER English prose. Keep under 20 lines, no docstrings.
- JSON SAFETY — CRITICAL: ALL string values in the JSON MUST be delimited by double-quotes ("). The fixedCode value is a JSON string — it MUST start and end with ". NEVER use ''' or """ as a JSON string delimiter.
  You MUST NOT use double quotes (") inside any fixedCode value — use single quotes (') for ALL string literals in code.
  WRONG: raise ValueError("invalid id")   → breaks JSON parsing
  RIGHT:  raise ValueError('invalid id')   → safe
  WRONG: logger.error("Failed")           → breaks JSON parsing
  RIGHT:  logger.error('Failed')           → safe
  Use \\n for line breaks — never literal newlines inside JSON string values.
- summary: one sentence — worst finding, or "No vulnerabilities detected." Must be the LAST key.
- Raw JSON only. No fences, no text outside the object.

EXAMPLE OUTPUT (TypeScript):
{"securityScore":2,"checkedItems":["1. SQL injection: PASS","2. XSS: PASS","3. Hardcoded secrets: PASS","4. Code injection: PASS","5. Prototype pollution: PASS","6. Path traversal: PASS","7. Insecure randomness: PASS","8. Input validation: PASS","9. Sensitive data in logs: PASS","10. Sensitive data in responses: PASS","11. Weak token generation: FAIL — Buffer.from(username+Date.now()) is base64-predictable","12. Timing attacks: FAIL — plain == used to compare token","13. Server-side storage: PASS"],"vulnerabilities":[{"severity":"critical","type":"Weak Token Generation","description":"Token is base64(username+timestamp) — trivially predictable","impact":"Account takeover without brute-force","fixedCode":"const token = crypto.randomBytes(32).toString('hex');"},{"severity":"high","type":"Timing Attack","description":"Token compared with == leaks length via timing","impact":"Attacker enumerates token bytes via timing oracle","fixedCode":"if (!crypto.timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(token,'hex'))) throw new Error('Invalid token');"}],"summary":"Critical weak token and timing-attack vulnerability in auth flow."}

EXAMPLE OUTPUT (Python) — notice fixedCode uses " as JSON delimiter with single-quoted strings INSIDE:
{"securityScore":2,"checkedItems":["1. SQL injection: PASS","2. XSS: PASS","3. Hardcoded secrets: FAIL — API_KEY assigned as string literal","4. Code injection: PASS","5. Prototype pollution: PASS","6. Path traversal: PASS","7. Insecure randomness: PASS","8. Input validation: FAIL — user_id not validated","9. Sensitive data in logs: PASS","10. Sensitive data in responses: PASS","11. Weak token generation: PASS","12. Timing attacks: PASS","13. Server-side storage: PASS"],"vulnerabilities":[{"severity":"critical","type":"Hardcoded Secret","description":"API_KEY is a string literal in source code — visible in version control to all contributors","impact":"Any repo reader can authenticate as the service and access the API","fixedCode":"import os\\nimport requests\\n\\ndef Get_User_Data(user_id):\\n    api_key = os.environ.get('API_KEY')\\n    if not api_key:\\n        raise ValueError('API_KEY environment variable not set')\\n    headers = {'Authorization': f'Bearer {api_key}'}\\n    response = requests.get(f'https://api.example.com/users/{user_id}', headers=headers, timeout=10)\\n    response.raise_for_status()\\n    return response.json()"}],"summary":"Critical hardcoded API key must be moved to an environment variable."}`;

/* ─────────────────────────────────────────────────────────────────
   QUALITY AGENT — Mistral Large 3 675B
   ───────────────────────────────────────────────────────────────── */

const QUALITY_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are a senior code quality engineer for multiple languages (TypeScript, JavaScript, Python, Java, Go). Analyse the function for bugs, logic errors, performance issues, and readability ONLY. When <language_context> is present, generate all fixedCode in that language.

RULES:
- score: 1-4=bug/wrong output, 5-7=smell, 8-10=clean
- CALIBRATION: score 8-10 means ZERO issues. If issues[] non-empty, score MUST be ≤7. Default to 5 when uncertain.
- DO NOT write a refactoredFunction. A dedicated synthesis agent handles the final refactor after reading ALL agents' findings.
- Use EXACTLY: severity, description, suggestion, fixedCode. Never use message/text/fix/level.
- fixedCode: one short corrected snippet (max 6 lines, NO comments, NO docstrings). Show only the fixed line(s). Never write the full function here.
- issues[]: report ALL issues found, up to MAX 6. description: one sentence, max 12 words. suggestion: one sentence, max 10 words.
- JSON SAFETY — CRITICAL: ALL JSON string values MUST be delimited by double-quotes ("). NEVER use single quotes (') or triple quotes as a JSON string delimiter.
  Inside the code value: use single quotes for string literals → console.error('Failed') not console.error("Failed")
  Use \\n for line breaks — NEVER literal newlines inside a JSON string value.
- KEY ORDER: output keys in this exact order: score, summary, matchedTemplate, prInsight, issues.
- Output raw JSON only. Start with { end with }.

EXAMPLE OUTPUT:
{"score":4,"summary":"Off-by-one crash and missing types on all parameters.","matchedTemplate":null,"prInsight":"No PR context.","issues":[{"severity":"error","description":"Loop condition i <= arr.length crashes on last item","suggestion":"Change to i < arr.length","fixedCode":"for (let i = 0; i < arr.length; i++) {"},{"severity":"error","description":"All parameters are untyped, defeating TypeScript safety","suggestion":"Add explicit types to every parameter","fixedCode":"function sum(arr: number[], scale: number): number {"},{"severity":"warning","description":"var keyword used instead of const or let","suggestion":"Replace var with const or let throughout","fixedCode":"const result: number[] = [];"}]}`;

/* ─────────────────────────────────────────────────────────────────
   ERROR HANDLING AGENT — DeepSeek V4 Flash
   ───────────────────────────────────────────────────────────────── */

const ERROR_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are an error handling specialist for multiple languages (TypeScript, JavaScript, Python, Java, Go). Analyse the function for missing or inadequate error handling ONLY. When <language_context> is present, generate all fixedCode in that language using its native error-handling idioms (try/except for Python, try/catch for Java, explicit error returns for Go).

RULES:
- errorHandlingScore: 1-3=async no catch, 4-6=partial, 7-10=adequate
- CALIBRATION: score 8-10 means ZERO issues. If issues[] non-empty, score MUST be ≤7. Default to 5 when uncertain.
- severity "critical" ONLY for async functions with zero error boundary.
- Use EXACTLY these fields: severity, type, description, lineHint. Never add fixedCode, message, text, or fix.
- lineHint: the exact line of code (one line max, no newlines) that is the problem.
- Output raw JSON only. Start with { end with }.

CHECK FOR: async without try/catch, .then() without .catch(), null dereference, JSON.parse without try/catch, empty catch blocks.

EXAMPLE OUTPUT:
{"errorHandlingScore":2,"issues":[{"severity":"critical","type":"missing try/catch","description":"Async DB call with no error boundary — wrap in try/catch and rethrow or log","lineHint":"await db.insert(user)"},{"severity":"major","type":"empty catch","description":"Catch block swallows the error silently","lineHint":"} catch(e) {}"}],"summary":"Critical — async function with no error boundary."}`;

function buildSecurityUser(input: AgentInput, compileErrors: CompileError[]): string {
  const errBlock = compileErrors.length > 0
    ? `<compile_errors>\n${compileErrors.map(e => `  line ${e.line}: ${e.message}`).join("\n")}\n</compile_errors>`
    : "";
  return [langCtxBlock(input), fileContextBlock(input), codeBlock(input), errBlock, ragBlock(input), prBlock(input)].filter(Boolean).join("\n") +
    `\n\nAnalyse ONLY security vulnerabilities. ${fixedCodeInstruction(input)}`;
}

function buildQualityUser(input: AgentInput, compileErrors: CompileError[]): string {
  const errBlock = compileErrors.length > 0
    ? `<compile_errors>\n${compileErrors.map(e => `  line ${e.line}: ${e.message}`).join("\n")}\n</compile_errors>`
    : "";
  return [langCtxBlock(input), fileContextBlock(input), codeBlock(input), errBlock, ragBlock(input), prBlock(input)].filter(Boolean).join("\n") +
    `\n\nAnalyse ONLY code quality (bugs, logic errors, performance). ${fixedCodeInstruction(input)}`;
}

function buildErrorUser(input: AgentInput, compileErrors: CompileError[]): string {
  const errBlock = compileErrors.length > 0
    ? `<compile_errors>\n${compileErrors.map(e => `  line ${e.line}: ${e.message}`).join("\n")}\n</compile_errors>`
    : "";
  return [langCtxBlock(input), fileContextBlock(input), codeBlock(input), errBlock].filter(Boolean).join("\n") +
    `\n\nAnalyse ONLY error handling gaps. ${fixedCodeInstruction(input)}`;
}

/* ─────────────────────────────────────────────────────────────────
   GROUP 2 — Gemini
   complexity + style + duplication
   ───────────────────────────────────────────────────────────────── */

const GROUP2_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are a complexity analyst, style enforcer, and duplication detector for multiple languages (TypeScript, JavaScript, Python, Java, Go). Analyse the function for complexity metrics, style violations, and code duplication. Return a single JSON object with three sections.

RULES:
- complexityScore: subtract 2 per threshold exceeded. Thresholds: cyclomatic>10=critical, nesting>=3=warning, params>4=warning. IMPORTANT: if maxNestingDepth is 3 or higher you MUST add an issue to issues[] — do not leave issues empty when a threshold is exceeded.
- styleScore: apply style_config rules if provided. When <language_context> is present, apply the style conventions listed there. Otherwise flag language-specific anti-patterns (var/any/console.log/eval for TypeScript; bare except/mutable defaults/print for Python; raw types/magic numbers for Java; ignored error returns for Go).
- duplicationScore: 10=no dup, 1=severe dup. isDuplicate=true only when RAG similarity>75%.
- Use EXACTLY these field names: description, suggestion, rule, severity. Never add fixedCode, message, text, fix, or level.
- suggestion: one short sentence describing the fix in plain English — NO code, NO function bodies, NO snippets.
- CALIBRATION: complexityScore/styleScore/duplicationScore of 8-10 means ZERO issues found in that section. If violations[] or issues[] is non-empty, the score MUST be 7 or lower. Giving 8+ while also listing issues is a contradiction — default to 5 when uncertain, never 8.
- Output raw JSON only. Do NOT use markdown code fences. Start your response with { and end with }. Reason: markdown breaks the parser.

EXAMPLE INPUT:
function calculate_user_score(user_data: any) { var result=0; for(var i=0;i<user_data.items.length;i++){if(user_data.items[i].active){result+=user_data.items[i].points;}} return result; }

EXAMPLE OUTPUT:
{"complexity":{"complexityScore":7,"cyclomaticComplexity":3,"cognitiveComplexity":"medium","linesOfCode":3,"maxNestingDepth":2,"parameterCount":1,"issues":[],"summary":"Acceptable complexity but loop replaceable with reduce."},"style":{"styleScore":2,"violations":[{"rule":"naming.functions=camelCase","severity":"warning","description":"Function uses snake_case","suggestion":"Rename to camelCase: calculateUserScore"},{"rule":"forbidden:any","severity":"warning","description":"Parameter typed as any","suggestion":"Replace any with a concrete interface e.g. UserData"},{"rule":"forbidden:var","severity":"warning","description":"var used twice","suggestion":"Replace both var declarations with const"},{"rule":"preferred:Array methods","severity":"info","description":"Manual for loop replaceable with filter+reduce","suggestion":"Rewrite the loop using .filter() and .reduce()"}],"summary":"Four violations: snake_case, any, var, manual loop."},"duplication":{"duplicationScore":8,"isDuplicate":false,"similarityPercent":0,"issues":[],"summary":"No duplication detected."}}`;

function buildGroup2User(input: AgentInput): string {
  return [
    langCtxBlock(input),
    codeBlock(input),
    styleBlock(input),
    ragBlock(input),
  ].filter(Boolean).join("\n") +
  `\n\nAnalyse complexity, style, and duplication. ${fixedCodeInstruction(input)}`;
}

/* ─────────────────────────────────────────────────────────────────
   GROUP 3 — Cerebras
   docs + tests + dependencies
   ───────────────────────────────────────────────────────────────── */

const GROUP3_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are a documentation specialist, test engineer, and dependency analyst for multiple languages (TypeScript, JavaScript, Python, Java, Go). Generate a doc comment, a test suite, and a dependency report. Return a single JSON object with three sections.

RULES:
- hasAdequateDocs: true ONLY when parameters, return type, and at least one example are ALL documented.
- jsdocBlock: write a complete, paste-ready doc comment. CRITICAL FORMAT RULE: the JSON value MUST be wrapped in double-quotes like any other JSON string: "jsdocBlock": "...content...". For TypeScript/JavaScript use JSDoc (/**). For Python use Google-style with ''' triple-single-quote inside the JSON string — the ''' is Python syntax INSIDE the " JSON string, it is NOT the JSON delimiter. For Java use Javadoc. For Go use GoDoc.
- testCode: write a complete test suite in the SAME FRAMEWORK as the input language: Jest describe() for TypeScript/JavaScript, pytest functions (def test_) for Python, JUnit 5 for Java, testing.T for Go. Reason: developer copies it directly. Include: happy path, null/None input, boundary values, error cases.
- Mock external calls (jest.fn() / unittest.mock / Mockito) — no real I/O in tests.
- dependencyScore: 10=no issues, 1=critical CVE. Flag lodash<4.17.21, axios<1.6.0, minimist<1.2.6.
- Use EXACTLY these field names: description, suggestion, fixedCode, severity, jsdocBlock, testCode. Never use message/text/fix/level instead.
- CALIBRATION: dependencyScore of 8-10 means ZERO dependency issues found. If issues[] is non-empty, score MUST be 7 or lower. Default to 5 when uncertain, never 8.
- JSON SAFETY — CRITICAL: ALL string values in the JSON MUST be delimited by double-quotes ("). NEVER use ''' or \"\"\" as a JSON string delimiter — they are only valid INSIDE an already-opened \" JSON string.
  You MUST NOT use double quotes (") inside jsdocBlock or testCode values — use single quotes (') for ALL string literals and dict keys in code. Use \\n for line breaks. Violating this breaks the JSON parser and your entire response is lost.
  For Python dicts in assertions — WRONG: assert r == {"id": 1}  RIGHT: assert r == {'id': 1}
  For Python strings in tests — WRONG: mock.return_value = {"status": "ok"}  RIGHT: mock.return_value = {'status': 'ok'}
  For Python f-strings — WRONG: f"Hello {name}"  RIGHT: f'Hello {name}'
- Output raw JSON only. Do NOT use markdown code fences. Start your response with { and end with }. Reason: markdown breaks the parser.

EXAMPLE INPUT (TypeScript):
function divide(a: number, b: number): number { if(b===0) throw new Error('Division by zero'); return a/b; }

EXAMPLE OUTPUT (TypeScript):
{"docs":{"hasAdequateDocs":false,"functionNameSuggestion":null,"paramSuggestions":[],"jsdocBlock":"/**\\n * Divides two numbers.\\n * @param {number} a - The dividend.\\n * @param {number} b - The divisor.\\n * @returns {number} The result of a divided by b.\\n * @throws {Error} When b is zero.\\n * @example divide(10,2); // 5\\n */","summary":"No JSDoc present — generated complete block."},"tests":{"testCode":"describe('divide', () => {\\n  it('divides two positive numbers', () => { expect(divide(10,2)).toBe(5); });\\n  it('throws when divisor is zero', () => { expect(()=>divide(10,0)).toThrow('Division by zero'); });\\n  it('returns 0 when dividend is 0', () => { expect(divide(0,5)).toBe(0); });\\n});","testCount":3,"edgeCasesCovered":["zero divisor throws","zero dividend"],"summary":"3 tests covering happy path and zero divisor error."},"dependencies":{"dependencyScore":10,"issues":[],"summary":"No package.json provided."}}

EXAMPLE INPUT (Python):
def get_item(item_id): return db.query(item_id)

EXAMPLE OUTPUT (Python) — notice jsdocBlock uses " as JSON delimiter with ''' INSIDE the string:
{"docs":{"hasAdequateDocs":false,"functionNameSuggestion":null,"paramSuggestions":["item_id: str"],"jsdocBlock":"'''\\nGet item by ID.\\n\\nArgs:\\n    item_id: The item identifier.\\n\\nReturns:\\n    dict: Item data or None.\\n\\nExample:\\n    result = get_item('abc123')\\n'''","summary":"No docstring present — generated Google-style block."},"tests":{"testCode":"import pytest\\nfrom unittest.mock import patch, MagicMock\\n\\ndef test_get_item_success():\\n    with patch('db.query', return_value={'id': '1', 'name': 'test'}) as mock_q:\\n        result = get_item('1')\\n        mock_q.assert_called_once_with('1')\\n        assert result == {'id': '1', 'name': 'test'}\\n\\ndef test_get_item_none():\\n    with patch('db.query', return_value=None):\\n        assert get_item('missing') is None\\n","testCount":2,"edgeCasesCovered":["happy path","none result"],"summary":"2 pytest tests covering success and missing item."},"dependencies":{"dependencyScore":10,"issues":[],"summary":"No package.json provided."}}`;

function buildGroup3User(input: AgentInput): string {
  const deps = input.packageJson
    ? `<package_json>${JSON.stringify({ dependencies: input.packageJson.dependencies ?? {}, devDependencies: input.packageJson.devDependencies ?? {} })}</package_json>`
    : "<package_json>No package.json found — set dependencyScore to 10, empty issues.</package_json>";

  const temporalBlock = input.ageInDays !== undefined
    ? `<temporal_context>This function is ${input.ageInDays} days old (last commit ${input.lastModifiedDate?.slice(0, 10) ?? "unknown"}). If age > 90 days, flag any deprecated APIs or patterns that have modern replacements.</temporal_context>`
    : "";

  const lang       = input.language ?? "TypeScript";
  const docFormat  = input.docFormat  ?? "JSDoc";
  const testFw     = input.testFramework ?? "Jest";
  const docInstr   = `jsdocBlock must be a complete ${docFormat} comment in ${lang} style`;
  const testInstr  = `testCode must be a complete ${testFw} test suite`;

  return [langCtxBlock(input), codeBlock(input), deps, temporalBlock].filter(Boolean).join("\n") +
  `\n\nGenerate documentation, tests, and dependency analysis. ${docInstr}. ${testInstr}. Never English prose.`;
}

/* ─────────────────────────────────────────────────────────────────
   TWO AGENTS DEBATE — grey-zone scores (4-7) only
   Agent A (Strict Senior Engineer) vs Agent B (Pragmatic Developer)
   debate over the actual issues other agents flagged. The developer
   sees both sides and makes the final call — no automated verdict.
   ───────────────────────────────────────────────────────────────── */

const DEBATE_STRICT_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are "Agent A — Strict Senior Engineer" debating whether a TypeScript function should be merged. You have been given a borderline review score (4-7) plus the specific issues other reviewers flagged. Your role: argue that every flagged issue is critical and MUST be fixed before merge. Be specific, cite the actual issues, never soften your stance — that is Agent B's job, not yours.

RULES:
- verdict: must be exactly "block".
- openingStatement: one or two sentences stating your position.
- arguments[]: one entry per issue you are escalating. Fields: issue, reasoning. reasoning explains concretely why this is a merge-blocker (production risk, security exposure, maintenance cost) — no hedging words like "might" or "could potentially".
- Output raw JSON only. Start with { end with }.

EXAMPLE OUTPUT:
{"verdict":"block","openingStatement":"This function has unresolved security and error-handling gaps that will cause incidents in production — none of these are acceptable to ship.","arguments":[{"issue":"Missing try/catch around async DB call","reasoning":"An unhandled rejection here crashes the request handler and surfaces a raw stack trace to the client — this is a guaranteed outage, not a hypothetical."},{"issue":"Cyclomatic complexity of 12","reasoning":"At this complexity no reviewer can verify correctness by reading the code, which means every future change to this function is a regression risk."}]}`;

const DEBATE_PRAGMATIC_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are "Agent B — Pragmatic Developer" debating whether a TypeScript function should be merged. You have been given a borderline review score (4-7) plus the specific issues other reviewers flagged. Your role: argue the tradeoffs are acceptable given real-world constraints — deadlines, blast radius, how often this code path runs, whether it's internal tooling vs customer-facing, and the cost of delaying the merge. You are not dismissing the issues — you are weighing them against shipping reality.

RULES:
- verdict: must be exactly "approve_with_followup".
- openingStatement: one or two sentences stating your position.
- arguments[]: one entry per issue you are willing to accept for now. Fields: issue, reasoning. reasoning gives a concrete real-world justification — do not pretend the issue doesn't exist.
- Output raw JSON only. Start with { end with }.

EXAMPLE OUTPUT:
{"verdict":"approve_with_followup","openingStatement":"These are real issues, but none are exploitable in this internal-only code path, and blocking the merge costs us a sprint we don't have.","arguments":[{"issue":"Missing try/catch around async DB call","reasoning":"This runs behind an admin-only feature flag with no external traffic — file a follow-up ticket and fix it in the next pass rather than holding the release."},{"issue":"Cyclomatic complexity of 12","reasoning":"The function is well-covered by the generated test suite, so the complexity risk is mitigated even without an immediate refactor."}]}`;

/* ─────────────────────────────────────────────────────────────────
   SYNTHESIS AGENT — final refactor incorporating ALL findings
   ───────────────────────────────────────────────────────────────── */

const SYNTHESIS_SYSTEM = `IMPORTANT: Start your response with { and end with }. Do NOT use markdown code fences. Raw JSON only.

You are a staff engineer doing the FINAL refactor pass. You have the original code and ALL issues found by 9 specialized agents (security, quality, error handling, complexity, style, duplication). Your job: write ONE definitive refactored function FROM SCRATCH that fixes EVERY issue listed. Do not copy the original — rewrite it cleanly.

RULES:
- Fix ALL issues from ALL categories listed in the input — not just quality ones.
- Output ONLY: {"refactoredFunction":"..."}
- Function definition only. NO import statements. NO module-level code. Start directly with def/function/async function/const.
- Under 40 lines.
- JSON SAFETY: use single quotes for ALL string literals inside the code. Use \\n for line breaks — NEVER literal newlines inside the JSON string value.
- TypeScript rules: NEVER use 'any' — use specific types or 'unknown'. Caught errors must be catch(e: unknown) narrowed with (e instanceof Error ? e.message : String(e)). fetch() must use AbortController with 5000ms timeout. Return types must be explicit. Validate string inputs (falsy check). Return null not undefined on failure. ALWAYS use template literals — NEVER string concatenation.
- Python rules: NEVER hardcode secrets — use os.environ.get('KEY','') instead. Always catch specific exceptions (requests.RequestException, ValueError, json.JSONDecodeError), never bare except. Always pass timeout=10 to requests calls. Use snake_case names and f-strings. Add type hints to all params and return value.
- LOGGING RULE: NEVER log business data, user data, API responses, or objects with JSON.stringify — this is a security violation. Only log counts, IDs, status codes. WRONG: console.log(JSON.stringify(orders)) — RIGHT: console.log('fetched', orders.length, 'orders').
- The result must score 8-10/10 on re-analysis. It must leave ZERO of the listed issues unfixed.

EXAMPLE OUTPUT (TypeScript fetch with timeout, no data logging, template literals):
{"refactoredFunction":"async function fetchUserOrders(userId: string): Promise<Order[] | null> {\\n  if (!userId) return null;\\n  const apiKey = process.env.API_KEY || '';\\n  if (!apiKey) { console.error('API_KEY not set'); return null; }\\n  const ctrl = new AbortController();\\n  const timer = setTimeout(() => ctrl.abort(), 5000);\\n  try {\\n    const res = await fetch('/api/orders?user=' + userId, { headers: { 'Authorization': 'Bearer ' + apiKey }, signal: ctrl.signal });\\n    clearTimeout(timer);\\n    if (!res.ok) { console.error('fetchUserOrders HTTP', res.status); return null; }\\n    const data = await res.json();\\n    const active = (data?.orders ?? []).filter((o: Order) => o.status === 'active');\\n    console.log('fetched', active.length, 'active orders');\\n    return active;\\n  } catch (e: unknown) {\\n    clearTimeout(timer);\\n    console.error('fetchUserOrders failed:', e instanceof Error ? e.message : String(e));\\n    return null;\\n  }\\n}"}`;

function buildSynthesisUser(input: AgentInput, qual: any, sec: any, err: any, g2: any): string {
  const issues: string[] = [];
  (sec?.vulnerabilities    ?? []).forEach((v: any) => issues.push(`[security/${v.severity}] ${v.type}: ${v.description}`));
  (qual?.issues            ?? []).forEach((i: any) => issues.push(`[quality/${i.severity}] ${i.description}${i.suggestion ? " → " + i.suggestion : ""}`));
  (err?.issues             ?? []).forEach((i: any) => issues.push(`[errorHandling/${i.severity}] ${i.type ?? "issue"}: ${i.description}`));
  (g2?.style?.violations   ?? []).forEach((v: any) => issues.push(`[style] ${v.rule}: ${v.description}`));
  (g2?.complexity?.issues  ?? []).forEach((i: any) => issues.push(`[complexity] ${i.description}`));
  (g2?.duplication?.issues ?? []).forEach((i: any) => issues.push(`[duplication] ${i.description}`));

  const issueList = issues.length
    ? issues.map((x, n) => `${n + 1}. ${x}`).join("\n")
    : "No specific issues — improve overall code quality and robustness.";

  return `ORIGINAL CODE:\n${codeBlock(input)}\n\nALL ISSUES FOUND BY 9 AGENTS (fix every single one):\n${issueList}\n\nWrite the complete refactored function from scratch fixing ALL issues above. Output JSON only.`;
}

function buildIssuesSummary(sec: any, qual: any, err: any, g2: any): string {
  const lines: string[] = [];
  (sec?.vulnerabilities      ?? []).forEach((v: any) => lines.push(`[security/${v.severity}] ${v.type}: ${v.description}`));
  (qual?.issues              ?? []).forEach((i: any) => lines.push(`[quality/${i.severity}] ${i.description}`));
  (err?.issues               ?? []).forEach((i: any) => lines.push(`[errorHandling/${i.severity}] ${i.type}: ${i.description}`));
  (g2?.complexity?.issues    ?? []).forEach((i: any) => lines.push(`[complexity/${i.severity}] ${i.description}`));
  (g2?.style?.violations     ?? []).forEach((i: any) => lines.push(`[style/${i.severity}] ${i.description}`));
  (g2?.duplication?.issues   ?? []).forEach((i: any) => lines.push(`[duplication/${i.severity}] ${i.description}`));
  return lines.length ? lines.join("\n") : "No specific issues recorded — borderline score from calibration averaging.";
}

function buildDebateUser(input: AgentInput, score: number, issuesSummary: string): string {
  return `${codeBlock(input)}\n<overall_score>${score}/10</overall_score>\n<flagged_issues>\n${issuesSummary}\n</flagged_issues>\n\nArgue your assigned position using ONLY the issues listed above.`;
}

/* ─────────────────────────────────────────────────────────────────
   WEIGHTED SCORE CALCULATOR
   ───────────────────────────────────────────────────────────────── */

function calcOverallScore(sec: any, qual: any, err: any, g2: any, g3: any): number {
  const n = (v: any, fallback = 5) => {
    const x = Number(v ?? fallback);
    return isNaN(x) ? fallback : Math.min(10, Math.max(1, x));
  };
  const docScore = g3?.docs?.hasAdequateDocs ? 9 : 4;
  return Math.round(
    n(sec?.securityScore)                * 0.25 +
    n(qual?.score)                       * 0.25 +
    n(err?.errorHandlingScore)           * 0.15 +
    n(g2?.complexity?.complexityScore)   * 0.15 +
    n(g2?.style?.styleScore)             * 0.10 +
    docScore                              * 0.05 +
    n(g2?.duplication?.duplicationScore) * 0.05
  );
}

/* ─────────────────────────────────────────────────────────────────
   MAIN ENTRY POINT — 3 parallel staggered calls
   ───────────────────────────────────────────────────────────────── */

export async function runAgentWaves(
  agentInput:         AgentInput,
  dependenciesResult: DependenciesResult | null,
  compileErrors:      CompileError[],
  providerLog:        string[],
  onPartial?:         (section: string, result: any) => void,
): Promise<AnalysisResult> {

  const secUser  = buildSecurityUser(agentInput, compileErrors);
  const qualUser = buildQualityUser(agentInput, compileErrors);
  const errUser  = buildErrorUser(agentInput, compileErrors);
  const g2User   = buildGroup2User(agentInput);
  const g3User   = buildGroup3User(agentInput);

  const unwrap = (raw: any, ...keys: string[]) =>
    keys.every(k => !raw?.[k])
      ? (raw?.analysis ?? raw?.result ?? raw?.data ?? raw?.output ?? raw)
      : raw;

  // ── Ordered streaming — agents run in parallel but sections are
  //    delivered to the UI in a fixed sequence regardless of finish order.
  const STREAM_ORDER = [
    "security", "quality", "refactor", "errorHandling",
    "complexity", "style", "duplication",
    "docs", "tests", "dependencies", "debate",
  ];
  const streamBuf = new Map<string, any>();
  let streamNext  = 0;

  function emit(section: string, result: any) {
    streamBuf.set(section, result);
    // Release every consecutive section that is now ready
    while (streamNext < STREAM_ORDER.length) {
      const s = STREAM_ORDER[streamNext];
      if (!streamBuf.has(s)) { break; }
      onPartial?.(s, streamBuf.get(s));
      streamBuf.delete(s);
      streamNext++;
    }
  }

  // ── All 5 agents in parallel ──────────────────────────────────────
  let sec:      any = null;
  let qual:     any = null, qualRaw   = "";
  let err:      any = null, errRaw    = "";
  let g2:       any = null, g2Parsed: any = null, g2Raw = "";
  let g3:       any = null, g3Raw     = "";

  const secProm = callAgent(SECURITY_SYSTEM, secUser, "security").then(raw => {
    try {
      sec = parseJSON(raw);
      if (sec) { emit("security", sec); }
    } catch {}
    return raw;
  });

  const qualProm = callAgent(QUALITY_SYSTEM, qualUser, "quality").then(raw => {
    try {
      qualRaw = raw; qual = parseJSON(raw);
      if (qual?.score !== undefined) {
        emit("quality", qual);
      }
    } catch {}
    return raw;
  });

  const errProm = callAgent(ERROR_SYSTEM, errUser, "errorHandling").then(raw => {
    try {
      errRaw = raw; err = parseJSON(raw);
      if (err?.errorHandlingScore !== undefined) { emit("errorHandling", err); }
    } catch {}
    return raw;
  });

  const g2Prom = callAgent(GROUP2_SYSTEM, g2User, "style").then(raw => {
    try {
      g2Raw = raw; g2Parsed = parseJSON(raw);
      g2 = unwrap(g2Parsed, "complexity", "style", "duplication");
      if (g2?.complexity)  { emit("complexity",  g2.complexity);  }
      if (g2?.style)       { emit("style",        g2.style);       }
      if (g2?.duplication) { emit("duplication",  g2.duplication); }
    } catch {}
    return raw;
  });

  const g3Prom = callAgent(GROUP3_SYSTEM, g3User, "docs").then(raw => {
    try {
      g3Raw = raw;
      const g3Parsed = parseJSON(raw);
      g3 = unwrap(g3Parsed, "docs", "tests", "dependencies");
      if (g3?.docs)         { emit("docs",         g3.docs);         }
      if (g3?.tests)        { emit("tests",         g3.tests);        }
      if (g3?.dependencies) { emit("dependencies",  g3.dependencies); }
    } catch {}
    return raw;
  });

  const [rSec, rQual, rErr, r2, r3] = await Promise.allSettled([secProm, qualProm, errProm, g2Prom, g3Prom]);

  // ── Provider log ──────────────────────────────────────────────────
  providerLog.push(`security agent  → Groq ${GROQ_MODEL}         · ${rSec.status}`);
  providerLog.push(`quality agent   → Gemini ${GEMINI_MODEL}     · ${rQual.status}`);
  providerLog.push(`error agent     → NVIDIA ${NVIDIA_MODEL_ERROR} · ${rErr.status}`);
  providerLog.push(`group 2 (complexity+style+duplication) → NVIDIA ${NVIDIA_MODEL_G2} · ${r2.status}`);
  providerLog.push(`group 3 (docs+tests+dependencies)      → NVIDIA ${NVIDIA_MODEL_G3} · ${r3.status}`);

  if (rSec.status  === "rejected") { providerLog.push(`security error: ${(rSec  as any).reason?.message ?? "unknown"}`); }
  if (rQual.status === "rejected") { providerLog.push(`quality error:  ${(rQual as any).reason?.message ?? "unknown"}`); }
  if (rErr.status  === "rejected") { providerLog.push(`error error:    ${(rErr  as any).reason?.message ?? "unknown"}`); }
  if (r2.status    === "rejected") { providerLog.push(`group 2 error:  ${(r2    as any).reason?.message ?? "unknown"}`); }
  if (r3.status    === "rejected") { providerLog.push(`group 3 error:  ${(r3    as any).reason?.message ?? "unknown"}`); }

  // ── Parse warnings ────────────────────────────────────────────────
  if (rSec.status  === "fulfilled" && !sec?.securityScore)     { const r=(rSec as any).value??""; providerLog.push(`security parse warn: keys=[${Object.keys(sec??{}).join(",")}] len=${r.length} start="${r.slice(0,120)}" end="${r.slice(-120)}"`); }
  if (rQual.status === "fulfilled" && !qual?.score)            { providerLog.push(`quality parse warn:  keys=[${Object.keys(qual??{}).join(",")}] len=${qualRaw.length} end="${qualRaw.slice(-120)}"`); }
  if (rErr.status  === "fulfilled" && !err?.errorHandlingScore){ providerLog.push(`error parse warn: keys=[${Object.keys(err??{}).join(",")}] len=${errRaw.length} start="${errRaw.slice(0,120)}" end="${errRaw.slice(-80)}"`); }
  if (r2.status    === "fulfilled" && !g2?.complexity)         { providerLog.push(`group 2 parse warn: keys=[${Object.keys(g2Parsed??{}).join(",")}] len=${g2Raw.length} start="${g2Raw.slice(0,120)}" end="${g2Raw.slice(-80)}"`); }
  if (r3.status    === "fulfilled" && !g3?.docs)               { providerLog.push(`group 3 parse warn:  keys=[${Object.keys(g3??{}).join(",")}] len=${g3Raw.length} start="${g3Raw.slice(0,150)}" end="${g3Raw.slice(-80)}"`); }

  const overallScore = calcOverallScore(sec, qual, err, g2, g3);

  // ── Synthesis agent — final refactor incorporating ALL findings ───
  if (qual?.score !== undefined && qual.score < 8) {
    try {
      const synthesisUser = buildSynthesisUser(agentInput, qual, sec, err, g2);
      const synthRaw      = await callAgent(SYNTHESIS_SYSTEM, synthesisUser, "synthesis");
      const synth         = parseJSON(synthRaw);
      if (synth?.refactoredFunction) {
        qual.refactoredFunction = synth.refactoredFunction;
        emit("refactor", synth.refactoredFunction);
        providerLog.push(`synthesis agent → groq ${GROQ_MODEL} · fulfilled`);
      } else {
        providerLog.push(`synthesis agent: no refactoredFunction in response`);
      }
    } catch (e: any) {
      providerLog.push(`synthesis agent error: ${e.message ?? "unknown"}`);
    }
  }

  // ── Two Agents Debate — grey-zone scores (4-7) only ──────────────
  let debate: DebateResult | null = null;
  if (overallScore >= 3 && overallScore <= 7) {
    const issuesSummary = buildIssuesSummary(sec, qual, err, g2);
    const debateUser    = buildDebateUser(agentInput, overallScore, issuesSummary);

    const [rStrict, rPrag] = await Promise.allSettled([
      callAgent(DEBATE_STRICT_SYSTEM, debateUser, "debateStrict").then(raw => parseJSON(raw)),
      callAgent(DEBATE_PRAGMATIC_SYSTEM, debateUser, "debatePragmatic").then(raw => parseJSON(raw)),
    ]);

    providerLog.push(`debate (strict senior engineer) · ${rStrict.status}`);
    providerLog.push(`debate (pragmatic developer)    · ${rPrag.status}`);

    const strict = rStrict.status === "fulfilled" ? rStrict.value : null;
    const prag   = rPrag.status   === "fulfilled" ? rPrag.value   : null;

    if (strict?.verdict || prag?.verdict) {
      debate = {
        triggered:          true,
        strictEngineer:     strict ?? { verdict: "block", openingStatement: "Strict reviewer unavailable.", arguments: [] },
        pragmaticDeveloper: prag   ?? { verdict: "approve_with_followup", openingStatement: "Pragmatic reviewer unavailable.", arguments: [] },
      };
      emit("debate", debate);
    }
  }

  return {
    functionName:  agentInput.functionName,
    overallScore,
    security:      sec  ?? null,
    quality:       qual ?? null,
    errorHandling: err  ?? null,
    complexity:    g2?.complexity  ?? null,
    style:         g2?.style       ?? null,
    duplication:   g2?.duplication ?? null,
    docs:          g3?.docs        ?? null,
    tests:         g3?.tests       ?? null,
    dependencies:  g3?.dependencies ?? dependenciesResult,
    compileErrors,
    dnaMismatch:   null,
    temporalDecay: null,
    debate,
  };
}

/* ─────────────────────────────────────────────────────────────────
   mergeResults — kept for compatibility with analyze.ts
   ───────────────────────────────────────────────────────────────── */

export function mergeResults(
  fnName:        string,
  quality:       any, style: any, security: any, tests: any,
  docs:          any, complexity: any, errorHandling: any,
  duplication:   any, dependencies: any, compileErrors: CompileError[],
): AnalysisResult {
  const overallScore = Math.round(
    (security?.securityScore           ?? 5) * 0.25 +
    (quality?.score                    ?? 5) * 0.25 +
    (errorHandling?.errorHandlingScore ?? 5) * 0.15 +
    (complexity?.complexityScore       ?? 5) * 0.15 +
    (style?.styleScore                 ?? 5) * 0.10 +
    ((docs?.hasAdequateDocs ? 9 : 4)        ) * 0.05 +
    (duplication?.duplicationScore     ?? 5) * 0.05
  );
  return {
    functionName: fnName, overallScore,
    quality, style, security, tests, docs,
    complexity, errorHandling, duplication, dependencies, compileErrors,
    dnaMismatch: null, temporalDecay: null,
  };
}