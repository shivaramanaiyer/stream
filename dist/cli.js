#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = __importDefault(require("readline"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const stream_1 = require("./stream");
const git_1 = require("./git");
const status_1 = require("./status");
const fs_1 = require("./utils/fs");
const patterns_1 = require("./utils/patterns");
const strings_1 = require("./utils/strings");
function printHelp() {
    console.log(`Stream CLI

Usage:
  stream <id>            Create or open stream by number (e.g. stream 1)
  stream                 Interactive picker
  stream -               Open previous stream
  stream main|master     Open base repo
  stream del <id>        Delete a stream
  stream checkout|co <branch>  Open or create stream for branch
  stream cd <id>         Create/open stream and emit a cd marker
  stream list|ls         List streams
  stream shell           Print shell function for auto-cd
  stream init            Install shell integration for auto-cd
  stream config          Print resolved config

Options:
  --include <path>       Include path(s) when copying (can repeat)
  --exclude <path>       Exclude path(s) when copying (can repeat)
  --no-setup             Skip setup steps
  --no-install           Alias for --no-setup
  --editor <command>     Override editor command
  --cd                   Emit cd marker for shell wrapper
  --dry-run              Show actions without running
  --verbose              Verbose logging
  -h, --help             Show help
`);
}
function stripOuterQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    if ((trimmed.startsWith("\\\"") && trimmed.endsWith("\\\"")) ||
        (trimmed.startsWith("\\'") && trimmed.endsWith("\\'"))) {
        return trimmed.slice(2, -2);
    }
    return trimmed;
}
function parseArgs(argv) {
    const options = {
        noSetup: false,
        includes: [],
        excludes: [],
        dryRun: false,
        verbose: false,
        emitCd: false
    };
    const positional = [];
    let help = false;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === "--no-setup" || arg === "--no-install") {
            options.noSetup = true;
            continue;
        }
        if (arg === "--include") {
            const value = argv[i + 1];
            if (!value)
                throw new Error("--include requires a value");
            options.includes.push(value);
            i += 1;
            continue;
        }
        if (arg === "--exclude") {
            const value = argv[i + 1];
            if (!value)
                throw new Error("--exclude requires a value");
            options.excludes.push(value);
            i += 1;
            continue;
        }
        if (arg === "--editor") {
            const value = argv[i + 1];
            if (!value)
                throw new Error("--editor requires a value");
            options.editorOverride = value;
            i += 1;
            continue;
        }
        if (arg === "--cd") {
            options.emitCd = true;
            continue;
        }
        if (arg === "--dry-run") {
            options.dryRun = true;
            continue;
        }
        if (arg === "--verbose") {
            options.verbose = true;
            continue;
        }
        if (arg === "-h" || arg === "--help") {
            help = true;
            continue;
        }
        if (arg === "-") {
            positional.push(arg);
            continue;
        }
        if (arg.startsWith("-")) {
            throw new Error(`Unknown flag: ${arg}`);
        }
        const cleaned = stripOuterQuotes(arg);
        if (cleaned.length === 0)
            continue;
        positional.push(cleaned);
    }
    return { positional, options, help };
}
function prompt(question, output = process.stdout) {
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output
    });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}
async function interactivePicker(configPath, options) {
    const config = await (0, config_1.resolveConfig)(configPath);
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
    const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);
    if (streams.length === 0) {
        const id = await prompt("No streams found. Enter a new stream id: ", options.emitCd ? process.stderr : process.stdout);
        if (!id)
            return;
        await (0, stream_1.createOrOpenStream)({ id, config, cli: options });
        return;
    }
    (0, logger_1.logInfo)(renderStreamTable(entries));
    const answer = await prompt("Select a stream by number or enter a new id: ", options.emitCd ? process.stderr : process.stdout);
    if (!answer)
        return;
    const cleaned = answer.trim();
    const num = Number(cleaned);
    if (cleaned === "0" || cleaned.toLowerCase() === "main" || cleaned.toLowerCase() === "base") {
        await (0, stream_1.openBaseRepo)(config, options);
        return;
    }
    const id = Number.isInteger(num) && num > 0 && num <= streams.length ? streams[num - 1].name : cleaned;
    await (0, stream_1.createOrOpenStream)({ id, config, cli: options });
}
async function interactivePickerWithResult(configPath, options) {
    const config = await (0, config_1.resolveConfig)(configPath);
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
    const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);
    if (streams.length === 0) {
        const id = await prompt("No streams found. Enter a new stream id: ", options.emitCd ? process.stderr : process.stdout);
        if (!id)
            return undefined;
        const stream = await (0, stream_1.createOrOpenStream)({ id, config, cli: options });
        return { kind: "stream", path: stream.path, name: stream.name };
    }
    (0, logger_1.logInfo)(renderStreamTable(entries));
    const answer = await prompt("Select a stream by number or enter a new id: ", options.emitCd ? process.stderr : process.stdout);
    if (!answer)
        return undefined;
    const cleaned = answer.trim();
    const num = Number(cleaned);
    if (cleaned === "0" || cleaned.toLowerCase() === "main" || cleaned.toLowerCase() === "base") {
        await (0, stream_1.openBaseRepo)(config, options);
        return { kind: "base", path: config.baseRepoPath, name: "main" };
    }
    const id = Number.isInteger(num) && num > 0 && num <= streams.length ? streams[num - 1].name : cleaned;
    const stream = await (0, stream_1.createOrOpenStream)({ id, config, cli: options });
    return { kind: "stream", path: stream.path, name: stream.name };
}
const CD_MARKER = "__stream_cd:";
const SHELL_MARKER = "# >>> stream shell integration >>>";
const SHELL_MARKER_END = "# <<< stream shell integration <<<";
function printCd(pathValue) {
    console.log(`${CD_MARKER}${pathValue}`);
}
function printShellFunction() {
    const shellFunc = buildShellFunction(isFishShell());
    console.log(shellFunc);
}
function isFishShell() {
    return (process.env.SHELL || "").includes("fish");
}
function buildShellFunction(isFish) {
    return isFish ? buildFishFunction() : buildBashZshFunction();
}
function buildFishFunction() {
    return `${SHELL_MARKER}
function stream
    set -l result (command stream --cd $argv)
    set -l code $status

    if string match -q "*${CD_MARKER}*" "$result"
        set -l lines (string split \\n "$result")
        for line in $lines
            if string match -q "${CD_MARKER}*" "$line"
                cd (string replace "${CD_MARKER}" "" "$line")
            else
                test -n "$line"; and echo "$line"
            end
        end
    else
        test -n "$result"; and echo "$result"
    end
    return $code
end
${SHELL_MARKER_END}`;
}
function buildBashZshFunction() {
    return `${SHELL_MARKER}
stream() {
  local result
  result=$(command stream --cd "$@")
  local code=$?
  if [[ "$result" == *${CD_MARKER}* ]]; then
    local output=""
    local cdpath=""
    while IFS= read -r line; do
      if [[ "$line" == ${CD_MARKER}* ]]; then
        cdpath="\${line#${CD_MARKER}}"
      else
        [[ -n "$output" ]] && output="$output"$'\\n'
        output="$output$line"
      fi
    done <<< "$result"
    [[ -n "$output" ]] && echo "$output"
    [[ -n "$cdpath" ]] && cd "$cdpath"
  else
    [[ -n "$result" ]] && echo "$result"
  fi
  return $code
}
${SHELL_MARKER_END}`;
}
async function installShellIntegration() {
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await Promise.resolve().then(() => __importStar(require("fs")));
    const { homedir } = await Promise.resolve().then(() => __importStar(require("os")));
    const pathModule = await Promise.resolve().then(() => __importStar(require("path")));
    const shell = process.env.SHELL || "";
    const isFish = shell.includes("fish");
    const home = homedir();
    let configFile;
    if (isFish) {
        configFile = pathModule.join(home, ".config", "fish", "config.fish");
        const fishConfigDir = pathModule.dirname(configFile);
        if (!existsSync(fishConfigDir)) {
            mkdirSync(fishConfigDir, { recursive: true });
        }
    }
    else if (shell.includes("zsh")) {
        configFile = pathModule.join(home, ".zshrc");
    }
    else {
        configFile = pathModule.join(home, ".bashrc");
    }
    const shellFunc = buildShellFunction(isFish);
    let existingContent = "";
    if (existsSync(configFile)) {
        existingContent = readFileSync(configFile, "utf-8");
        if (existingContent.includes(SHELL_MARKER)) {
            const escapedStart = SHELL_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const escapedEnd = SHELL_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, "g");
            existingContent = existingContent.replace(regex, "");
        }
    }
    const newContent = existingContent.trimEnd() + "\n\n" + shellFunc + "\n";
    writeFileSync(configFile, newContent);
    console.log(`Shell integration installed to ${configFile}`);
    console.log("Run this to activate (or restart your terminal):");
    console.log(`  source ${configFile}`);
}
function isPathInside(child, parent) {
    const rel = path_1.default.relative(parent, child);
    return rel === "" || (!rel.startsWith(`..${path_1.default.sep}`) && rel !== ".." && !path_1.default.isAbsolute(rel));
}
function buildDisplayEntries(baseRepoPath, streams, lastActive) {
    const cwd = process.cwd();
    const entries = [];
    const baseActive = isPathInside(cwd, baseRepoPath);
    const cwdStream = streams.find((stream) => isPathInside(cwd, stream.path));
    entries.push({
        kind: "base",
        name: "main",
        status: "base",
        path: baseRepoPath,
        active: baseActive
    });
    for (const stream of streams) {
        const active = (cwdStream && cwdStream.name === stream.name) ||
            (!cwdStream && stream.name === lastActive);
        entries.push({
            kind: "stream",
            name: stream.name,
            status: stream.status,
            path: stream.path,
            branch: stream.branch,
            active
        });
    }
    return entries;
}
function renderStreamTable(entries) {
    const nameWidth = Math.max(...entries.map((s) => s.name.length), "Name".length);
    const statusWidth = Math.max(...entries.map((s) => s.status.length), "Status".length);
    const header = `#  A  ${"Name".padEnd(nameWidth)}  ${"Status".padEnd(statusWidth)}  Path`;
    const lines = entries.map((entry, index) => {
        const active = entry.active ? "*" : " ";
        const name = entry.name.padEnd(nameWidth);
        const status = entry.status.padEnd(statusWidth);
        const branch = entry.branch ? `  branch:${entry.branch}` : "";
        const indexLabel = entry.kind === "base" ? "0" : String(index);
        return `${indexLabel.padEnd(2)} ${active}  ${name}  ${status}  ${entry.path}${branch}`;
    });
    return ["Available streams:", header, ...lines].join("\n");
}
async function ensureCheckoutPrereqs(config, options) {
    const gitPath = path_1.default.join(config.baseRepoPath, ".git");
    if (!(await (0, fs_1.pathExists)(gitPath))) {
        throw new Error(`stream checkout requires a git repo at ${config.baseRepoPath}`);
    }
    const shouldInclude = (0, patterns_1.buildIncludePredicate)(options.includes, [
        ...config.copyExcludes,
        ...options.excludes
    ]);
    if (!shouldInclude(".git")) {
        throw new Error("stream checkout requires .git to be copied into streams. Remove .git from copyExcludes or pass --include .git.");
    }
}
function nextStreamId(streams, prefix, slug) {
    let max = 0;
    const regex = new RegExp(`^${prefix}-${slug}-(\\d+)$`);
    for (const stream of streams) {
        const match = stream.name.match(regex);
        if (!match)
            continue;
        const num = Number(match[1]);
        if (Number.isInteger(num) && num > max)
            max = num;
    }
    return String(max + 1);
}
function buildBranchStreamName(config, branch, streams) {
    const branchSlug = (0, strings_1.slugify)(branch);
    const slug = `${config.naming.slug}-${branchSlug}`;
    const nextId = nextStreamId(streams, config.naming.prefix, slug);
    return `${config.naming.prefix}-${slug}-${nextId}`;
}
async function main() {
    const { positional, options, help } = parseArgs(process.argv.slice(2));
    if (help) {
        printHelp();
        return;
    }
    (0, logger_1.setVerbose)(options.verbose);
    if (options.emitCd) {
        (0, logger_1.setLogToStderr)(true);
    }
    const cwd = process.cwd();
    if (positional.length === 0) {
        if (options.emitCd) {
            const info = await interactivePickerWithResult(cwd, options);
            if (info)
                printCd(info.path);
        }
        else {
            await interactivePicker(cwd, options);
        }
        return;
    }
    const command = positional[0];
    const rest = positional.slice(1);
    const config = await (0, config_1.resolveConfig)(cwd);
    if (command === "config") {
        console.log(JSON.stringify(config, null, 2));
        return;
    }
    if (command === "-") {
        const info = await (0, stream_1.openLastStream)(config, options);
        if (options.emitCd)
            printCd(info.path);
        return;
    }
    if (command === "main" || command === "master") {
        await (0, stream_1.openBaseRepo)(config, options);
        if (options.emitCd)
            printCd(config.baseRepoPath);
        return;
    }
    if (command === "del") {
        const id = rest[0];
        if (!id)
            throw new Error("stream del requires an id");
        const confirm = await prompt(`Delete stream ${id}? (y/N): `);
        if (confirm.toLowerCase() === "y") {
            await (0, stream_1.deleteStream)(config, options, id);
        }
        else {
            (0, logger_1.logInfo)("Delete cancelled.");
        }
        return;
    }
    if (command === "shell") {
        printShellFunction();
        return;
    }
    if (command === "init") {
        await installShellIntegration();
        return;
    }
    if (command === "list" || command === "ls") {
        const status = await (0, status_1.readStatus)(config.baseRepoPath);
        const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
        const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);
        console.log(renderStreamTable(entries));
        return;
    }
    if (command === "cd") {
        const id = rest[0];
        if (!id)
            throw new Error("stream cd requires an id");
        options.emitCd = true;
        (0, logger_1.setLogToStderr)(true);
        const info = await (0, stream_1.createOrOpenStream)({ id, config, cli: options });
        printCd(info.path);
        return;
    }
    if (command === "checkout" || command === "co") {
        const branch = rest[0];
        if (!branch)
            throw new Error("stream checkout requires a branch");
        const existing = await (0, stream_1.resolveStreamByBranch)(config, branch);
        if (existing) {
            const info = await (0, stream_1.createOrOpenStream)({ id: existing.name, config, cli: options });
            if (options.emitCd)
                printCd(info.path);
            return;
        }
        await ensureCheckoutPrereqs(config, options);
        const streams = await (0, stream_1.listStreams)(config);
        const streamName = buildBranchStreamName(config, branch, streams);
        const info = await (0, stream_1.createOrOpenStream)({ id: streamName, config, cli: options });
        try {
            if (!options.dryRun) {
                await (0, git_1.checkoutBranch)(info.path, branch);
                const status = await (0, status_1.readStatus)(config.baseRepoPath);
                const stream = status.streams[info.name];
                if (stream) {
                    stream.branch = branch;
                }
                await (0, status_1.writeStatus)(config.baseRepoPath, status);
            }
        }
        catch (err) {
            (0, logger_1.logWarn)(`Checkout failed: ${err.message ?? err}`);
        }
        if (options.emitCd)
            printCd(info.path);
        return;
    }
    const info = await (0, stream_1.createOrOpenStream)({ id: command, config, cli: options });
    if (options.emitCd)
        printCd(info.path);
}
main().catch((err) => {
    (0, logger_1.logError)(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
