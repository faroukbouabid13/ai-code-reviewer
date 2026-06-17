import { typescriptAdapter } from "./typescript";
import { javascriptAdapter } from "./javascript";
import { pythonAdapter }     from "./python";
import { javaAdapter }       from "./java";
import { goAdapter }         from "./go";
import type { LanguageAdapter } from "./adapter";

const ADAPTERS: LanguageAdapter[] = [
  typescriptAdapter,
  { ...typescriptAdapter, languageId: "typescriptreact", fileExtensions: [".tsx"] },
  { ...javascriptAdapter, languageId: "javascriptreact", fileExtensions: [".jsx"] },
  javascriptAdapter,
  pythonAdapter,
  javaAdapter,
  goAdapter,
];

const REGISTRY = new Map<string, LanguageAdapter>(
  ADAPTERS.map(a => [a.languageId, a])
);

export function getAdapter(languageId: string): LanguageAdapter {
  return REGISTRY.get(languageId) ?? typescriptAdapter;
}

export function getSupportedLanguageIds(): string[] {
  return [...REGISTRY.keys()];
}
