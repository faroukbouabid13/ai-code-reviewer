import { exec } from "child_process";

function runStrict(cmd: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    exec(cmd, { cwd }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout.trim())
    )
  );
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  return runStrict("git branch --show-current", cwd);
}

export async function getRecentCommits(cwd: string, count = 5): Promise<string[]> {
  try {
    const out = await runStrict(`git log --oneline -${count}`, cwd);
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function gitCheckoutNewBranch(cwd: string, branch: string): Promise<{ success: boolean; error?: string }> {
  try {
    await runStrict(`git checkout -b ${branch}`, cwd);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: (e as any).message };
  }
}

export async function gitHasUncommittedChanges(cwd: string): Promise<boolean> {
  try {
    const out = await runStrict("git status --porcelain", cwd);
    return out.length > 0;
  } catch {
    return false;
  }
}

export async function gitCommitAll(cwd: string, message: string): Promise<{ success: boolean; error?: string }> {
  try {
    await runStrict("git add -A", cwd);
    await runStrict(`git commit --no-verify -m "${message.replace(/"/g, "'")}"`, cwd);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: (e as any).message };
  }
}

export async function gitCountAhead(cwd: string, base: string): Promise<number> {
  try {
    const out = await runStrict(`git rev-list --count origin/${base}..HEAD`, cwd);
    return parseInt(out, 10) || 0;
  } catch {
    try {
      const out2 = await runStrict(`git rev-list --count ${base}..HEAD`, cwd);
      return parseInt(out2, 10) || 0;
    } catch {
      return 0;
    }
  }
}

export async function gitPush(
  cwd:    string,
  branch: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await runStrict(`git push origin ${branch}`, cwd);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function findExistingPR(
  token:  string,
  owner:  string,
  repo:   string,
  branch: string,
): Promise<{ number: number; url: string; headSha: string } | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return null; }
    const prs = await res.json() as any[];
    if (!prs.length) { return null; }
    return { number: prs[0].number, url: prs[0].html_url, headSha: prs[0].head.sha };
  } catch {
    return null;
  }
}

export async function createGitHubPR(
  token:  string,
  owner:  string,
  repo:   string,
  title:  string,
  body:   string,
  head:   string,
  base:   string,
): Promise<{ number: number; url: string; headSha: string } | { error: string } | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method:  "POST",
        headers: {
          Authorization:  `token ${token}`,
          Accept:         "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, head, base }),
      }
    );
    if (!res.ok) {
      const err = await res.json() as any;
      if (err.errors?.[0]?.message?.includes("already exists")) {
        return findExistingPR(token, owner, repo, head);
      }
      const detail = err.errors?.[0]?.message ?? err.message ?? `HTTP ${res.status}`;
      console.error(`[AI Reviewer] createGitHubPR failed: ${res.status} — ${JSON.stringify(err)}`);
      return { error: `${res.status}: ${detail}` };
    }
    const data = await res.json() as any;
    return { number: data.number, url: data.html_url, headSha: data.head.sha };
  } catch (e: any) {
    console.error(`[AI Reviewer] createGitHubPR exception:`, e);
    return null;
  }
}

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo:  string,
): Promise<string> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return "main"; }
    const data = await res.json() as any;
    return data.default_branch ?? "main";
  } catch {
    return "main";
  }
}
