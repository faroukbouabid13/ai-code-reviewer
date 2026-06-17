import type { FunctionInfo, CompileError } from "../pipeline/types";

// Opaque parsed representation — each adapter manages its own internal type
export type ParsedFile = any;

export interface LanguageAdapter {
  languageId:    string;    // VS Code languageId: "typescript", "python", etc.
  languageLabel: string;    // shown in prompts:   "TypeScript", "Python 3", etc.
  fileExtensions:string[];  // [".ts", ".tsx"]
  testFramework: string;    // "Jest", "pytest", "JUnit", "testing"
  docFormat:     string;    // "JSDoc", "Google-style docstring", "Javadoc", "GoDoc"
  defaultStyle:  string;    // language idioms injected into the style agent user prompt

  // Parse the file content into an opaque structure reused by the three
  // extraction methods below — avoids reading the file multiple times.
  parse(filePath: string, content: string): ParsedFile;

  collectAllFunctions(parsed: ParsedFile): FunctionInfo[];
  findAffectedFunctions(parsed: ParsedFile, changedLines: number[]): FunctionInfo[];
  extractFunctionCode(parsed: ParsedFile, fnInfo: FunctionInfo): string | null;

  getCompileErrors(workspace: string, filePath: string): Promise<CompileError[]>;
}
