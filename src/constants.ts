import type { SetupStep } from "./types";

export const DEFAULT_EXCLUDES = [
  "node_modules",
  ".venv",
  "dist",
  "tmp",
  ".pytest_cache",
  "__pycache__",
  ".mypy_cache",
  ".ruff_cache",
  ".DS_Store"
];

export const DEFAULT_SETUP_STEPS: SetupStep[] = [];

export const DEFAULT_EDITOR = {
  command: "auto",
  openArgs: ["-n"]
};

export const DEFAULT_DB = {
  type: "postgres",
  cloneStrategy: "template",
  maxNameLength: 63,
  envFile: "backend/.env_development"
} as const;

export const STATUS_VERSION = 1;

export const COLOR_PALETTE = [
  "#FF6B6B",
  "#FFD93D",
  "#6BCB77",
  "#4D96FF",
  "#B983FF",
  "#FF8E72",
  "#00C2A8",
  "#F9A826",
  "#FF5DA2",
  "#2EC4B6",
  "#E36414",
  "#3D5A80"
];
