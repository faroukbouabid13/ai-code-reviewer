import { typescriptAdapter } from "./typescript";
import type { LanguageAdapter } from "./adapter";

// JavaScript uses the same TypeScript compiler AST parser — it handles .js natively.
// Only the metadata fields differ (no types, no tsc, Mocha/Jest both valid).
export const javascriptAdapter: LanguageAdapter = {
  ...typescriptAdapter,
  languageId:    "javascript",
  languageLabel: "JavaScript",
  fileExtensions:[".js", ".jsx"],
  docFormat:     "JSDoc",
  defaultStyle:
    "camelCase functions/variables, PascalCase classes. " +
    "Prefer const over let, async/await over .then(), arrow functions for callbacks. " +
    "Avoid var, eval, console.log in production. Use === not ==.",

  // JS has no tsc — return empty compile errors
  getCompileErrors(_workspace, _filePath) {
    return Promise.resolve([]);
  },
};
