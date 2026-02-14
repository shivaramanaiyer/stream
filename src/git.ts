import path from "path";
import { runCommand } from "./utils/exec";
import { pathExists } from "./utils/fs";

export async function getCurrentBranch(repoPath: string): Promise<string | undefined> {
  const gitDir = path.join(repoPath, ".git");
  if (!(await pathExists(gitDir))) return undefined;
  const result = await runCommand("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
    inheritStdout: false
  });
  if (result.code !== 0) return undefined;
  return result.stdout.trim();
}

async function branchExists(repoPath: string, ref: string): Promise<boolean> {
  const result = await runCommand("git", ["-C", repoPath, "show-ref", "--verify", "--quiet", ref], {
    inheritStdout: false
  });
  return result.code === 0;
}

async function getDefaultRemote(repoPath: string): Promise<string | undefined> {
  const result = await runCommand("git", ["-C", repoPath, "remote"], { inheritStdout: false });
  if (result.code !== 0) return undefined;
  const remotes = result.stdout
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (remotes.length === 0) return undefined;
  if (remotes.includes("origin")) return "origin";
  return remotes[0];
}

export async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
  const gitDir = path.join(repoPath, ".git");
  if (!(await pathExists(gitDir))) {
    throw new Error(".git not found in stream; include .git to use checkout.");
  }
  const localRef = `refs/heads/${branch}`;
  if (await branchExists(repoPath, localRef)) {
    const result = await runCommand("git", ["-C", repoPath, "checkout", branch], {
      inheritStdout: true
    });
    if (result.code !== 0) {
      throw new Error(`git checkout failed with code ${result.code}`);
    }
    return;
  }

  const remote = await getDefaultRemote(repoPath);
  if (remote) {
    const remoteRef = `refs/remotes/${remote}/${branch}`;
    if (await branchExists(repoPath, remoteRef)) {
      const result = await runCommand("git", ["-C", repoPath, "checkout", "--track", `${remote}/${branch}`], {
        inheritStdout: true
      });
      if (result.code !== 0) {
        throw new Error(`git checkout failed with code ${result.code}`);
      }
      return;
    }
  }

  const result = await runCommand("git", ["-C", repoPath, "checkout", "-b", branch], {
    inheritStdout: true
  });
  if (result.code !== 0) {
    throw new Error(`git checkout failed with code ${result.code}`);
  }
}

export async function listWorkingTreeChanges(repoPath: string): Promise<string[] | undefined> {
  const gitDir = path.join(repoPath, ".git");
  if (!(await pathExists(gitDir))) return undefined;
  const result = await runCommand(
    "git",
    ["-C", repoPath, "status", "--porcelain", "--untracked-files=all"],
    { inheritStdout: false }
  );
  if (result.code !== 0) {
    const message = result.stderr.trim() || `git status failed with code ${result.code}`;
    throw new Error(`Unable to inspect changes in ${repoPath}: ${message}`);
  }
  return result.stdout
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}
