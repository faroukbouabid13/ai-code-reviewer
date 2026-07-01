import * as vscode from "vscode";
import * as fs     from "fs";
import * as path   from "path";
import { getToken }        from "./githubAuth";
import { getSelectedRepo } from "./repoSelector";
import { runCmd }          from "./gitContext";
import type { PRContext }  from "../pipeline/types";

export async function loadPRContext(workspace: string): Promise<PRContext | null> {
  const token = getToken();

  if (token) {
    const selected = getSelectedRepo();
    let owner: string, repo: string;

    if (selected) {
      owner = selected.owner;
      repo  = selected.repo;
    } else {
      const remote = await runCmd("git remote get-url origin", workspace);
      const match  = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
      if (!match) { return null; }
      [, owner, repo] = match;
    }

    try {
      const headers = {
        Authorization: `token ${token}`,
        Accept:        "application/vnd.github.v3+json",
      };

      const prRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open`,
        { headers }
      );
      if (!prRes.ok) { throw new Error(`GitHub ${prRes.status}`); }

      const prs = await prRes.json() as any[];
      if (!prs.length) { return null; }

      const pr = prs[0];
      const commentsRes = await fetch(pr.comments_url, { headers });
      const comments    = commentsRes.ok ? await commentsRes.json() as any[] : [];

      return {
        number:     pr.number,
        title:      pr.title,
        body:       pr.body ?? "",
        state:      pr.state,
        author:     pr.user.login,
        branch:     pr.head.ref,
        baseBranch: pr.base.ref,
        createdAt:  pr.created_at,
        comments:   comments.map((c: any) => ({
          author:    c.user.login,
          body:      c.body,
          createdAt: c.created_at,
        })),
        source: "github",
      };
    } catch (e: any) {
      vscode.window.showWarningMessage(`AI Reviewer: GitHub — ${e.message}`);
    }
  }

  // Fallback to mock-pr.json
  const mockPath = path.join(workspace, "mock-pr.json");
  if (fs.existsSync(mockPath)) {
    try {
      return { ...JSON.parse(fs.readFileSync(mockPath, "utf8")), source: "simulated" } as PRContext;
    } catch { return null; }
  }

  return null;
}
