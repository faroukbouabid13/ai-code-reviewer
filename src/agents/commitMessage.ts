import { callAgent } from "./caller";

export interface CommitInput {
  file:      string;
  functions: Array<{ name: string; score: number; issues: string[] }>;
}

const SYSTEM = `You are a senior software engineer writing Git commit messages.
Given an AI code review summary, generate a single conventional commit message.
Rules:
- One line only, maximum 72 characters
- Format: type(scope): description
- Use types: fix, refactor, perf, style, test, docs, chore
- Be specific — name the actual problem found, not vague "improvements"
- Never write "various improvements", "code quality", or "multiple changes"
- Output ONLY the commit message line, nothing else`;

export async function generateCommitMessage(input: CommitInput): Promise<string> {
  const scope  = input.file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "code";
  const lines  = input.functions.map(f => {
    const top = f.issues.slice(0, 3).join("; ");
    return `  - ${f.name} (score ${f.score}/10)${top ? `: ${top}` : ""}`;
  }).join("\n");

  const user = `File: ${input.file}\nScope hint: ${scope}\n\nCode review findings:\n${lines}\n\nGenerate a conventional commit message:`;
  return callAgent(SYSTEM, user, "quality");
}
