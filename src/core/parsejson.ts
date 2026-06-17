/**
 * Robust JSON parser for LLM responses.
 * Handles: markdown fences, trailing commas, truncated responses,
 * unescaped control chars (newlines/tabs in code snippet fields),
 * and } / ] characters embedded inside string values (e.g. fixedCode fields).
 * Never returns 0 as score — minimum is 1.
 */
export function parseJSON(raw: string): any | null {
  if (!raw) { return null; }

  // Strip DeepSeek thinking tokens.  Two passes:
  //   1. Properly closed:  <think>...</think>  — standard case
  //   2. Unclosed:         <think>...{json}   — reasoning models sometimes omit </think>
  //      In this case the JSON follows the thinking on its own line; we find the
  //      last "\n{" in the string and take everything from there.
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  if (/<think>/i.test(cleaned)) {
    const nl = cleaned.lastIndexOf("\n{");
    if (nl !== -1) {
      cleaned = cleaned.slice(nl + 1).trim();
    } else {
      // No newline before {, strip from <think> to the first {
      const ti = cleaned.indexOf("<think>");
      const ji = cleaned.indexOf("{", ti);
      if (ji !== -1) { cleaned = cleaned.slice(ji); }
    }
  }

  // Find JSON start BEFORE fixJsonControlChars so the control-char escaper
  // starts fresh at { (inStr=false).  Applying it to the whole string risks
  // wrong inStr tracking if there is any text with stray quotes before the JSON.
  const s = cleaned.indexOf("{");

  if (s === -1) {
    const m = raw.match(/score["'\s:]+(\d+(?:\.\d+)?)/i);
    return m
      ? { score: Math.min(10, Math.max(1, Number(m[1]))), issues: [], summary: "Partial parse" }
      : null;
  }

  // Apply control-char escaping only to the JSON portion so inStr starts clean.
  cleaned = cleaned.slice(0, s) + fixJsonControlChars(cleaned.slice(s));

  // Use a brace-balanced scanner instead of lastIndexOf("}").
  // lastIndexOf finds } inside string values (e.g. code in fixedCode fields),
  // causing wrong slices when the response is truncated mid-string.
  const e = findJsonEnd(cleaned, s);

  // If balanced end found → exact slice; otherwise → closeOpenJson on remainder
  const jsonStr = e !== -1 ? cleaned.slice(s, e + 1) : closeOpenJson(cleaned.slice(s));

  // Attempt 1: direct parse
  try { return JSON.parse(jsonStr); } catch {}

  // Attempt 2: strip trailing commas
  try { return JSON.parse(jsonStr.replace(/,\s*([}\]])/g, "$1")); } catch {}

  // Attempt 3: close truncated response + strip trailing commas
  try {
    const closed = closeOpenJson(jsonStr);
    return JSON.parse(closed.replace(/,\s*([}\]])/g, "$1"));
  } catch {
    console.warn("[parseJSON] All attempts failed. Raw snippet:", cleaned.slice(s, Math.min(s + 300, cleaned.length)));
    return null;
  }
}

/**
 * Escapes raw control characters (newline, CR, tab, etc.) that appear inside
 * JSON string literals.  LLMs frequently emit multi-line code snippets in
 * fields like `fixedCode` without escaping them, producing invalid JSON.
 *
 * Walks the string once, tracking inStr state.  Already-escaped sequences
 * (e.g. `\n`) are preserved — the leading `\` causes the next char to be
 * copied verbatim so we never double-escape.
 */
function fixJsonControlChars(str: string): string {
  let out    = "";
  let inStr  = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\\" && inStr) { out += ch + (str[i + 1] ?? ""); i++; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr) {
      const code = ch.charCodeAt(0);
      if      (ch === "\n") { out += "\\n";  continue; }
      else if (ch === "\r") { out += "\\r";  continue; }
      else if (ch === "\t") { out += "\\t";  continue; }
      else if (code < 0x20) { out += `\\u${code.toString(16).padStart(4, "0")}`; continue; }
    }
    out += ch;
  }
  return out;
}

/**
 * Finds the index of the closing } that balances the { at `start`,
 * correctly skipping over } characters inside string literals.
 * Returns -1 if the JSON is truncated (no balanced end found).
 */
function findJsonEnd(str: string, start: number): number {
  let depth = 0, inStr = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\\" && inStr) { i++; continue; } // skip escaped character
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) { continue; }
    if (ch === "{" || ch === "[") { depth++; }
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { return i; }
    }
  }
  return -1; // truncated — caller should use closeOpenJson
}

/**
 * Closes a truncated JSON string by tracking parse state.
 * Handles: truncated string values (including ones with embedded { } chars),
 * dangling key: with no value, and proper nested closing order.
 */
function closeOpenJson(str: string): string {
  const stack: string[]    = []; // expected closers in push order
  let inStr      = false;
  let awaitValue = false;  // true after "key": before value completes
  let lastSafeEnd = 0;     // exclusive index after last complete key-value pair
  let lastSafeStk: string[] = [];

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === "\\" && inStr) { i++; continue; } // skip escaped char

    if (ch === '"') {
      if (!inStr) {
        inStr = true; // opening quote
      } else {
        inStr = false; // closing quote
        if (awaitValue) {
          // completed a string value — record safe point
          awaitValue  = false;
          lastSafeEnd = i + 1;
          lastSafeStk = stack.slice();
        }
        // else this was a key closing quote — safe point deferred until value done
      }
      continue;
    }

    if (inStr) { continue; }

    if (ch === ":") {
      awaitValue = true;
    } else if (ch === ",") {
      awaitValue = false;
    } else if (ch === "{" || ch === "[") {
      awaitValue = false;
      stack.push(ch === "{" ? "}" : "]");
    } else if (ch === "}" || ch === "]") {
      awaitValue = false;
      stack.pop();
      lastSafeEnd = i + 1;
      lastSafeStk = stack.slice();
    } else if (/[\d\-]/.test(ch)) {
      // number literal — advance to end
      while (i + 1 < str.length && /[\d.eE+\-]/.test(str[i + 1])) { i++; }
      if (awaitValue) { awaitValue = false; lastSafeEnd = i + 1; lastSafeStk = stack.slice(); }
    } else if (str.startsWith("true", i) || str.startsWith("null", i)) {
      i += 3; // loop i++ makes it +4 total (length of true/null)
      if (awaitValue) { awaitValue = false; lastSafeEnd = i + 1; lastSafeStk = stack.slice(); }
    } else if (str.startsWith("false", i)) {
      i += 4; // loop i++ makes it +5 total (length of false)
      if (awaitValue) { awaitValue = false; lastSafeEnd = i + 1; lastSafeStk = stack.slice(); }
    }
  }

  if (inStr || awaitValue) {
    // Truncated inside a string value or waiting for value — roll back to last safe point
    const s = str.slice(0, lastSafeEnd).trimEnd().replace(/,$/, "");
    return s + lastSafeStk.slice().reverse().join("");
  }

  // Ended cleanly but stack isn't empty — close remaining structures
  const s = str.trimEnd().replace(/,$/, "");
  return s + stack.slice().reverse().join("");
}