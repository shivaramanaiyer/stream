import path from "path";
import { promises as fs } from "fs";
import type { CreateStreamOptions, StreamInfo, StreamStatus } from "./types";
import { copyRepo } from "./copy";
import {
  pickColor,
  applyPeacockColor,
  openEditor,
  closeNiriWorkspace,
  openNewNiriWorkspace,
  resolveEditorCommand
} from "./editor";
import { logInfo, logWarn } from "./logger";
import { runSetup } from "./setup";
import { upsertStream, updateStreamStatus, readStatus, writeStatus } from "./status";
import { getCurrentBranch, listWorkingTreeChanges } from "./git";
import { nowIso } from "./utils/strings";
import { pathExists } from "./utils/fs";

function resolveStreamName(id: string, prefix: string, slug: string): string {
  if (id.startsWith(`${prefix}-`)) {
    return id;
  }
  const numeric = Number(id);
  if (Number.isNaN(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
    throw new Error(`Invalid stream id: ${id}`);
  }
  return `${prefix}-${slug}-${numeric}`;
}

function validateStreamName(name: string, prefix: string): void {
  const escaped = prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  const pattern = new RegExp(`^${escaped}-[a-z0-9-]+-\\d+$`);
  if (!pattern.test(name)) {
    throw new Error(`Invalid stream name: ${name}`);
  }
}

async function ensureParentDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function createOrOpenStream(
  options: CreateStreamOptions
): Promise<StreamInfo> {
  const { config, id, cli } = options;
  const editorCommand = await resolveEditorCommand(config.editor.command, cli.editorOverride);
  const name = resolveStreamName(id, config.naming.prefix, config.naming.slug);
  validateStreamName(name, config.naming.prefix);

  const streamPath = path.join(config.streamsRoot, name);
  const exists = await pathExists(streamPath);
  const status = cli.dryRun ? undefined : await readStatus(config.baseRepoPath);
  const existing = status?.streams[name];

  if (!exists) {
    logInfo(`Creating stream ${name}...`);
    if (cli.dryRun) {
      logInfo(`[dry-run] Would copy ${config.baseRepoPath} -> ${streamPath}`);
    } else {
      await ensureParentDir(config.streamsRoot);
      await copyRepo(config.baseRepoPath, streamPath, {
        excludes: [...config.copyExcludes, ...cli.excludes],
        includes: cli.includes
      });
    }
  } else {
    logInfo(`Opening existing stream ${name}...`);
  }

  const color = existing?.color ?? pickColor(name);
  if (!cli.dryRun) {
    await applyPeacockColor(streamPath, color);
  }

  const baseBranch = existing?.branch ?? (cli.dryRun ? undefined : await getCurrentBranch(config.baseRepoPath));
  const info: StreamInfo = {
    name,
    path: streamPath,
    createdAt: existing?.createdAt ?? nowIso(),
    status: "created",
    dbName: existing?.dbName,
    color,
    editor: editorCommand,
    branch: baseBranch ?? existing?.branch
  };

  if (!cli.dryRun) {
    await upsertStream(config.baseRepoPath, info);
  }

  if (cli.dryRun) {
    if (!exists) {
      logInfo("[dry-run] Would open a new niri workspace (if available)");
    }
    logInfo(`[dry-run] Would open editor ${info.editor}`);
  } else {
    await updateStreamStatus(config.baseRepoPath, name, "opening_editor");
    if (!exists) {
      await openNewNiriWorkspace(name);
    }
    await openEditor(editorCommand, config.editor.openArgs, streamPath);
  }

  const shouldRunSetup =
    !exists &&
    !cli.noSetup &&
    config.setup.enabled &&
    config.setup.steps.length > 0;

  if (!shouldRunSetup) {
    if (exists) {
      logInfo("Setup skipped (stream already exists).");
    } else {
      logInfo("Setup steps skipped.");
    }
    if (!cli.dryRun && !exists) {
      await updateStreamStatus(config.baseRepoPath, name, "ready");
    }
    return info;
  }

  if (!cli.dryRun) {
    await updateStreamStatus(config.baseRepoPath, name, "installing");
  }

  try {
    const { dbName } = cli.dryRun
      ? { dbName: undefined }
      : await runSetup(config.setup.steps, {
          config,
          streamName: name,
          streamPath,
          emitCd: cli.emitCd
        });

    if (!cli.dryRun) {
      const updatedStatus = await readStatus(config.baseRepoPath);
      const existingStream = updatedStatus.streams[name];
      if (existingStream) {
        existingStream.dbName = dbName ?? existingStream.dbName;
      }
      await writeStatus(config.baseRepoPath, updatedStatus);
      await updateStreamStatus(config.baseRepoPath, name, "ready");
    }
  } catch (err: any) {
    logWarn(`Setup failed: ${err.message ?? err}`);
    if (!cli.dryRun) {
      await updateStreamStatus(config.baseRepoPath, name, "failed");
    }
    throw err;
  }

  return info;
}

export async function openBaseRepo(config: CreateStreamOptions["config"], cli: CreateStreamOptions["cli"]): Promise<void> {
  const editorCommand = await resolveEditorCommand(config.editor.command, cli.editorOverride);
  if (cli.dryRun) {
    logInfo(`[dry-run] Would open base repo ${config.baseRepoPath} with ${editorCommand}`);
    return;
  }
  await openEditor(editorCommand, config.editor.openArgs, config.baseRepoPath);
}

export async function openLastStream(config: CreateStreamOptions["config"], cli: CreateStreamOptions["cli"]): Promise<StreamInfo> {
  const status = await readStatus(config.baseRepoPath);
  if (!status.lastActive) {
    throw new Error("No previous stream recorded.");
  }
  return createOrOpenStream({
    id: status.lastActive,
    config,
    cli
  });
}

export async function deleteStream(
  config: CreateStreamOptions["config"],
  cli: CreateStreamOptions["cli"],
  id: string
): Promise<void> {
  const name = resolveStreamName(id, config.naming.prefix, config.naming.slug);
  validateStreamName(name, config.naming.prefix);
  const streamPath = path.join(config.streamsRoot, name);
  const exists = await pathExists(streamPath);
  if (!exists) {
    logInfo(`Stream ${name} not found at ${streamPath}`);
    return;
  }
  if (!cli.force) {
    const changes = await listWorkingTreeChanges(streamPath);
    if (changes && changes.length > 0) {
      const preview = changes.slice(0, 5).map((line) => `  ${line}`).join("\n");
      const suffix =
        changes.length > 5
          ? `\n  ...and ${changes.length - 5} more change(s).`
          : "";
      throw new Error(
        `Refusing to delete ${name}: uncommitted or untracked changes detected.\n${preview}${suffix}\nRe-run with --force to delete anyway.`
      );
    }
  }
  if (cli.dryRun) {
    logInfo(`[dry-run] Would remove ${streamPath}`);
    logInfo(`[dry-run] Would close niri workspace '${name}' (if available)`);
    return;
  }
  await closeNiriWorkspace(name);
  await fs.rm(streamPath, { recursive: true, force: true });
  const status = await readStatus(config.baseRepoPath);
  delete status.streams[name];
  if (status.lastActive === name) delete status.lastActive;
  await writeStatus(config.baseRepoPath, status);
}

export async function listStreams(config: CreateStreamOptions["config"]): Promise<StreamInfo[]> {
  const status = await readStatus(config.baseRepoPath);
  return Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveStreamByBranch(
  config: CreateStreamOptions["config"],
  branch: string
): Promise<StreamInfo | undefined> {
  const status = await readStatus(config.baseRepoPath);
  return Object.values(status.streams).find((s) => s.branch === branch);
}

export function validateStreamNameOrThrow(name: string, prefix = "stream"): void {
  validateStreamName(name, prefix);
}

export type { StreamStatus };
