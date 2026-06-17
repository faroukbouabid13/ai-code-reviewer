import { exec }           from "child_process";
import type { LanguageAdapter, ParsedFile } from "./adapter";
import type { FunctionInfo, CompileError }  from "../pipeline/types";

interface JavaParsed { content: string; lines: string[]; functions: FunctionInfo[]; }

// Matches: [modifiers] returnType methodName( — handles generics and annotations
const METHOD_RE =
  /^(\s*)(?:(?:public|private|protected|static|final|synchronized|abstract|native|default)\s+)*[\w<>\[\],\s]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/;

function parseJavaFunctions(lines: string[]): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = METHOD_RE.exec(lines[i]);
    if (!m) { continue; }
    const name = m[2];
    if (["if", "for", "while", "switch", "catch", "else"].includes(name)) { continue; }

    // Count braces to find closing }
    let depth = 0;
    let end   = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") { depth++; }
        if (ch === "}") { depth--; }
      }
      if (depth === 0) { end = j + 1; break; }
    }
    results.push({ name, start: i + 1, end });
  }
  return results;
}

export const javaAdapter: LanguageAdapter = {
  languageId:    "java",
  languageLabel: "Java",
  fileExtensions:[".java"],
  testFramework: "JUnit 5",
  docFormat:     "Javadoc",
  defaultStyle:
    "camelCase methods/variables/fields, PascalCase classes, UPPER_SNAKE_CASE constants. " +
    "Explicit access modifiers on every member. Check exceptions where recoverable. " +
    "Avoid raw types and unchecked casts. Use Optional instead of null returns. " +
    "Prefer streams over manual loops for collection processing.",

  parse(_filePath, content): ParsedFile {
    const lines     = content.split("\n");
    const functions = parseJavaFunctions(lines);
    return { content, lines, functions } as JavaParsed;
  },

  collectAllFunctions(parsed): FunctionInfo[] {
    return (parsed as JavaParsed).functions;
  },

  findAffectedFunctions(parsed, changedLines): FunctionInfo[] {
    return (parsed as JavaParsed).functions.filter(
      f => changedLines.some(l => l >= f.start && l <= f.end),
    );
  },

  extractFunctionCode(parsed, fnInfo): string | null {
    const { lines } = parsed as JavaParsed;
    const slice = lines.slice(fnInfo.start - 1, fnInfo.end);
    return slice.length ? slice.join("\n").trim() : null;
  },

  getCompileErrors(_workspace, filePath): Promise<CompileError[]> {
    return new Promise(resolve => {
      exec(`javac "${filePath}" 2>&1`, (_err, stdout) => {
        const errors: CompileError[] = [];
        for (const line of (stdout || "").split("\n")) {
          const m = line.match(/:(\d+):\s+error:\s+(.+)/);
          if (m) { errors.push({ line: parseInt(m[1]), message: m[2].trim() }); }
        }
        resolve(errors);
      });
    });
  },
};
