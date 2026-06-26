import type { PageResult, DependenciesResult } from "./types";

export interface ExportData {
  file:               string;
  results:            PageResult[];
  dependenciesResult: DependenciesResult | null;
  git:                { remote: string; branch: string } | null;
}

let _data: ExportData | null = null;

export function setExportData(d: ExportData): void { _data = d; }
export function getExportData(): ExportData | null  { return _data; }
