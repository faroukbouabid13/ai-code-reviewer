import { exec } from "child_process";
import * as fs   from "fs";
import * as path from "path";
import { EMPTY_TREE } from "../core/config";
import type { GitContext } from "../pipeline/types";

export function runCmd(cmd: string, cwd: string): Promise<string> {
  return new Promise(resolve =>
    exec(cmd, { cwd }, (err, stdout) => resolve(err ? "" : stdout.trim()))
  );
}

export async function getGitContext(workspace: string, relative: string): Promise<GitContext> {
  const branch        = await runCmd("git rev-parse --abbrev-ref HEAD", workspace);
  const remote        = await runCmd("git remote get-url origin", workspace);
  const currentCommit = await runCmd("git rev-parse --short HEAD", workspace);

  let remoteType: GitContext["remoteType"] = "None";
  if (remote.includes("github.com"))  { remoteType = "GitHub"; }
  else if (remote.includes("gitlab")) { remoteType = "GitLab"; }
  else if (remote)                    { remoteType = "Other";  }

  const logRaw = await runCmd(
    `git log --format="%h|%ad|%an|%s" --date=short -10 -- "${relative}"`,
    workspace
  );
  const recentCommits = logRaw.split("\n").filter(Boolean).map(line => {
    const [hash, date, author, ...msg] = line.split("|");
    return { hash, date, author, message: msg.join("|") };
  });

  let diff = "";
  try {
    diff = await runCmd(`git diff HEAD -- "${relative}"`, workspace);
    if (!diff) { diff = await runCmd(`git diff ${EMPTY_TREE} HEAD -- "${relative}"`, workspace); }
  } catch { diff = ""; }

  if (!diff) {
    try {
      const content = fs.readFileSync(path.join(workspace, relative), "utf8");
      diff = `@@ -0,0 +1,${content.split("\n").length} @@\n` +
             content.split("\n").map((l: string) => "+" + l).join("\n");
    } catch { diff = ""; }
  }

  return { branch, remote, remoteType, recentCommits, diff, currentCommit };
}

export async function getFunctionLastModified(
  filePath:  string,
  lineStart: number,
  lineEnd:   number,
): Promise<string | null> {
  try {
    const fileDir = path.dirname(filePath);
    const gitRoot = await runCmd("git rev-parse --show-toplevel", fileDir);
    if (!gitRoot) { return null; }

    const relative = path.relative(gitRoot, filePath).replace(/\\/g, "/");
    const output   = await runCmd(
      `git blame -p -L ${lineStart},${lineEnd} -- "${relative}"`,
      gitRoot,
    );
    if (!output) { return null; }

    const times: number[] = [];
    let skipCurrent = false;
    for (const line of output.split("\n")) {
      // Hunk header: <40-char-hash> <orig> <final> [count]
      if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
        skipCurrent = line.startsWith("000000000000000000");
      }
      if (!skipCurrent) {
        const m = line.match(/^author-time (\d+)$/);
        if (m) { times.push(parseInt(m[1], 10)); }
      }
    }

    if (!times.length) { return null; }
    return new Date(Math.max(...times) * 1000).toISOString();
  } catch {
    return null;
  }
}

export async function getBlameAuthor(
  _workspace: string,
  filePath:   string,
  line:       number,
): Promise<string | null> {
  try {
    // Find the git root from the file's own directory — works even when
    // the file is in a different repo than the VS Code workspace
    const fileDir = path.dirname(filePath);
    const gitRoot = await runCmd("git rev-parse --show-toplevel", fileDir);
    if (!gitRoot) { return null; }

    const relative = path.relative(gitRoot, filePath).replace(/\\/g, "/");
    const output   = await runCmd(
      `git blame -p -L ${line},${line} -- "${relative}"`,
      gitRoot,
    );
    const match = output.match(/^author (.+)$/m);
    const author = match ? match[1].trim() : null;
    // git blame returns "Not Committed Yet" for uncommitted lines
    return author && author !== "Not Committed Yet" ? author : null;
  } catch {
    return null;
  }
}