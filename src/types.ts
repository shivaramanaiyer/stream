export type CloneStrategy = "template" | "dump";

export type StreamStatus =
  | "created"
  | "opening_editor"
  | "installing"
  | "ready"
  | "failed";

export interface StreamInfo {
  name: string;
  path: string;
  createdAt: string;
  status: StreamStatus;
  dbName?: string;
  editor?: string;
  color?: string;
  branch?: string;
}

export interface StatusFile {
  project: string;
  updatedAt: string;
  lastActive?: string;
  streams: Record<string, StreamInfo>;
}

export interface EditorConfig {
  command: string;
  openArgs: string[];
}

export interface DbConfig {
  type: "postgres";
  cloneStrategy: CloneStrategy;
  maxNameLength: number;
  envFile: string;
}

export type SetupStep = DbCloneStep | ShellStep;

export interface DbCloneStep {
  type: "dbClone";
  enabled?: boolean;
  strategy?: CloneStrategy;
}

export interface ShellStep {
  type: "shell";
  name: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface SetupConfig {
  enabled: boolean;
  steps: SetupStep[];
}

export interface NamingConfig {
  prefix: string;
  slug: string;
}

export interface StreamConfig {
  baseRepoPath: string;
  streamsRoot: string;
  copyExcludes: string[];
  editor: EditorConfig;
  setup: SetupConfig;
  db: DbConfig;
  naming: NamingConfig;
}

export interface CliOptions {
  noSetup: boolean;
  includes: string[];
  excludes: string[];
  editorOverride?: string;
  dryRun: boolean;
  verbose: boolean;
  force: boolean;
  emitCd?: boolean;
}

export interface CreateStreamOptions {
  id: string;
  config: StreamConfig;
  cli: CliOptions;
}

export interface DbEnv {
  POSTGRES_DATABASE: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: string;
}
