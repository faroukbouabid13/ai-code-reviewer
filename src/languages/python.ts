import { exec }           from "child_process";
import type { LanguageAdapter, ParsedFile } from "./adapter";
import type { FunctionInfo, CompileError }  from "../pipeline/types";

// ParsedFile for Python = { lines: string[]; functions: FunctionInfo[] }
interface PythonParsed {
  content:   string;
  lines:     string[];
  functions: FunctionInfo[];
}

const DEF_RE = /^(\s*)(async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

function parsePythonFunctions(lines: string[]): FunctionInfo[] {
  const results: FunctionInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = DEF_RE.exec(lines[i]);
    if (!m) { continue; }

    const baseIndent = m[1].length;
    const name       = m[3];
    const start      = i + 1; // 1-indexed

    // Walk forward until we hit a non-blank line with indent ≤ baseIndent
    let end = i + 1;
    while (end < lines.length) {
      const line        = lines[end];
      const trimmed     = line.trimStart();
      if (trimmed === "" || trimmed.startsWith("#")) { end++; continue; }
      const lineIndent  = line.length - trimmed.length;
      if (lineIndent <= baseIndent) { break; }
      end++;
    }
    results.push({ name, start, end });
  }
  return results;
}

export const pythonAdapter: LanguageAdapter = {
  languageId:    "python",
  languageLabel: "Python 3",
  fileExtensions:[".py"],
  testFramework: "pytest",
  docFormat:     "Google-style docstring",
  defaultStyle:
    "snake_case functions/variables/modules, PascalCase classes, UPPER_SNAKE_CASE constants. " +
    "Use type hints on function signatures. Prefer f-strings over .format() or %. " +
    "Use context managers (with) for file/resource handling. " +
    "Prefer list/dict comprehensions over manual loops. Never use bare except.",

  parse(_filePath, content): ParsedFile {
    const lines     = content.split("\n");
    const functions = parsePythonFunctions(lines);
    return { content, lines, functions } as PythonParsed;
  },

  collectAllFunctions(parsed): FunctionInfo[] {
    return (parsed as PythonParsed).functions;
  },

  findAffectedFunctions(parsed, changedLines): FunctionInfo[] {
    const lineSet = new Set(changedLines);
    return (parsed as PythonParsed).functions.filter(
      f => changedLines.some(l => l >= f.start && l <= f.end) || lineSet.has(f.start),
    );
  },

  extractFunctionCode(parsed, fnInfo): string | null {
    const { lines } = parsed as PythonParsed;
    const slice = lines.slice(fnInfo.start - 1, fnInfo.end);
    return slice.length ? slice.join("\n").trim() : null;
  },

  getCompileErrors(_workspace, filePath): Promise<CompileError[]> {
    return new Promise(resolve => {
      exec(
        `python -c "import ast, sys; ast.parse(open(sys.argv[1]).read())" "${filePath}"`,
        (_err, _stdout, stderr) => {
          const errors: CompileError[] = [];
          // stderr format: "  File ..., line N\n    ...\nSyntaxError: ..."
          const m = stderr.match(/line (\d+).*\n.*\n(.+Error:.+)/s);
          if (m) { errors.push({ line: parseInt(m[1]), message: m[2].trim() }); }
          resolve(errors);
        },
      );
    });
  },
};
