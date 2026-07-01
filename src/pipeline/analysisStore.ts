import * as vscode from "vscode";
import type { PageResult, DependenciesResult } from "./types";

export interface ExportData {
  file:               string;
  results:            PageResult[];
  dependenciesResult: DependenciesResult | null;
  git:                { remote: string; branch: string } | null;
}

export interface ReviewContext {
  prNumber:  number;
  owner:     string;
  repo:      string;
  headSha:   string;
  filePath:  string;  // repo-relative path for inline comments
}

let _data:          ExportData | null    = null;
let _panel:         vscode.WebviewPanel | null = null;
let _reviewContext: ReviewContext | null = null;

export function setExportData(d: ExportData): void          { _data  = d; }
export function getExportData(): ExportData | null           { return _data; }

export function setActivePanel(p: vscode.WebviewPanel | null): void { _panel = p; }
export function getActivePanel(): vscode.WebviewPanel | null  { return _panel; }

export function setReviewContext(ctx: ReviewContext | null): void { _reviewContext = ctx; }
export function getReviewContext(): ReviewContext | null           { return _reviewContext; }
