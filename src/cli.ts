#!/usr/bin/env node
import readline from "readline";
import path from "path";
import { resolveConfig } from "./config";
import type { CliOptions, StreamConfig, StreamInfo, StreamStatus } from "./types";
import { setVerbose, setLogToStderr, logError, logInfo, logWarn } from "./logger";
import {
  createOrOpenStream,
  deleteStream,
  listStreams,
  openBaseRepo,
  openLastStream,
  resolveStreamByBranch
} from "./stream";
import { checkoutBranch } from "./git";
import { readStatus, writeStatus } from "./status";
import { pathExists } from "./utils/fs";
import { buildIncludePredicate } from "./utils/patterns";
import { slugify } from "./utils/strings";

function printHelp(): void {
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

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (
    (trimmed.startsWith("\\\"") && trimmed.endsWith("\\\"")) ||
    (trimmed.startsWith("\\'") && trimmed.endsWith("\\'"))
  ) {
    return trimmed.slice(2, -2);
  }
  return trimmed;
}

function parseArgs(argv: string[]): { positional: string[]; options: CliOptions; help: boolean } {
  const options: CliOptions = {
    noSetup: false,
    includes: [],
    excludes: [],
    dryRun: false,
    verbose: false,
    emitCd: false
  };
  const positional: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-setup" || arg === "--no-install") {
      options.noSetup = true;
      continue;
    }
    if (arg === "--include") {
      const value = argv[i + 1];
      if (!value) throw new Error("--include requires a value");
      options.includes.push(value);
      i += 1;
      continue;
    }
    if (arg === "--exclude") {
      const value = argv[i + 1];
      if (!value) throw new Error("--exclude requires a value");
      options.excludes.push(value);
      i += 1;
      continue;
    }
    if (arg === "--editor") {
      const value = argv[i + 1];
      if (!value) throw new Error("--editor requires a value");
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
    if (cleaned.length === 0) continue;
    positional.push(cleaned);
  }

  return { positional, options, help };
}

function prompt(question: string, output: NodeJS.WritableStream = process.stdout): Promise<string> {
  const rl = readline.createInterface({
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

async function interactivePicker(configPath: string, options: CliOptions): Promise<void> {
  const config = await resolveConfig(configPath);
  const status = await readStatus(config.baseRepoPath);
  const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
  const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);

  if (streams.length === 0) {
    const id = await prompt(
      "No streams found. Enter a new stream id: ",
      options.emitCd ? process.stderr : process.stdout
    );
    if (!id) return;
    await createOrOpenStream({ id, config, cli: options });
    return;
  }

  logInfo(renderStreamTable(entries));

  const answer = await prompt(
    "Select a stream by number or enter a new id: ",
    options.emitCd ? process.stderr : process.stdout
  );
  if (!answer) return;
  const cleaned = answer.trim();
  const num = Number(cleaned);
  if (cleaned === "0" || cleaned.toLowerCase() === "main" || cleaned.toLowerCase() === "base") {
    await openBaseRepo(config, options);
    return;
  }
  const id = Number.isInteger(num) && num > 0 && num <= streams.length ? streams[num - 1].name : cleaned;
  await createOrOpenStream({ id, config, cli: options });
}

async function interactivePickerWithResult(
  configPath: string,
  options: CliOptions
): Promise<{ kind: "base" | "stream"; path: string; name: string } | undefined> {
  const config = await resolveConfig(configPath);
  const status = await readStatus(config.baseRepoPath);
  const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
  const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);

  if (streams.length === 0) {
    const id = await prompt(
      "No streams found. Enter a new stream id: ",
      options.emitCd ? process.stderr : process.stdout
    );
    if (!id) return undefined;
    const stream = await createOrOpenStream({ id, config, cli: options });
    return { kind: "stream", path: stream.path, name: stream.name };
  }

  logInfo(renderStreamTable(entries));

  const answer = await prompt(
    "Select a stream by number or enter a new id: ",
    options.emitCd ? process.stderr : process.stdout
  );
  if (!answer) return undefined;
  const cleaned = answer.trim();
  const num = Number(cleaned);
  if (cleaned === "0" || cleaned.toLowerCase() === "main" || cleaned.toLowerCase() === "base") {
    await openBaseRepo(config, options);
    return { kind: "base", path: config.baseRepoPath, name: "main" };
  }
  const id = Number.isInteger(num) && num > 0 && num <= streams.length ? streams[num - 1].name : cleaned;
  const stream = await createOrOpenStream({ id, config, cli: options });
  return { kind: "stream", path: stream.path, name: stream.name };
}

const CD_MARKER = "__stream_cd:";
const SHELL_MARKER = "# >>> stream shell integration >>>";
const SHELL_MARKER_END = "# <<< stream shell integration <<<";

function printCd(pathValue: string): void {
  console.log(`${CD_MARKER}${pathValue}`);
}

function printShellFunction(): void {
  const shellFunc = buildShellFunction(isFishShell());
  console.log(shellFunc);
}

function isFishShell(): boolean {
  return (process.env.SHELL || "").includes("fish");
}

function buildShellFunction(isFish: boolean): string {
  return isFish ? buildFishFunction() : buildBashZshFunction();
}

function buildFishFunction(): string {
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

function buildBashZshFunction(): string {
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

async function installShellIntegration(): Promise<void> {
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("fs");
  const { homedir } = await import("os");
  const pathModule = await import("path");

  const shell = process.env.SHELL || "";
  const isFish = shell.includes("fish");
  const home = homedir();

  let configFile: string;
  if (isFish) {
    configFile = pathModule.join(home, ".config", "fish", "config.fish");
    const fishConfigDir = pathModule.dirname(configFile);
    if (!existsSync(fishConfigDir)) {
      mkdirSync(fishConfigDir, { recursive: true });
    }
  } else if (shell.includes("zsh")) {
    configFile = pathModule.join(home, ".zshrc");
  } else {
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

type DisplayEntry = {
  kind: "base" | "stream";
  name: string;
  status: StreamStatus | "base";
  path: string;
  branch?: string;
  active: boolean;
};

function isPathInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

function buildDisplayEntries(
  baseRepoPath: string,
  streams: StreamInfo[],
  lastActive?: string
): DisplayEntry[] {
  const cwd = process.cwd();
  const entries: DisplayEntry[] = [];
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
    const active =
      (cwdStream && cwdStream.name === stream.name) ||
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

function renderStreamTable(entries: DisplayEntry[]): string {
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

async function ensureCheckoutPrereqs(config: StreamConfig, options: CliOptions): Promise<void> {
  const gitPath = path.join(config.baseRepoPath, ".git");
  if (!(await pathExists(gitPath))) {
    throw new Error(`stream checkout requires a git repo at ${config.baseRepoPath}`);
  }
  const shouldInclude = buildIncludePredicate(options.includes, [
    ...config.copyExcludes,
    ...options.excludes
  ]);
  if (!shouldInclude(".git")) {
    throw new Error(
      "stream checkout requires .git to be copied into streams. Remove .git from copyExcludes or pass --include .git."
    );
  }
}

function nextStreamId(streams: { name: string }[], prefix: string, slug: string): string {
  let max = 0;
  const regex = new RegExp(`^${prefix}-${slug}-(\\d+)$`);
  for (const stream of streams) {
    const match = stream.name.match(regex);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isInteger(num) && num > max) max = num;
  }
  return String(max + 1);
}

function buildBranchStreamName(config: StreamConfig, branch: string, streams: StreamInfo[]): string {
  const branchSlug = slugify(branch);
  const slug = `${config.naming.slug}-${branchSlug}`;
  const nextId = nextStreamId(streams, config.naming.prefix, slug);
  return `${config.naming.prefix}-${slug}-${nextId}`;
}

async function main(): Promise<void> {
  const { positional, options, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  setVerbose(options.verbose);
  if (options.emitCd) {
    setLogToStderr(true);
  }
  const cwd = process.cwd();

  if (positional.length === 0) {
    if (options.emitCd) {
      const info = await interactivePickerWithResult(cwd, options);
      if (info) printCd(info.path);
    } else {
      await interactivePicker(cwd, options);
    }
    return;
  }

  const command = positional[0];
  const rest = positional.slice(1);
  const config = await resolveConfig(cwd);

  if (command === "config") {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (command === "-") {
    const info = await openLastStream(config, options);
    if (options.emitCd) printCd(info.path);
    return;
  }

  if (command === "main" || command === "master") {
    await openBaseRepo(config, options);
    if (options.emitCd) printCd(config.baseRepoPath);
    return;
  }

  if (command === "del") {
    const id = rest[0];
    if (!id) throw new Error("stream del requires an id");
    const confirm = await prompt(`Delete stream ${id}? (y/N): `);
    if (confirm.toLowerCase() === "y") {
      await deleteStream(config, options, id);
    } else {
      logInfo("Delete cancelled.");
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
    const status = await readStatus(config.baseRepoPath);
    const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
    const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);
    console.log(renderStreamTable(entries));
    return;
  }

  if (command === "cd") {
    const id = rest[0];
    if (!id) throw new Error("stream cd requires an id");
    options.emitCd = true;
    setLogToStderr(true);
    const info = await createOrOpenStream({ id, config, cli: options });
    printCd(info.path);
    return;
  }

  if (command === "checkout" || command === "co") {
    const branch = rest[0];
    if (!branch) throw new Error("stream checkout requires a branch");
    const existing = await resolveStreamByBranch(config, branch);
    if (existing) {
      const info = await createOrOpenStream({ id: existing.name, config, cli: options });
      if (options.emitCd) printCd(info.path);
      return;
    }
    await ensureCheckoutPrereqs(config, options);
    const streams = await listStreams(config);
    const streamName = buildBranchStreamName(config, branch, streams);
    const info = await createOrOpenStream({ id: streamName, config, cli: options });
    try {
      if (!options.dryRun) {
        await checkoutBranch(info.path, branch);
        const status = await readStatus(config.baseRepoPath);
        const stream = status.streams[info.name];
        if (stream) {
          stream.branch = branch;
        }
        await writeStatus(config.baseRepoPath, status);
      }
    } catch (err: any) {
      logWarn(`Checkout failed: ${err.message ?? err}`);
    }
    if (options.emitCd) printCd(info.path);
    return;
  }

  const info = await createOrOpenStream({ id: command, config, cli: options });
  if (options.emitCd) printCd(info.path);
}

main().catch((err) => {
  logError(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
