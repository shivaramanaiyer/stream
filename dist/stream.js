"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrOpenStream = createOrOpenStream;
exports.openBaseRepo = openBaseRepo;
exports.openLastStream = openLastStream;
exports.deleteStream = deleteStream;
exports.listStreams = listStreams;
exports.resolveStreamByBranch = resolveStreamByBranch;
exports.validateStreamNameOrThrow = validateStreamNameOrThrow;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const copy_1 = require("./copy");
const editor_1 = require("./editor");
const logger_1 = require("./logger");
const setup_1 = require("./setup");
const status_1 = require("./status");
const git_1 = require("./git");
const strings_1 = require("./utils/strings");
const fs_2 = require("./utils/fs");
function resolveStreamName(id, prefix, slug) {
    if (id.startsWith(`${prefix}-`)) {
        return id;
    }
    const numeric = Number(id);
    if (Number.isNaN(numeric) || numeric <= 0 || !Number.isInteger(numeric)) {
        throw new Error(`Invalid stream id: ${id}`);
    }
    return `${prefix}-${slug}-${numeric}`;
}
function validateStreamName(name, prefix) {
    const escaped = prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const pattern = new RegExp(`^${escaped}-[a-z0-9-]+-\\d+$`);
    if (!pattern.test(name)) {
        throw new Error(`Invalid stream name: ${name}`);
    }
}
async function ensureParentDir(dir) {
    await fs_1.promises.mkdir(dir, { recursive: true });
}
async function createOrOpenStream(options) {
    const { config, id, cli } = options;
    const name = resolveStreamName(id, config.naming.prefix, config.naming.slug);
    validateStreamName(name, config.naming.prefix);
    const streamPath = path_1.default.join(config.streamsRoot, name);
    const exists = await (0, fs_2.pathExists)(streamPath);
    const status = cli.dryRun ? undefined : await (0, status_1.readStatus)(config.baseRepoPath);
    const existing = status?.streams[name];
    if (!exists) {
        (0, logger_1.logInfo)(`Creating stream ${name}...`);
        if (cli.dryRun) {
            (0, logger_1.logInfo)(`[dry-run] Would copy ${config.baseRepoPath} -> ${streamPath}`);
        }
        else {
            await ensureParentDir(config.streamsRoot);
            await (0, copy_1.copyRepo)(config.baseRepoPath, streamPath, {
                excludes: [...config.copyExcludes, ...cli.excludes],
                includes: cli.includes
            });
        }
    }
    else {
        (0, logger_1.logInfo)(`Opening existing stream ${name}...`);
    }
    const color = existing?.color ?? (0, editor_1.pickColor)(name);
    if (!cli.dryRun) {
        await (0, editor_1.applyPeacockColor)(streamPath, color);
    }
    const baseBranch = existing?.branch ?? (cli.dryRun ? undefined : await (0, git_1.getCurrentBranch)(config.baseRepoPath));
    const info = {
        name,
        path: streamPath,
        createdAt: existing?.createdAt ?? (0, strings_1.nowIso)(),
        status: "created",
        dbName: existing?.dbName,
        color,
        editor: cli.editorOverride ?? config.editor.command,
        branch: baseBranch ?? existing?.branch
    };
    if (!cli.dryRun) {
        await (0, status_1.upsertStream)(config.baseRepoPath, info);
    }
    if (cli.dryRun) {
        (0, logger_1.logInfo)(`[dry-run] Would open editor ${info.editor}`);
    }
    else {
        await (0, status_1.updateStreamStatus)(config.baseRepoPath, name, "opening_editor");
        await (0, editor_1.openEditor)(info.editor ?? config.editor.command, config.editor.openArgs, streamPath);
    }
    const shouldRunSetup = !exists &&
        !cli.noSetup &&
        config.setup.enabled &&
        config.setup.steps.length > 0;
    if (!shouldRunSetup) {
        if (exists) {
            (0, logger_1.logInfo)("Setup skipped (stream already exists).");
        }
        else {
            (0, logger_1.logInfo)("Setup steps skipped.");
        }
        if (!cli.dryRun && !exists) {
            await (0, status_1.updateStreamStatus)(config.baseRepoPath, name, "ready");
        }
        return info;
    }
    if (!cli.dryRun) {
        await (0, status_1.updateStreamStatus)(config.baseRepoPath, name, "installing");
    }
    try {
        const { dbName } = cli.dryRun
            ? { dbName: undefined }
            : await (0, setup_1.runSetup)(config.setup.steps, {
                config,
                streamName: name,
                streamPath,
                emitCd: cli.emitCd
            });
        if (!cli.dryRun) {
            const updatedStatus = await (0, status_1.readStatus)(config.baseRepoPath);
            const existingStream = updatedStatus.streams[name];
            if (existingStream) {
                existingStream.dbName = dbName ?? existingStream.dbName;
            }
            await (0, status_1.writeStatus)(config.baseRepoPath, updatedStatus);
            await (0, status_1.updateStreamStatus)(config.baseRepoPath, name, "ready");
        }
    }
    catch (err) {
        (0, logger_1.logWarn)(`Setup failed: ${err.message ?? err}`);
        if (!cli.dryRun) {
            await (0, status_1.updateStreamStatus)(config.baseRepoPath, name, "failed");
        }
        throw err;
    }
    return info;
}
async function openBaseRepo(config, cli) {
    if (cli.dryRun) {
        (0, logger_1.logInfo)(`[dry-run] Would open base repo ${config.baseRepoPath}`);
        return;
    }
    await (0, editor_1.openEditor)(cli.editorOverride ?? config.editor.command, config.editor.openArgs, config.baseRepoPath);
}
async function openLastStream(config, cli) {
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    if (!status.lastActive) {
        throw new Error("No previous stream recorded.");
    }
    return createOrOpenStream({
        id: status.lastActive,
        config,
        cli
    });
}
async function deleteStream(config, cli, id) {
    const name = resolveStreamName(id, config.naming.prefix, config.naming.slug);
    validateStreamName(name, config.naming.prefix);
    const streamPath = path_1.default.join(config.streamsRoot, name);
    const exists = await (0, fs_2.pathExists)(streamPath);
    if (!exists) {
        (0, logger_1.logInfo)(`Stream ${name} not found at ${streamPath}`);
        return;
    }
    if (cli.dryRun) {
        (0, logger_1.logInfo)(`[dry-run] Would remove ${streamPath}`);
        return;
    }
    await fs_1.promises.rm(streamPath, { recursive: true, force: true });
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    delete status.streams[name];
    if (status.lastActive === name)
        delete status.lastActive;
    await (0, status_1.writeStatus)(config.baseRepoPath, status);
}
async function listStreams(config) {
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    return Object.values(status.streams).sort((a, b) => a.name.localeCompare(b.name));
}
async function resolveStreamByBranch(config, branch) {
    const status = await (0, status_1.readStatus)(config.baseRepoPath);
    return Object.values(status.streams).find((s) => s.branch === branch);
}
function validateStreamNameOrThrow(name, prefix = "stream") {
    validateStreamName(name, prefix);
}
