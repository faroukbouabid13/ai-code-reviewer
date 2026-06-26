import * as vscode from "vscode";

export interface GitHubUser  { login: string; }
export interface GitHubSession { token: string; user: GitHubUser; }

let _session: GitHubSession | null = null;

export async function signIn(): Promise<GitHubSession | null> {
  try {
    const vs = await vscode.authentication.getSession(
      "github", ["read:user"], { createIfNone: true }
    );
    _session = { token: vs.accessToken, user: { login: vs.account.label } };
    return _session;
  } catch {
    return null;
  }
}

export async function getRepoToken(): Promise<string | null> {
  try {
    const vs = await vscode.authentication.getSession(
      "github", ["repo", "read:user"], { createIfNone: true }
    );
    return vs.accessToken;
  } catch {
    return null;
  }
}

export async function tryRestoreSession(): Promise<GitHubSession | null> {
  try {
    const vs = await vscode.authentication.getSession(
      "github", ["read:user"], { silent: true }
    );
    if (!vs) { return null; }
    _session = { token: vs.accessToken, user: { login: vs.account.label } };
    return _session;
  } catch {
    return null;
  }
}

export function signOut(): void { _session = null; }
export function getSession(): GitHubSession | null { return _session; }
export function getToken(): string { return _session?.token ?? ""; }
