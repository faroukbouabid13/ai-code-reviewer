import * as ts from "typescript";
import { findAffectedFunctions, collectAllFunctions, extractFunctionCode } from "../ast/parser";
import { getCompileErrors as tsGetCompileErrors }                           from "../ast/compileCheck";
import type { LanguageAdapter, ParsedFile }                                 from "./adapter";
import type { FunctionInfo }                                                from "../pipeline/types";

export const typescriptAdapter: LanguageAdapter = {
  languageId:    "typescript",
  languageLabel: "TypeScript",
  fileExtensions:[".ts", ".tsx"],
  testFramework: "Jest",
  docFormat:     "JSDoc",
  defaultStyle:
    "camelCase functions/variables, PascalCase classes, UPPER_SNAKE_CASE constants. " +
    "Prefer const over let, async/await over .then(), arrow functions for callbacks. " +
    "Avoid var, any, eval, console.log in production. Always add explicit return types.",

  parse(filePath, content): ParsedFile {
    return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  },

  collectAllFunctions(parsed): FunctionInfo[] {
    return collectAllFunctions(parsed as ts.SourceFile);
  },

  findAffectedFunctions(parsed, changedLines): FunctionInfo[] {
    return findAffectedFunctions(parsed as ts.SourceFile, changedLines);
  },

  extractFunctionCode(parsed, fnInfo): string | null {
    return extractFunctionCode(parsed as ts.SourceFile, fnInfo.name);
  },

  getCompileErrors(workspace, _filePath) {
    return tsGetCompileErrors(workspace);
  },
};
