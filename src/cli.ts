#!/usr/bin/env node
import readline from "readline";
import path from "path";
import { resolveConfig } from "./config";
import type { CliOptions, StatusFile, StreamConfig, StreamInfo, StreamStatus } from "./types";
import { setVerbose, setLogToStderr, logError, logInfo, logWarn } from "./logger";
import {
  createOrOpenStream,
  deleteStream,
  listStreams,
  openBaseRepo,
  openLastStream,
  resolveStreamByBranch,
  setupCurrentStreamEnvironment
} from "./stream";
import { checkoutBranch } from "./git";
import { readStatus, writeStatus } from "./status";
import { pathExists } from "./utils/fs";
import { buildIncludePredicate } from "./utils/patterns";
import { slugify } from "./utils/strings";

const KNOWN_COMMANDS = [
  "config",
  "del",
  "shell",
  "init",
  "list",
  "ls",
  "cd",
  "checkout",
  "co",
  "status",
  "setup",
  "completion"
];
const KNOWN_FLAGS = [
  "--no-setup",
  "--no-install",
  "--include",
  "--exclude",
  "--editor",
  "--cd",
  "--dry-run",
  "--force",
  "--verbose",
  "-h",
  "--help"
];
const FLAGS_WITH_VALUE = new Set(["--include", "--exclude", "--editor"]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0)
  );
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function suggestClosest(input: string, candidates: string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: { candidate: string; score: number } | undefined;
  for (const candidate of candidates) {
    const hay = candidate.toLowerCase();
    const score = hay.startsWith(needle) || needle.startsWith(hay) ? 0 : levenshtein(needle, hay);
    if (!best || score < best.score) {
      best = { candidate, score };
    }
  }
  if (!best) return undefined;
  const threshold = Math.max(2, Math.ceil(input.length * 0.4));
  return best.score <= threshold ? best.candidate : undefined;
}

function suggestionSuffix(input: string, candidates: string[]): string {
  const suggestion = suggestClosest(input, candidates);
  return suggestion ? `. Did you mean '${suggestion}'?` : "";
}

function isNumericStreamId(value: string): boolean {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
}

function printHelp(): void {
  console.log(`Stream CLI

Usage:
  stream <id>            Create or open stream by number (e.g. stream 1)
  stream                 Interactive picker
  stream -               Open previous stream
  stream main|master     Open base repo
  stream del [id]        Delete a stream (prompts when id is omitted)
  stream checkout|co <branch>  Open or create stream for branch
  stream cd <id>         Create/open stream and emit a cd marker
  stream list|ls         List streams
  stream status          Show current stream/base status
  stream setup           Setup current stream env (rename niri workspace + open cursor)
  stream shell           Print shell function for auto-cd
  stream completion [shell]  Print shell completion script (bash|zsh|fish)
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
  --force                Bypass safety checks for destructive actions
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
    force: false,
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
    if (arg === "--force") {
      options.force = true;
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
      const extra = suggestionSuffix(arg, KNOWN_FLAGS);
      throw new Error(`Unknown flag: ${arg}${extra}`);
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

type StreamSelection = { kind: "base" } | { kind: "stream"; id: string } | { kind: "create"; id: string };
type PickerChoice = { selection: StreamSelection; label: string };
type DeleteChoice = { id: string; label: string };

function pickerOutput(options: CliOptions): NodeJS.WriteStream {
  return options.emitCd ? process.stderr : process.stdout;
}

function fuzzyScore(query: string, text: string): number | undefined {
  if (!query) return 0;
  const source = text.toLowerCase();
  const needle = query.toLowerCase();
  let score = 0;
  let cursor = -1;
  for (let i = 0; i < needle.length; i += 1) {
    const idx = source.indexOf(needle[i], cursor + 1);
    if (idx === -1) return undefined;
    score += idx - cursor - 1;
    cursor = idx;
  }
  return score + (source.length - needle.length);
}

function buildPickerChoices(entries: DisplayEntry[], query: string): PickerChoice[] {
  const trimmed = query.trim();
  const normalized = trimmed.toLowerCase();
  const filtered = entries
    .map((entry) => {
      const haystack = `${entry.name} ${entry.path} ${entry.status} ${entry.branch ?? ""}`;
      return {
        entry,
        score: fuzzyScore(normalized, haystack)
      };
    })
    .filter((item) => item.score !== undefined)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.entry.name.localeCompare(b.entry.name));

  const choices = filtered.map((item) => {
    const entry = item.entry;
    if (entry.kind === "base") {
      return {
        selection: { kind: "base" } as StreamSelection,
        label: `main [base] ${entry.path}`
      };
    }
    const branchLabel = entry.branch ? ` branch:${entry.branch}` : "";
    return {
      selection: { kind: "stream", id: entry.name } as StreamSelection,
      label: `${entry.name} [${entry.status}] ${entry.path}${branchLabel}`
    };
  });

  const streamExists = entries.some(
    (entry) => entry.kind === "stream" && entry.name.toLowerCase() === normalized
  );
  if (
    trimmed &&
    !streamExists &&
    normalized !== "main" &&
    normalized !== "base" &&
    normalized !== "0"
  ) {
    choices.unshift({
      selection: { kind: "create", id: trimmed },
      label: `Create new stream '${trimmed}'`
    });
  }

  return choices;
}

async function fuzzyPicker(entries: DisplayEntry[], options: CliOptions): Promise<StreamSelection | undefined> {
  const output = pickerOutput(options);
  if (!process.stdin.isTTY || !output.isTTY || typeof process.stdin.setRawMode !== "function") {
    return undefined;
  }

  const stdin = process.stdin;
  const previousRaw = stdin.isRaw;
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  let query = "";
  let selected = 0;
  let choices = buildPickerChoices(entries, query);
  const maxVisible = 10;
  let renderedLines = 0;

  const refreshChoices = (): void => {
    choices = buildPickerChoices(entries, query);
    if (selected >= choices.length) selected = Math.max(choices.length - 1, 0);
  };

  const lineWidth = (): number => {
    const width = output.columns ?? process.stdout.columns ?? 120;
    return Math.max(20, width);
  };

  const clampLine = (line: string): string => {
    const width = lineWidth();
    if (line.length < width) return line;
    if (width <= 4) return line.slice(0, width);
    return `${line.slice(0, width - 3)}...`;
  };

  const render = (): void => {
    if (renderedLines > 0) {
      readline.moveCursor(output, 0, -renderedLines);
      readline.cursorTo(output, 0);
    }
    readline.clearScreenDown(output);
    const lines: string[] = [];
    lines.push("Select stream (type to filter, Up/Down to move, Enter to select, Esc to cancel)");
    lines.push(`Query: ${query}`);
    if (choices.length === 0) {
      lines.push("No matches. Type an id and press Enter to create.");
      output.write(lines.map(clampLine).join("\n"));
      output.write("\n");
      renderedLines = lines.length;
      return;
    }
    const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), choices.length - maxVisible));
    const visible = choices.slice(start, start + maxVisible);
    for (let i = 0; i < visible.length; i += 1) {
      const absolute = start + i;
      const marker = absolute === selected ? ">" : " ";
      lines.push(`${marker} ${visible[i].label}`);
    }
    if (choices.length > maxVisible) {
      lines.push(`${selected + 1}/${choices.length}`);
    }
    output.write(lines.map(clampLine).join("\n"));
    output.write("\n");
    renderedLines = lines.length;
  };

  return new Promise((resolve) => {
    const finish = (result?: StreamSelection): void => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(Boolean(previousRaw));
      output.write("\n");
      resolve(result);
    };

    const onKeypress = (str: string, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        finish(undefined);
        return;
      }
      if (key.name === "escape") {
        finish(undefined);
        return;
      }
      if (key.name === "up") {
        if (choices.length > 0) {
          selected = selected === 0 ? choices.length - 1 : selected - 1;
          render();
        }
        return;
      }
      if (key.name === "down") {
        if (choices.length > 0) {
          selected = (selected + 1) % choices.length;
          render();
        }
        return;
      }
      if (key.name === "backspace") {
        if (query.length > 0) {
          query = query.slice(0, -1);
          refreshChoices();
          render();
        }
        return;
      }
      if (key.name === "return") {
        if (choices.length > 0) {
          finish(choices[selected].selection);
          return;
        }
        const id = query.trim();
        finish(id ? { kind: "create", id } : undefined);
        return;
      }
      if (str && !key.ctrl && !key.meta) {
        query += str;
        refreshChoices();
        render();
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

function buildDeleteChoices(streams: StreamInfo[], query: string): DeleteChoice[] {
  const normalized = query.trim().toLowerCase();
  return streams
    .map((stream) => {
      const haystack = `${stream.name} ${stream.path} ${stream.status} ${stream.branch ?? ""}`;
      return {
        stream,
        score: fuzzyScore(normalized, haystack)
      };
    })
    .filter((item) => item.score !== undefined)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0) || a.stream.name.localeCompare(b.stream.name))
    .map((item) => {
      const stream = item.stream;
      const branchLabel = stream.branch ? ` branch:${stream.branch}` : "";
      return {
        id: stream.name,
        label: `${stream.name} [${stream.status}] ${stream.path}${branchLabel}`
      };
    });
}

async function fuzzyDeletePicker(streams: StreamInfo[], options: CliOptions): Promise<string | undefined> {
  const output = pickerOutput(options);
  if (!process.stdin.isTTY || !output.isTTY || typeof process.stdin.setRawMode !== "function") {
    return undefined;
  }

  const stdin = process.stdin;
  const previousRaw = stdin.isRaw;
  readline.emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  let query = "";
  let selected = 0;
  let choices = buildDeleteChoices(streams, query);
  const maxVisible = 10;
  let renderedLines = 0;

  const refreshChoices = (): void => {
    choices = buildDeleteChoices(streams, query);
    if (selected >= choices.length) selected = Math.max(choices.length - 1, 0);
  };

  const lineWidth = (): number => {
    const width = output.columns ?? process.stdout.columns ?? 120;
    return Math.max(20, width);
  };

  const clampLine = (line: string): string => {
    const width = lineWidth();
    if (line.length < width) return line;
    if (width <= 4) return line.slice(0, width);
    return `${line.slice(0, width - 3)}...`;
  };

  const render = (): void => {
    if (renderedLines > 0) {
      readline.moveCursor(output, 0, -renderedLines);
      readline.cursorTo(output, 0);
    }
    readline.clearScreenDown(output);
    const lines: string[] = [];
    lines.push("Select stream to delete (type to filter, Up/Down to move, Enter to select, Esc to cancel)");
    lines.push(`Query: ${query}`);
    if (choices.length === 0) {
      lines.push("No matches.");
      output.write(lines.map(clampLine).join("\n"));
      output.write("\n");
      renderedLines = lines.length;
      return;
    }
    const start = Math.max(0, Math.min(selected - Math.floor(maxVisible / 2), choices.length - maxVisible));
    const visible = choices.slice(start, start + maxVisible);
    for (let i = 0; i < visible.length; i += 1) {
      const absolute = start + i;
      const marker = absolute === selected ? ">" : " ";
      lines.push(`${marker} ${visible[i].label}`);
    }
    if (choices.length > maxVisible) {
      lines.push(`${selected + 1}/${choices.length}`);
    }
    output.write(lines.map(clampLine).join("\n"));
    output.write("\n");
    renderedLines = lines.length;
  };

  return new Promise((resolve) => {
    const finish = (result?: string): void => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(Boolean(previousRaw));
      output.write("\n");
      resolve(result);
    };

    const onKeypress = (str: string, key: readline.Key): void => {
      if (key.ctrl && key.name === "c") {
        finish(undefined);
        return;
      }
      if (key.name === "escape") {
        finish(undefined);
        return;
      }
      if (key.name === "up") {
        if (choices.length > 0) {
          selected = selected === 0 ? choices.length - 1 : selected - 1;
          render();
        }
        return;
      }
      if (key.name === "down") {
        if (choices.length > 0) {
          selected = (selected + 1) % choices.length;
          render();
        }
        return;
      }
      if (key.name === "backspace") {
        if (query.length > 0) {
          query = query.slice(0, -1);
          refreshChoices();
          render();
        }
        return;
      }
      if (key.name === "return") {
        if (choices.length > 0) {
          finish(choices[selected].id);
          return;
        }
        finish(undefined);
        return;
      }
      if (str && !key.ctrl && !key.meta) {
        query += str;
        refreshChoices();
        render();
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

function parsePromptSelection(answer: string, streams: StreamInfo[]): StreamSelection | undefined {
  const cleaned = answer.trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  if (cleaned === "0" || cleaned.toLowerCase() === "main" || cleaned.toLowerCase() === "base") {
    return { kind: "base" };
  }
  if (Number.isInteger(num) && num > 0 && num <= streams.length) {
    return { kind: "stream", id: streams[num - 1].name };
  }
  return { kind: "create", id: cleaned };
}

async function selectStreamTarget(
  config: StreamConfig,
  options: CliOptions
): Promise<StreamSelection | undefined> {
  const status = await readStatus(config.baseRepoPath);
  const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
  const entries = buildDisplayEntries(config.baseRepoPath, streams, status.lastActive);
  const output = pickerOutput(options);

  if (streams.length === 0) {
    const id = await prompt("No streams found. Enter a new stream id: ", output);
    if (!id) return undefined;
    return { kind: "create", id };
  }

  const fuzzySelection = await fuzzyPicker(entries, options);
  if (fuzzySelection) return fuzzySelection;
  if (process.stdin.isTTY && output.isTTY) return undefined;

  logInfo(renderStreamTable(entries));
  const answer = await prompt("Select a stream by number or enter a new id: ", output);
  return parsePromptSelection(answer, streams);
}

async function interactivePicker(configPath: string, options: CliOptions): Promise<void> {
  const config = await resolveConfig(configPath);
  const selection = await selectStreamTarget(config, options);
  if (!selection) return;
  if (selection.kind === "base") {
    await openBaseRepo(config, options);
    return;
  }
  await createOrOpenStream({ id: selection.id, config, cli: options });
}

async function interactivePickerWithResult(
  configPath: string,
  options: CliOptions
): Promise<{ kind: "base" | "stream"; path: string; name: string } | undefined> {
  const config = await resolveConfig(configPath);
  const selection = await selectStreamTarget(config, options);
  if (!selection) return undefined;
  if (selection.kind === "base") {
    await openBaseRepo(config, options);
    return { kind: "base", path: config.baseRepoPath, name: "main" };
  }
  const stream = await createOrOpenStream({ id: selection.id, config, cli: options });
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

type SupportedShell = "bash" | "zsh" | "fish";

function normalizeShell(value: string | undefined): SupportedShell | undefined {
  if (!value) return undefined;
  const base = path.basename(value).toLowerCase();
  if (base.includes("fish") || value.toLowerCase() === "fish") return "fish";
  if (base.includes("zsh") || value.toLowerCase() === "zsh") return "zsh";
  if (base.includes("bash") || value.toLowerCase() === "bash") return "bash";
  return undefined;
}

function detectCurrentShell(): SupportedShell {
  return normalizeShell(process.env.SHELL) ?? "bash";
}

function buildBashCompletionScript(): string {
  return `# stream bash completion
_stream_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local args=()
  local i
  for ((i=1; i<COMP_CWORD; i++)); do
    args+=("\${COMP_WORDS[i]}")
  done
  local suggestions
  suggestions=$(command stream __complete "\${args[@]}" 2>/dev/null)
  COMPREPLY=($(compgen -W "$suggestions" -- "$cur"))
}
complete -F _stream_complete stream`;
}

function buildZshCompletionScript(): string {
  return `#compdef stream
_stream_complete() {
  local -a suggestions
  suggestions=("\${(@f)\$(command stream __complete "\${words[@]:2}" 2>/dev/null)}")
  compadd -a suggestions
}
compdef _stream_complete stream`;
}

function buildFishCompletionScript(): string {
  return `function __stream_complete
    set -l args (commandline -opc)
    set -e args[1]
    command stream __complete $args 2>/dev/null
end
complete -c stream -f -a "(__stream_complete)"`;
}

function buildCompletionScript(shell: SupportedShell): string {
  if (shell === "fish") return buildFishCompletionScript();
  if (shell === "zsh") return buildZshCompletionScript();
  return buildBashCompletionScript();
}

function printCompletionScript(shellArg?: string): void {
  const shell = normalizeShell(shellArg) ?? (shellArg ? undefined : detectCurrentShell());
  if (!shell) {
    throw new Error(`Unsupported shell for completion: ${shellArg}. Use bash, zsh, or fish.`);
  }
  console.log(buildCompletionScript(shell));
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

function renderDeleteStreamTable(streams: StreamInfo[]): string {
  const nameWidth = Math.max(...streams.map((s) => s.name.length), "Name".length);
  const statusWidth = Math.max(...streams.map((s) => s.status.length), "Status".length);
  const header = `#   ${"Name".padEnd(nameWidth)}  ${"Status".padEnd(statusWidth)}  Path`;
  const lines = streams.map((stream, index) => {
    const name = stream.name.padEnd(nameWidth);
    const status = stream.status.padEnd(statusWidth);
    return `${String(index + 1).padEnd(3)} ${name}  ${status}  ${stream.path}`;
  });
  return ["Available streams to delete:", header, ...lines].join("\n");
}

function renderStatus(config: StreamConfig, status: StatusFile): string {
  const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
  const cwd = process.cwd();
  const currentStream = streams.find((stream) => isPathInside(cwd, stream.path));
  const inBase = isPathInside(cwd, config.baseRepoPath);
  const counts = new Map<string, number>();
  for (const stream of streams) {
    counts.set(stream.status, (counts.get(stream.status) ?? 0) + 1);
  }
  const summary = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
  const lines = ["Stream status"];
  lines.push(`Base repo: ${config.baseRepoPath}`);
  lines.push(`Streams: ${streams.length}${summary ? ` (${summary})` : ""}`);
  lines.push(`Last active: ${status.lastActive ?? "none"}`);
  if (currentStream) {
    lines.push("Current location: stream");
    lines.push(`Name: ${currentStream.name}`);
    lines.push(`Path: ${currentStream.path}`);
    lines.push(`Status: ${currentStream.status}`);
    if (currentStream.branch) lines.push(`Branch: ${currentStream.branch}`);
    if (currentStream.dbName) lines.push(`Database: ${currentStream.dbName}`);
  } else if (inBase) {
    lines.push("Current location: base");
    lines.push(`Path: ${config.baseRepoPath}`);
  } else {
    lines.push("Current location: outside managed paths");
    lines.push(`Path: ${cwd}`);
  }
  return lines.join("\n");
}

function completionPositionals(args: string[]): string[] {
  const positional: string[] = [];
  let skipNext = false;
  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (FLAGS_WITH_VALUE.has(arg)) {
      skipNext = true;
      continue;
    }
    if (arg === "-") {
      positional.push(arg);
      continue;
    }
    if (arg.startsWith("-")) continue;
    positional.push(arg);
  }
  return positional;
}

function streamCompletionIds(streams: StreamInfo[], config: StreamConfig): string[] {
  const ids = new Set<string>();
  const prefix = `${config.naming.prefix}-${config.naming.slug}-`;
  for (const stream of streams) {
    ids.add(stream.name);
    if (stream.name.startsWith(prefix)) {
      const maybeId = stream.name.slice(prefix.length);
      if (isNumericStreamId(maybeId)) ids.add(maybeId);
    }
  }
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

async function completionCandidates(args: string[], cwd: string): Promise<string[]> {
  if (args.length > 0 && FLAGS_WITH_VALUE.has(args[args.length - 1])) return [];
  const config = await resolveConfig(cwd);
  const status = await readStatus(config.baseRepoPath);
  const streams = Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
  const streamIds = streamCompletionIds(streams, config);
  const shells: SupportedShell[] = ["bash", "zsh", "fish"];
  const positional = completionPositionals(args);
  const command = positional[0];
  if (!command) {
    return [...KNOWN_FLAGS, ...KNOWN_COMMANDS, "-", "main", "master", ...streamIds];
  }
  if (command === "completion") {
    if (positional.length <= 1) return shells;
    return [];
  }
  if (command === "del" || command === "cd") {
    if (positional.length <= 1) return streamIds;
    return [];
  }
  if (command === "checkout" || command === "co") {
    return [];
  }
  if (
    command === "config" ||
    command === "shell" ||
    command === "init" ||
    command === "list" ||
    command === "ls" ||
    command === "status" ||
    command === "setup" ||
    command === "-" ||
    command === "main" ||
    command === "master"
  ) {
    return [];
  }
  if (command.startsWith(`${config.naming.prefix}-`) || isNumericStreamId(command)) {
    return [];
  }
  return KNOWN_COMMANDS;
}

async function pickStreamToDelete(config: StreamConfig, options: CliOptions): Promise<string | undefined> {
  const streams = await listStreams(config);
  if (streams.length === 0) {
    logInfo("No streams found.");
    return undefined;
  }

  const fuzzySelection = await fuzzyDeletePicker(streams, options);
  if (fuzzySelection) {
    return fuzzySelection;
  }
  const output = pickerOutput(options);
  if (process.stdin.isTTY && output.isTTY) {
    logInfo("Delete cancelled.");
    return undefined;
  }

  logInfo(renderDeleteStreamTable(streams));
  const answer = await prompt(
    "Select a stream by number or enter a stream id to delete: ",
    output
  );
  if (!answer) {
    logInfo("Delete cancelled.");
    return undefined;
  }

  const cleaned = answer.trim();
  const num = Number(cleaned);
  if (Number.isInteger(num) && num > 0 && num <= streams.length) {
    return streams[num - 1].name;
  }
  return cleaned;
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

function ensureCommandOrId(command: string, config: StreamConfig): void {
  if (
    KNOWN_COMMANDS.includes(command) ||
    command === "-" ||
    command === "main" ||
    command === "master" ||
    command.startsWith(`${config.naming.prefix}-`) ||
    isNumericStreamId(command)
  ) {
    return;
  }
  const suggestion = suggestionSuffix(command, [...KNOWN_COMMANDS, "main", "master"]);
  const separator = suggestion ? " " : ". ";
  throw new Error(
    `Unknown command or stream id: ${command}${suggestion}${separator}Use 'stream <number>' or 'stream ${config.naming.prefix}-${config.naming.slug}-<number>'.`
  );
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "__complete") {
    const suggestions = await completionCandidates(rawArgs.slice(1), process.cwd());
    if (suggestions.length > 0) {
      console.log(suggestions.join("\n"));
    }
    return;
  }

  const { positional, options, help } = parseArgs(rawArgs);
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
    const id = rest[0] ?? (await pickStreamToDelete(config, options));
    if (!id) return;
    const confirm = await prompt(
      `Delete stream ${id}? (y/N): `,
      options.emitCd ? process.stderr : process.stdout
    );
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

  if (command === "status") {
    const status = await readStatus(config.baseRepoPath);
    console.log(renderStatus(config, status));
    return;
  }

  if (command === "setup") {
    if (rest.length > 0) {
      throw new Error("stream setup does not accept arguments");
    }
    const info = await setupCurrentStreamEnvironment(config, options);
    if (options.emitCd) printCd(info.path);
    return;
  }

  if (command === "completion") {
    printCompletionScript(rest[0]);
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

  ensureCommandOrId(command, config);
  const info = await createOrOpenStream({ id: command, config, cli: options });
  if (options.emitCd) printCd(info.path);
}

main().catch((err) => {
  logError(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
