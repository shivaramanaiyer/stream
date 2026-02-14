import path from "path";
import { promises as fs } from "fs";
import { COLOR_PALETTE } from "./constants";
import { ensureDir, readFileIfExists } from "./utils/fs";
import { stripJsonComments } from "./utils/strings";
import { commandExists, runCommand, splitCommand } from "./utils/exec";
import { logWarn } from "./logger";

const AUTO_EDITOR_CANDIDATES = ["cursor", "code"];

interface NiriWorkspace {
  id: number;
  idx: number;
  name?: string;
  output?: string;
  is_focused: boolean;
}

interface NiriWindow {
  id: number;
  workspace_id: number;
}

export function pickColor(seed?: string): string {
  if (!seed) {
    const idx = Math.floor(Math.random() * COLOR_PALETTE.length);
    return COLOR_PALETTE[idx];
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLOR_PALETTE[hash % COLOR_PALETTE.length];
}

export async function applyPeacockColor(
  streamPath: string,
  color: string
): Promise<void> {
  const vscodeDir = path.join(streamPath, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");
  await ensureDir(vscodeDir);

  let settings: Record<string, unknown> = {};
  const raw = await readFileIfExists(settingsPath);
  if (raw) {
    try {
      settings = JSON.parse(stripJsonComments(raw));
    } catch (err) {
      logWarn(`Warning: could not parse existing ${settingsPath}, overwriting.`);
    }
  }

  settings["peacock.color"] = color;

  const customizations =
    typeof settings["workbench.colorCustomizations"] === "object" &&
    settings["workbench.colorCustomizations"] !== null
      ? (settings["workbench.colorCustomizations"] as Record<string, unknown>)
      : {};

  customizations["titleBar.activeBackground"] = color;
  customizations["titleBar.inactiveBackground"] = color;
  settings["workbench.colorCustomizations"] = customizations;

  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

async function pickFirstInstalledCommand(commands: string[]): Promise<string | undefined> {
  for (const command of commands) {
    const { cmd } = splitCommand(command);
    if (!cmd) continue;
    if (await commandExists(cmd)) {
      return command;
    }
  }
  return undefined;
}

export async function resolveEditorCommand(
  configuredCommand: string,
  override?: string
): Promise<string> {
  const explicit = override?.trim();
  const preferred = explicit && explicit.length > 0
    ? explicit
    : configuredCommand.trim();
  if (!preferred) {
    const detected = await pickFirstInstalledCommand(AUTO_EDITOR_CANDIDATES);
    return detected ?? "code";
  }

  if (preferred.toLowerCase() === "auto") {
    const detected = await pickFirstInstalledCommand(AUTO_EDITOR_CANDIDATES);
    return detected ?? "code";
  }

  const { cmd } = splitCommand(preferred);
  if (!cmd) return preferred;
  if (await commandExists(cmd)) {
    return preferred;
  }

  if (cmd === "code" || cmd === "cursor") {
    const fallback = await pickFirstInstalledCommand(
      AUTO_EDITOR_CANDIDATES.filter((candidate) => candidate !== cmd)
    );
    if (fallback) {
      logWarn(`Warning: editor '${cmd}' is unavailable, falling back to '${fallback}'.`);
      return fallback;
    }
  }

  return preferred;
}

async function getNiriWorkspaces(): Promise<NiriWorkspace[] | undefined> {
  const result = await runCommand("niri", ["msg", "-j", "workspaces"]);
  if (result.code !== 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .filter(
        (item) => typeof item.idx === "number"
      )
      .map((item) => ({
        id: typeof item.id === "number" ? item.id : -1,
        idx: item.idx as number,
        name: typeof item.name === "string" ? item.name : undefined,
        output: typeof item.output === "string" ? item.output : undefined,
        is_focused: typeof item.is_focused === "boolean"
          ? item.is_focused
          : Boolean(item.is_active)
      }))
      .filter((item) => item.id >= 0);
  } catch {
    return undefined;
  }
}

async function getNiriWindows(): Promise<NiriWindow[] | undefined> {
  const result = await runCommand("niri", ["msg", "-j", "windows"]);
  if (result.code !== 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .filter(
        (item) =>
          typeof item.id === "number" &&
          typeof item.workspace_id === "number"
      )
      .map((item) => ({
        id: item.id as number,
        workspace_id: item.workspace_id as number
      }));
  } catch {
    return undefined;
  }
}

function nextNiriWorkspaceIndex(workspaces: NiriWorkspace[]): number {
  const focused = workspaces.find((workspace) => workspace.is_focused);
  const output = focused?.output;
  const relevant = output
    ? workspaces.filter((workspace) => workspace.output === output)
    : workspaces;
  const maxIndex = relevant.reduce((max, workspace) => Math.max(max, workspace.idx), 0);
  return maxIndex + 1;
}

function focusedNiriWorkspaceIndex(workspaces: NiriWorkspace[]): number | undefined {
  return workspaces.find((workspace) => workspace.is_focused)?.idx;
}

async function renameNiriWorkspace(name: string, preferredIndex?: number): Promise<void> {
  const renameFocused = await runCommand("niri", [
    "msg",
    "action",
    "set-workspace-name",
    name
  ]);
  if (renameFocused.code === 0) {
    return;
  }

  const targetIndex = preferredIndex ?? focusedNiriWorkspaceIndex((await getNiriWorkspaces()) ?? []);
  if (!targetIndex) {
    logWarn(`Warning: failed to name niri workspace '${name}'.`);
    return;
  }

  const renameByIndex = await runCommand("niri", [
    "msg",
    "action",
    "set-workspace-name",
    "--workspace",
    String(targetIndex),
    name
  ]);
  if (renameByIndex.code !== 0) {
    logWarn(`Warning: failed to name niri workspace '${name}'.`);
  }
}

export async function openNewNiriWorkspace(name?: string): Promise<void> {
  if (!(await commandExists("niri"))) {
    return;
  }

  try {
    const workspaces = await getNiriWorkspaces();
    const nextIndex =
      workspaces && workspaces.length > 0
        ? nextNiriWorkspaceIndex(workspaces)
        : undefined;

    const focus = nextIndex
      ? await runCommand("niri", ["msg", "action", "focus-workspace", String(nextIndex)])
      : await runCommand("niri", ["msg", "action", "focus-workspace-down"]);
    if (focus.code !== 0) {
      logWarn("Warning: failed to focus a new niri workspace.");
      return;
    }

    if (name) {
      await renameNiriWorkspace(name, nextIndex);
    }
  } catch {
    logWarn("Warning: failed to open niri workspace.");
  }
}

export async function closeNiriWorkspace(name: string): Promise<void> {
  if (!name || !(await commandExists("niri"))) {
    return;
  }

  try {
    const workspaces = await getNiriWorkspaces();
    if (!workspaces || workspaces.length === 0) {
      return;
    }

    const target = workspaces.find((workspace) => workspace.name === name);
    if (!target) {
      return;
    }

    const focusedBefore = workspaces.find((workspace) => workspace.is_focused);
    const targetWindows = ((await getNiriWindows()) ?? [])
      .filter((window) => window.workspace_id === target.id)
      .map((window) => window.id);

    const focusTarget = await runCommand("niri", ["msg", "action", "focus-workspace", name]);
    if (focusTarget.code !== 0) {
      logWarn(`Warning: failed to focus niri workspace '${name}' for closing.`);
      return;
    }

    for (const windowId of targetWindows) {
      const focusWindow = await runCommand("niri", [
        "msg",
        "action",
        "focus-window",
        "--id",
        String(windowId)
      ]);
      if (focusWindow.code !== 0) {
        continue;
      }

      const close = await runCommand("niri", ["msg", "action", "close-window"]);
      if (close.code !== 0) {
        logWarn(`Warning: failed to close a window in niri workspace '${name}'.`);
      }
    }

    const unnameFocused = await runCommand("niri", [
      "msg",
      "action",
      "unset-workspace-name"
    ]);
    if (unnameFocused.code !== 0) {
      const unnameByIndex = await runCommand("niri", [
        "msg",
        "action",
        "unset-workspace-name",
        String(target.idx)
      ]);
      if (unnameByIndex.code !== 0) {
        logWarn(`Warning: failed to unset niri workspace name '${name}'.`);
      }
    }

    if (focusedBefore && focusedBefore.id !== target.id) {
      const reference = focusedBefore.name ?? String(focusedBefore.idx);
      await runCommand("niri", ["msg", "action", "focus-workspace", reference]);
    } else {
      const fallbackFocusActions = [
        "focus-workspace-previous",
        "focus-workspace-down",
        "focus-workspace-up"
      ];
      for (const action of fallbackFocusActions) {
        const result = await runCommand("niri", ["msg", "action", action]);
        if (result.code === 0) {
          break;
        }
      }
    }
  } catch {
    logWarn(`Warning: failed to close niri workspace '${name}'.`);
  }
}

export async function openEditor(
  command: string,
  args: string[],
  streamPath: string
): Promise<void> {
  const { cmd, args: commandArgs } = splitCommand(command);
  if (!cmd) {
    logWarn("Warning: editor command is empty.");
    return;
  }
  try {
    await runCommand(cmd, [...commandArgs, ...args, streamPath], { inheritStdout: true });
  } catch (err) {
    logWarn(`Warning: failed to open editor with ${cmd}.`);
  }
}
