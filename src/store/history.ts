import * as fs   from "fs";
import * as path from "path";
import { HISTORY_DIR, HISTORY_FILE, SCORES_FILE } from "../core/config";
import type { VectorRow, ScoreRecord } from "../pipeline/types";

export function ensureHistory(workspace: string): void {
  const dir = path.join(workspace, HISTORY_DIR);
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  [HISTORY_FILE, SCORES_FILE].forEach(f => {
    const fp = path.join(dir, f);
    if (!fs.existsSync(fp)) { fs.writeFileSync(fp, ""); }
  });
}

export function writeAuditLog(workspace: string, record: Omit<VectorRow, "vector">): void {
  fs.appendFileSync(
    path.join(workspace, HISTORY_DIR, HISTORY_FILE),
    JSON.stringify(record) + "\n"
  );
}

export function writeScore(workspace: string, record: ScoreRecord): void {
  fs.appendFileSync(
    path.join(workspace, HISTORY_DIR, SCORES_FILE),
    JSON.stringify(record) + "\n"
  );
}

export function readScores(workspace: string): ScoreRecord[] {
  const file = path.join(workspace, HISTORY_DIR, SCORES_FILE);
  if (!fs.existsSync(file)) { return []; }
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export function clearHistory(workspace: string): void {
  [HISTORY_FILE, SCORES_FILE].forEach(f => {
    const fp = path.join(workspace, HISTORY_DIR, f);
    if (fs.existsSync(fp)) { fs.writeFileSync(fp, ""); }
  });
}

export function loadStyleConfig(workspace: string): any | null {
  const p = path.join(workspace, ".aireviewer-style.json");
  if (!fs.existsSync(p)) { return null; }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

export function readPackageJson(workspace: string): any | null {
  const p = path.join(workspace, "package.json");
  if (!fs.existsSync(p)) { return null; }
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}