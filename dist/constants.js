"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_PALETTE = exports.STATUS_VERSION = exports.DEFAULT_DB = exports.DEFAULT_EDITOR = exports.DEFAULT_SETUP_STEPS = exports.DEFAULT_EXCLUDES = void 0;
exports.DEFAULT_EXCLUDES = [
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
exports.DEFAULT_SETUP_STEPS = [];
exports.DEFAULT_EDITOR = {
    command: "code",
    openArgs: ["-n"]
};
exports.DEFAULT_DB = {
    type: "postgres",
    cloneStrategy: "template",
    maxNameLength: 63,
    envFile: "backend/.env_development"
};
exports.STATUS_VERSION = 1;
exports.COLOR_PALETTE = [
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
