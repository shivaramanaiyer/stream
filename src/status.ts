import path from "path";
import type { StatusFile, StreamInfo, StreamStatus } from "./types";
import { nowIso } from "./utils/strings";
import { readJsonFile, writeJsonFile } from "./utils/fs";

export function statusFilePath(baseRepoPath: string): string {
  const project = path.basename(baseRepoPath);
  return path.join(path.dirname(baseRepoPath), `.stream-${project}`);
}

export async function readStatus(baseRepoPath: string): Promise<StatusFile> {
  const filePath = statusFilePath(baseRepoPath);
  const existing = await readJsonFile<StatusFile>(filePath);
  if (existing) return existing;
  return {
    project: path.basename(baseRepoPath),
    updatedAt: nowIso(),
    streams: {}
  };
}

export async function writeStatus(baseRepoPath: string, status: StatusFile): Promise<void> {
  status.updatedAt = nowIso();
  await writeJsonFile(statusFilePath(baseRepoPath), status);
}

export async function upsertStream(
  baseRepoPath: string,
  info: StreamInfo
): Promise<void> {
  const status = await readStatus(baseRepoPath);
  status.streams[info.name] = info;
  status.lastActive = info.name;
  await writeStatus(baseRepoPath, status);
}

export async function updateStreamStatus(
  baseRepoPath: string,
  streamName: string,
  statusValue: StreamStatus
): Promise<void> {
  const status = await readStatus(baseRepoPath);
  const existing = status.streams[streamName];
  if (!existing) return;
  existing.status = statusValue;
  status.lastActive = streamName;
  await writeStatus(baseRepoPath, status);
}
