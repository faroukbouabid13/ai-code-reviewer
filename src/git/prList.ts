export interface OpenPR {
  number:          number;
  title:           string;
  author:          string;
  branch:          string;
  baseBranch:      string;
  headSha:         string;
  url:             string;
  reviewRequested: boolean;
  createdAt:       string;
}

export interface PRFile {
  filename: string;
  language: string;
}

export async function fetchOpenPRs(
  token:        string,
  owner:        string,
  repo:         string,
  currentLogin: string,
): Promise<OpenPR[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=20`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return []; }
    const prs = await res.json() as any[];
    return prs.map(pr => ({
      number:          pr.number,
      title:           pr.title,
      author:          pr.user.login,
      branch:          pr.head.ref,
      baseBranch:      pr.base.ref,
      headSha:         pr.head.sha,
      url:             pr.html_url,
      reviewRequested: (pr.requested_reviewers ?? []).some((r: any) => r.login === currentLogin),
      createdAt:       pr.created_at,
    }));
  } catch {
    return [];
  }
}

export async function fetchPRFiles(
  token:    string,
  owner:    string,
  repo:     string,
  prNumber: number,
): Promise<PRFile[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return []; }
    const files = await res.json() as any[];
    return files
      .filter(f => f.status !== "removed")
      .map(f => ({ filename: f.filename, language: detectLanguage(f.filename) }))
      .filter(f => f.language !== "");
  } catch {
    return [];
  }
}

export async function fetchFileContent(
  token: string,
  owner: string,
  repo:  string,
  path:  string,
  ref:   string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) { return null; }
    const data = await res.json() as any;
    if (data.encoding === "base64") {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts:   "typescript",
    tsx:  "typescriptreact",
    js:   "javascript",
    jsx:  "javascriptreact",
    py:   "python",
    java: "java",
    go:   "go",
  };
  return map[ext] ?? "";
}
