export interface PRInfo {
  owner:  string;
  repo:   string;
  number: number;
}

export function parseGitHubRemote(remote: string): { owner: string; repo: string } | null {
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) { return null; }
  return { owner: match[1], repo: match[2] };
}

export async function detectOpenPR(token: string, remote: string, branch: string): Promise<PRInfo | null> {
  const parsed = parseGitHubRemote(remote);
  if (!parsed) { return null; }
  const { owner, repo } = parsed;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      { headers: { "Authorization": `token ${token}`, "Accept": "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return null; }
    const prs = await res.json() as any[];
    if (!prs.length) { return null; }
    return { owner, repo, number: prs[0].number };
  } catch {
    return null;
  }
}

export async function postPRComment(token: string, pr: PRInfo, body: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
      {
        method:  "POST",
        headers: {
          "Authorization":  `token ${token}`,
          "Accept":         "application/vnd.github.v3+json",
          "Content-Type":   "application/json",
        },
        body: JSON.stringify({ body }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
