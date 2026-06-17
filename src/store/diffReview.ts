import * as fs   from "fs";
import * as path from "path";
import { HISTORY_DIR, DIFF_REVIEW_FILE } from "../core/config";
import type { DiffReview } from "../pipeline/types";

interface IssueSig { signature: string; label: string; }

export interface AnalysisSnapshot {
  overallScore: number;
  timestamp:    string;
  issues:       Record<string, IssueSig[]>;
}

const CATEGORIES = ["security", "quality", "errorHandling", "complexity", "style", "duplication"];

function filePath(workspace: string): string {
  return path.join(workspace, HISTORY_DIR, DIFF_REVIEW_FILE);
}

function loadAll(workspace: string): Record<string, AnalysisSnapshot> {
  const fp = filePath(workspace);
  if (!fs.existsSync(fp)) { return {}; }
  try { return JSON.parse(fs.readFileSync(fp, "utf8")); } catch { return {}; }
}

function key(file: string, functionName: string): string {
  return `${file}::${functionName}`;
}

export function loadLastAnalysis(workspace: string, file: string, functionName: string): AnalysisSnapshot | null {
  return loadAll(workspace)[key(file, functionName)] ?? null;
}

export function saveLastAnalysis(workspace: string, file: string, functionName: string, snapshot: AnalysisSnapshot): void {
  const all = loadAll(workspace);
  all[key(file, functionName)] = snapshot;
  fs.writeFileSync(filePath(workspace), JSON.stringify(all));
}

function sig(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
}

export function buildIssueSignatures(a: {
  security?:      { vulnerabilities?: any[] } | null;
  quality?:       { issues?: any[] }           | null;
  errorHandling?: { issues?: any[] }           | null;
  complexity?:    { issues?: any[] }           | null;
  style?:         { violations?: any[] }       | null;
  duplication?:   { issues?: any[] }           | null;
}): Record<string, IssueSig[]> {
  const map = (items: any[], labelFn: (i: any) => string) =>
    items
      .map(i => ({ signature: sig(labelFn(i)), label: labelFn(i) }))
      .filter(x => x.signature);

  return {
    security:      map(a.security?.vulnerabilities ?? [], i => i.type || i.description || ""),
    quality:       map(a.quality?.issues           ?? [], i => i.description || ""),
    errorHandling: map(a.errorHandling?.issues      ?? [], i => i.type || i.description || ""),
    complexity:    map(a.complexity?.issues         ?? [], i => i.description || ""),
    style:         map(a.style?.violations          ?? [], i => i.rule || i.description || ""),
    duplication:   map(a.duplication?.issues        ?? [], i => i.description || ""),
  };
}

export function computeDiffReview(
  prev:    AnalysisSnapshot,
  current: { overallScore: number; issues: Record<string, IssueSig[]> },
): DiffReview {
  const byCategory: DiffReview["byCategory"] = {};
  let totalAdded = 0, totalResolved = 0, totalUnchanged = 0;

  for (const cat of CATEGORIES) {
    const oldItems = prev.issues[cat] ?? [];
    const newItems = current.issues[cat] ?? [];
    const oldSigs  = new Set(oldItems.map(i => i.signature));
    const newSigs  = new Set(newItems.map(i => i.signature));

    const added     = newItems.filter(i => !oldSigs.has(i.signature)).map(i => i.label);
    const resolved  = oldItems.filter(i => !newSigs.has(i.signature)).map(i => i.label);
    const unchanged = newItems.filter(i => oldSigs.has(i.signature)).length;

    byCategory[cat] = { added, resolved, unchanged };
    totalAdded     += added.length;
    totalResolved  += resolved.length;
    totalUnchanged += unchanged;
  }

  return {
    hasPrevious:    true,
    previousScore:  prev.overallScore,
    currentScore:   current.overallScore,
    scoreDelta:     current.overallScore - prev.overallScore,
    totalAdded, totalResolved, totalUnchanged,
    byCategory,
  };
}
