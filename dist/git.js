"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentBranch = getCurrentBranch;
exports.checkoutBranch = checkoutBranch;
const path_1 = __importDefault(require("path"));
const exec_1 = require("./utils/exec");
const fs_1 = require("./utils/fs");
async function getCurrentBranch(repoPath) {
    const gitDir = path_1.default.join(repoPath, ".git");
    if (!(await (0, fs_1.pathExists)(gitDir)))
        return undefined;
    const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
        inheritStdout: false
    });
    if (result.code !== 0)
        return undefined;
    return result.stdout.trim();
}
async function branchExists(repoPath, ref) {
    const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "show-ref", "--verify", "--quiet", ref], {
        inheritStdout: false
    });
    return result.code === 0;
}
async function getDefaultRemote(repoPath) {
    const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "remote"], { inheritStdout: false });
    if (result.code !== 0)
        return undefined;
    const remotes = result.stdout
        .split(/\r?\n/g)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
    if (remotes.length === 0)
        return undefined;
    if (remotes.includes("origin"))
        return "origin";
    return remotes[0];
}
async function checkoutBranch(repoPath, branch) {
    const gitDir = path_1.default.join(repoPath, ".git");
    if (!(await (0, fs_1.pathExists)(gitDir))) {
        throw new Error(".git not found in stream; include .git to use checkout.");
    }
    const localRef = `refs/heads/${branch}`;
    if (await branchExists(repoPath, localRef)) {
        const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "checkout", branch], {
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
            const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "checkout", "--track", `${remote}/${branch}`], {
                inheritStdout: true
            });
            if (result.code !== 0) {
                throw new Error(`git checkout failed with code ${result.code}`);
            }
            return;
        }
    }
    const result = await (0, exec_1.runCommand)("git", ["-C", repoPath, "checkout", "-b", branch], {
        inheritStdout: true
    });
    if (result.code !== 0) {
        throw new Error(`git checkout failed with code ${result.code}`);
    }
}
