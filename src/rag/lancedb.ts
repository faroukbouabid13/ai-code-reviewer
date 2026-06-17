import * as path from "path";
import { HISTORY_DIR, LANCEDB_DIR, TABLE_NAME, VECTOR_DIM } from "../core/config";
import type { VectorRow, HistoryMatch } from "../pipeline/types";

function getLanceDBPath(workspace: string): string {
  return path.join(workspace, HISTORY_DIR, LANCEDB_DIR);
}

async function openTable(workspace: string): Promise<any> {
  const lancedb = await import("vectordb") as any;
  const db      = await lancedb.connect(getLanceDBPath(workspace));
  const names: string[] = await db.tableNames();

  if (names.includes(TABLE_NAME)) { return db.openTable(TABLE_NAME); }

  return db.createTable(TABLE_NAME, [{
    id:           "__seed__",
    functionName: "__seed__",
    timestamp:    new Date().toISOString(),
    code:         "",
    file:         "",
    commit:       "",
    author:       "",
    vector:       new Array(VECTOR_DIM).fill(0),
  }]);
}

export async function insertVector(workspace: string, row: VectorRow): Promise<void> {
  try {
    await (await openTable(workspace)).add([row]);
  } catch { /* ignore — non-critical */ }
}

export async function vectorSearch(
  workspace:  string,
  queryVector: number[],
  currentId:  string,
  limit       = 3
): Promise<HistoryMatch[]> {
  try {
    const results = await (await openTable(workspace))
      .search(queryVector)
      .limit(limit + 5)
      .execute();

    return (results as any[])
      .filter((r: any) => r.id !== "__seed__" && r.id !== currentId)
      .slice(0, limit)
      .map((r: any) => ({
        functionName: r.functionName,
        file:         r.file,
        similarity:   1 / (1 + (r._distance ?? 1)),
        code:         r.code,
      }));
  } catch {
    return [];
  }
}

export async function getVectorCount(workspace: string): Promise<number> {
  try {
    const all = await (await openTable(workspace))
      .search(new Array(VECTOR_DIM).fill(0))
      .limit(9999)
      .execute();
    return (all as any[]).filter((r: any) => r.id !== "__seed__").length;
  } catch {
    return 0;
  }
}

export async function getAuthorVectors(
  workspace: string,
  author:    string,
  limit      = 30,
): Promise<Array<{ vector: number[]; functionName: string; code: string }>> {
  try {
    const all = await (await openTable(workspace))
      .search(new Array(VECTOR_DIM).fill(0))
      .limit(9999)
      .execute();

    return (all as any[])
      .filter((r: any) => r.author === author && r.id !== "__seed__" && r.vector?.length > 0)
      .slice(0, limit)
      .map((r: any) => ({ vector: Array.from(r.vector) as number[], functionName: r.functionName, code: r.code ?? "" }));
  } catch {
    return [];
  }
}

export async function clearVectorStore(workspace: string): Promise<void> {
  const fs   = await import("fs");
  const dbPath = getLanceDBPath(workspace);
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }
}