import * as vscode from "vscode";

export interface GitHubUser    { login: string; }
export interface GitHubSession { token: string; user: GitHubUser; }

let _session: GitHubSession | null = null;
const _listeners: Array<(s: GitHubSession | null) => void> = [];

function notify(s: GitHubSession | null) {
  _listeners.forEach(cb => cb(s));
}

export function onAuthChange(cb: (s: GitHubSession | null) => void): void {
  _listeners.push(cb);
}

export async function signIn(): Promise<GitHubSession | null> {
  try {
    const vs = await vscode.authentication.getSession(
      "github", ["read:user", "repo"], { forceNewSession: true }
    );
    _session = { token: vs.accessToken, user: { login: vs.account.label } };
    notify(_session);
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
      "github", ["read:user", "repo"], { silent: true }
    );
    if (!vs) { return null; }
    _session = { token: vs.accessToken, user: { login: vs.account.label } };
    return _session;
  } catch {
    return null;
  }
}

export function signOut(): void {
  _session = null;
  notify(null);
}

export function getSession(): GitHubSession | null { return _session; }
export function getToken(): string { return _session?.token ?? ""; }
