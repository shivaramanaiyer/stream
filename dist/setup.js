"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSetup = runSetup;
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
const logger_1 = require("./logger");
const exec_1 = require("./utils/exec");
function resolveCwd(template, streamPath) {
    if (!template)
        return streamPath;
    if (template.includes("{stream}")) {
        return template.replace("{stream}", streamPath);
    }
    if (path_1.default.isAbsolute(template))
        return template;
    return path_1.default.join(streamPath, template);
}
async function runSetup(steps, ctx) {
    let dbName;
    for (const step of steps) {
        if (step.enabled === false)
            continue;
        if (step.type === "dbClone") {
            const result = await (0, db_1.cloneDatabase)(ctx.config, ctx.streamName, ctx.streamPath, step.strategy, ctx.emitCd);
            dbName = result.dbName;
            continue;
        }
        if (step.type === "shell") {
            const cwd = resolveCwd(step.cwd, ctx.streamPath);
            (0, logger_1.logInfo)(`Running ${step.name} setup...`);
            const { cmd, args } = (0, exec_1.splitCommand)(step.command);
            if (!cmd)
                throw new Error(`Invalid command for step ${step.name}`);
            const result = await (0, exec_1.runCommand)(cmd, args, {
                cwd,
                env: step.env,
                inheritStdout: true,
                stdoutToStderr: ctx.emitCd
            });
            if (result.code !== 0) {
                throw new Error(`Step ${step.name} failed with code ${result.code}`);
            }
        }
    }
    return { dbName };
}
