"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickColor = pickColor;
exports.applyPeacockColor = applyPeacockColor;
exports.openEditor = openEditor;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const constants_1 = require("./constants");
const fs_2 = require("./utils/fs");
const strings_1 = require("./utils/strings");
const exec_1 = require("./utils/exec");
const logger_1 = require("./logger");
function pickColor(seed) {
    if (!seed) {
        const idx = Math.floor(Math.random() * constants_1.COLOR_PALETTE.length);
        return constants_1.COLOR_PALETTE[idx];
    }
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return constants_1.COLOR_PALETTE[hash % constants_1.COLOR_PALETTE.length];
}
async function applyPeacockColor(streamPath, color) {
    const vscodeDir = path_1.default.join(streamPath, ".vscode");
    const settingsPath = path_1.default.join(vscodeDir, "settings.json");
    await (0, fs_2.ensureDir)(vscodeDir);
    let settings = {};
    const raw = await (0, fs_2.readFileIfExists)(settingsPath);
    if (raw) {
        try {
            settings = JSON.parse((0, strings_1.stripJsonComments)(raw));
        }
        catch (err) {
            (0, logger_1.logWarn)(`Warning: could not parse existing ${settingsPath}, overwriting.`);
        }
    }
    settings["peacock.color"] = color;
    const customizations = typeof settings["workbench.colorCustomizations"] === "object" &&
        settings["workbench.colorCustomizations"] !== null
        ? settings["workbench.colorCustomizations"]
        : {};
    customizations["titleBar.activeBackground"] = color;
    customizations["titleBar.inactiveBackground"] = color;
    settings["workbench.colorCustomizations"] = customizations;
    await fs_1.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
async function openEditor(command, args, streamPath) {
    try {
        await (0, exec_1.runCommand)(command, [...args, streamPath], { inheritStdout: true });
    }
    catch (err) {
        (0, logger_1.logWarn)(`Warning: failed to open editor with ${command}.`);
    }
}
