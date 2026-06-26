import * as fs   from "fs";
import * as path from "path";

export interface PreCommitCheck {
  timestamp: string;
  functions: Array<{ name: string; file: string; score: number }>;
  minScore:  number;
  blocked:   boolean;
}

const HOOK_MARKER = "# AI-Code-Reviewer";

// Shell-script installed at .git/hooks/pre-commit
const HOOK_SCRIPT = `#!/bin/sh
# AI-Code-Reviewer
# Installed automatically by the VS Code AI Code Reviewer extension.
# To bypass a blocked commit: git commit --no-verify

DATA=".ai-reviewer/pre-commit-check.json"

if [ ! -f "$DATA" ]; then
  echo "AI Reviewer: no recent review found — save the file in VS Code first (or skip with --no-verify)"
  exit 0
fi

if command -v node >/dev/null 2>&1; then
  BLOCKED=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$DATA','utf8'));process.stdout.write(d.blocked?'1':'0')}catch(e){process.stdout.write('0')}" 2>/dev/null || echo "0")
  SCORE=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('$DATA','utf8'));process.stdout.write(String(d.minScore))}catch(e){process.stdout.write('?')}" 2>/dev/null || echo "?")
elif command -v python3 >/dev/null 2>&1; then
  BLOCKED=$(python3 -c "import json;d=json.load(open('$DATA'));print('1' if d.get('blocked') else '0')" 2>/dev/null || echo "0")
  SCORE=$(python3 -c "import json;d=json.load(open('$DATA'));print(d.get('minScore','?'))" 2>/dev/null || echo "?")
else
  echo "AI Reviewer: skipping quality check (node/python3 not found)"
  exit 0
fi

if [ "$BLOCKED" = "1" ]; then
  echo ""
  echo "AI Reviewer: Commit blocked — lowest function score is $SCORE/10 (minimum: 5/10)"
  echo "  Fix the issues shown in the VS Code review panel, then save to re-run the review."
  echo "  To bypass: git commit --no-verify"
  echo ""
  exit 1
fi

echo "AI Reviewer: quality check passed (score $SCORE/10)"
exit 0
`;

export function installPreCommitHook(workspaceRoot: string): void {
  const gitDir = path.join(workspaceRoot, ".git");
  if (!fs.existsSync(gitDir)) { return; }

  const hooksDir = path.join(gitDir, "hooks");
  if (!fs.existsSync(hooksDir)) { fs.mkdirSync(hooksDir, { recursive: true }); }

  const hookPath = path.join(hooksDir, "pre-commit");

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf-8");
    // Don't overwrite a hook that belongs to another tool
    if (!existing.includes(HOOK_MARKER)) { return; }
  }

  fs.writeFileSync(hookPath, HOOK_SCRIPT, "utf-8");
  try { fs.chmodSync(hookPath, 0o755); } catch { /* no-op on Windows */ }
}

export function writePreCommitCheck(workspaceRoot: string, check: PreCommitCheck): void {
  const dir = path.join(workspaceRoot, ".ai-reviewer");
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
  fs.writeFileSync(
    path.join(dir, "pre-commit-check.json"),
    JSON.stringify(check, null, 2),
    "utf-8",
  );
}
