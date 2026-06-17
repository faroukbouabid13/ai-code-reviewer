import { exec }           from "child_process";
import type { LanguageAdapter, ParsedFile } from "./adapter";
import type { FunctionInfo, CompileError }  from "../pipeline/types";

interface GoParsed { content: string; lines: string[]; functions: FunctionInfo[]; }

// Matches: func functionName( or func (recv Type) methodName(
const FUNC_RE = /^func\s+(?:\([^)]+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

function parseGoFunctions(lines: string[]): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = FUNC_RE.exec(lines[i]);
    if (!m) { continue; }
    const name = m[1];

    let depth = 0;
    let end   = i;
    let found = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; found = true; }
        if (ch === "}") { depth--; }
      }
      if (found && depth === 0) { end = j + 1; break; }
    }
    results.push({ name, start: i + 1, end });
  }
  return results;
}

export const goAdapter: LanguageAdapter = {
  languageId:    "go",
  languageLabel: "Go",
  fileExtensions:[".go"],
  testFramework: "testing (stdlib)",
  docFormat:     "GoDoc comment",
  defaultStyle:
    "camelCase exported identifiers, lowercase unexported. " +
    "Always handle errors explicitly — never ignore the error return value. " +
    "Use defer for cleanup (file closes, mutex unlocks). " +
    "Prefer short variable names in short scopes. " +
    "Group imports: stdlib first, then third-party, then internal.",

  parse(_filePath, content): ParsedFile {
    const lines     = content.split("\n");
    const functions = parseGoFunctions(lines);
    return { content, lines, functions } as GoParsed;
  },

  collectAllFunctions(parsed): FunctionInfo[] {
    return (parsed as GoParsed).functions;
  },

  findAffectedFunctions(parsed, changedLines): FunctionInfo[] {
    return (parsed as GoParsed).functions.filter(
      f => changedLines.some(l => l >= f.start && l <= f.end),
    );
  },

  extractFunctionCode(parsed, fnInfo): string | null {
    const { lines } = parsed as GoParsed;
    const slice = lines.slice(fnInfo.start - 1, fnInfo.end);
    return slice.length ? slice.join("\n").trim() : null;
  },

  getCompileErrors(_workspace, filePath): Promise<CompileError[]> {
    return new Promise(resolve => {
      const dir = filePath.replace(/[^/\\]+$/, "");
      exec(`go vet "${filePath}" 2>&1`, { cwd: dir }, (_err, stdout) => {
        const errors: CompileError[] = [];
        for (const line of (stdout || "").split("\n")) {
          const m = line.match(/:(\d+):\d+:\s+(.+)/);
          if (m) { errors.push({ line: parseInt(m[1]), message: m[2].trim() }); }
        }
        resolve(errors);
      });
    });
  },
};
