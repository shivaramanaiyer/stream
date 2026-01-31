import path from "path";
import { promises as fs } from "fs";
import { COLOR_PALETTE } from "./constants";
import { ensureDir, readFileIfExists } from "./utils/fs";
import { stripJsonComments } from "./utils/strings";
import { runCommand } from "./utils/exec";
import { logWarn } from "./logger";

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

export async function openEditor(
  command: string,
  args: string[],
  streamPath: string
): Promise<void> {
  try {
    await runCommand(command, [...args, streamPath], { inheritStdout: true });
  } catch (err) {
    logWarn(`Warning: failed to open editor with ${command}.`);
  }
}
