import * as vscode from "vscode";
import type { PageResult, DependenciesResult } from "./types";

export interface ExportData {
  file:               string;
  results:            PageResult[];
  dependenciesResult: DependenciesResult | null;
  git:                { remote: string; branch: string } | null;
}

let _data:  ExportData | null          = null;
let _panel: vscode.WebviewPanel | null = null;

export function setExportData(d: ExportData): void          { _data  = d; }
export function getExportData(): ExportData | null           { return _data; }

export function setActivePanel(p: vscode.WebviewPanel | null): void { _panel = p; }
export function getActivePanel(): vscode.WebviewPanel | null  { return _panel; }
