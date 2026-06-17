    import * as crypto from "crypto";
import { CACHE_TTL_MS } from "./config";
import type { AnalysisResult } from "../pipeline/types";

interface CacheEntry {
  result:    AnalysisResult;
  timestamp: number;
}

const store = new Map<string, CacheEntry>();

export function getCacheKey(code: string): string {
  return crypto.createHash("md5").update(code).digest("hex");
}

export function getCached(code: string): AnalysisResult | null {
  const key   = getCacheKey(code);
  const entry = store.get(key);
  if (!entry) { return null; }
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.result;
}

export function setCache(code: string, result: AnalysisResult): void {
  store.set(getCacheKey(code), { result, timestamp: Date.now() });
}

export function clearCache(): void {
  store.clear();
}