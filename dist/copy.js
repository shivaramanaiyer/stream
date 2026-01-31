"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.copyRepo = copyRepo;
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const patterns_1 = require("./utils/patterns");
const fs_2 = require("./utils/fs");
async function copyRepo(source, dest, options) {
    const shouldInclude = (0, patterns_1.buildIncludePredicate)(options.includes, options.excludes);
    await (0, fs_2.ensureDir)(path_1.default.dirname(dest));
    await fs_1.promises.cp(source, dest, {
        recursive: true,
        errorOnExist: true,
        filter: (src) => {
            if (src === source)
                return true;
            const rel = path_1.default.relative(source, src);
            if (!rel)
                return true;
            return shouldInclude(rel);
        }
    });
}
