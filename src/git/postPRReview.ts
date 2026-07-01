import type { PRInfo } from "./postPRComment";

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface GitHubReview {
  event:    "APPROVE" | "COMMENT" | "REQUEST_CHANGES";
  body:     string;
  comments: InlineComment[];
}

export async function postPRReview(
  token:  string,
  pr:     PRInfo,
  review: GitHubReview,
): Promise<boolean> {
  const base = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`;
  const headers = {
    "Authorization":  `token ${token}`,
    "Accept":         "application/vnd.github.v3+json",
    "Content-Type":   "application/json",
  };

  // Try with inline comments first (requires headSha)
  if (pr.headSha && review.comments.length > 0) {
    try {
      const res = await fetch(base, {
        method:  "POST",
        headers,
        body: JSON.stringify({
          commit_id: pr.headSha,
          body:      review.body,
          event:     review.event,
          comments:  review.comments,
        }),
      });
      if (res.ok) { return true; }
    } catch { /* fall through to summary-only */ }
  }

  // Fallback: summary comment only, always use COMMENT event.
  // GitHub rejects APPROVE / REQUEST_CHANGES on your own PR (422).
  try {
    const res = await fetch(base, {
      method:  "POST",
      headers,
      body: JSON.stringify({
        commit_id: pr.headSha,
        body:      review.body,
        event:     "COMMENT",
      }),
    });
    if (res.ok) { return true; }
    // Last resort: plain issue comment (no commit_id required)
    const commentRes = await fetch(
      `https://api.github.com/repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
      { method: "POST", headers, body: JSON.stringify({ body: review.body }) }
    );
    return commentRes.ok;
  } catch {
    return false;
  }
}

export async function setCommitStatus(
  token:       string,
  owner:       string,
  repo:        string,
  sha:         string,
  state:       "success" | "failure" | "pending" | "error",
  description: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`,
      {
        method:  "POST",
        headers: {
          "Authorization": `token ${token}`,
          "Accept":        "application/vnd.github.v3+json",
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          state,
          description,
          context: "AI Code Reviewer / quality-gate",
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
