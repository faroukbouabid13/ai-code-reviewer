import { exec } from "child_process";
import type { CompileError } from "../pipeline/types";

export function getCompileErrors(workspace: string): Promise<CompileError[]> {
  return new Promise(resolve => {
    exec("npx tsc --noEmit --pretty false 2>&1", { cwd: workspace }, (_, stdout) => {
      const errors: CompileError[] = [];
      for (const line of (stdout || "").split("\n")) {
        const m = line.match(/\((\d+),\d+\):\s+error TS\d+:\s+(.+)/);
        if (m) { errors.push({ line: parseInt(m[1]), message: m[2].trim() }); }
      }
      resolve(errors);
    });
  });
}