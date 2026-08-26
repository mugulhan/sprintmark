import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(workspace, args) {
  try {
    return (
      await execFileAsync("git", args, { cwd: workspace, windowsHide: true })
    ).stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function gitMeta(workspace) {
  const [branch, sha, status] = await Promise.all([
    git(workspace, ["branch", "--show-current"]),
    git(workspace, ["rev-parse", "--short", "HEAD"]),
    git(workspace, ["status", "--porcelain"]),
  ]);
  return { branch, sha, dirty: Boolean(status && status !== "unknown") };
}
