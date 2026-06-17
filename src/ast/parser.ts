import * as ts   from "typescript";
import * as fs   from "fs";
import type { FunctionInfo } from "../pipeline/types";

export function parseSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
}

export function extractChangedLines(diff: string): number[] {
  const lines   = diff.split("\n");
  const changed: number[] = [];
  let cur = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line);
      if (m) { cur = parseInt(m[1]); }
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) { changed.push(cur++); continue; }
    if (!line.startsWith("-")) { cur++; }
  }
  return changed;
}

function getNodeNameAndBody(node: ts.Node): { name: string; body: ts.Node } | null {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return { name: node.name.text, body: node.body };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return { name: (node.name as ts.Identifier).text, body: node.initializer };
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
    return { name: node.name.text, body: node.body };
  }
  return null;
}

export function findAffectedFunctions(source: ts.SourceFile, lines: number[]): FunctionInfo[] {
  const lineSet = new Set(lines);
  const found   = new Map<string, FunctionInfo>();

  function visit(node: ts.Node) {
    const info = getNodeNameAndBody(node);
    if (info) {
      const start = source.getLineAndCharacterOfPosition(info.body.getStart()).line + 1;
      const end   = source.getLineAndCharacterOfPosition(info.body.getEnd()).line   + 1;
      for (const l of lineSet) {
        if (l >= start && l <= end) { found.set(info.name, { name: info.name, start, end }); break; }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return Array.from(found.values());
}

export function collectAllFunctions(source: ts.SourceFile): FunctionInfo[] {
  const found: FunctionInfo[] = [];

  function visit(node: ts.Node) {
    const info = getNodeNameAndBody(node);
    if (info) {
      const start = source.getLineAndCharacterOfPosition(info.body.getStart()).line + 1;
      const end   = source.getLineAndCharacterOfPosition(info.body.getEnd()).line   + 1;
      found.push({ name: info.name, start, end });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

export function extractFunctionCode(source: ts.SourceFile, name: string): string | null {
  let result: string | null = null;
  const fullText = source.getFullText();

  function visit(node: ts.Node) {
    if (result) { return; }
    let matched    = false;
    let targetNode: ts.Node = node;

    if (ts.isFunctionDeclaration(node) && node.name?.text === name)              { matched = true; }
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
             node.name.text === name)                                            { matched = true; targetNode = node.parent?.parent ?? node; }
    else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) &&
             node.name.text === name)                                            { matched = true; }

    if (matched) {
      result = fullText.slice(targetNode.getFullStart(), targetNode.getEnd()).trim();
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}