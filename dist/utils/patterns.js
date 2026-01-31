"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMatcher = createMatcher;
exports.buildIncludePredicate = buildIncludePredicate;
const path_1 = __importDefault(require("path"));
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function patternToRegExp(pattern) {
    const normalized = pattern.split(path_1.default.sep).join("/");
    let regex = "";
    let i = 0;
    while (i < normalized.length) {
        const char = normalized[i];
        if (char === "*") {
            const next = normalized[i + 1];
            if (next === "*") {
                regex += ".*";
                i += 2;
            }
            else {
                regex += "[^/]*";
                i += 1;
            }
        }
        else if (char === "?") {
            regex += ".";
            i += 1;
        }
        else {
            regex += escapeRegExp(char);
            i += 1;
        }
    }
    return new RegExp(`^${regex}$`);
}
function matchPattern(relPath, pattern) {
    const normalized = relPath.split(path_1.default.sep).join("/");
    if (pattern.includes("/") || pattern.includes(path_1.default.sep)) {
        return patternToRegExp(pattern).test(normalized);
    }
    const segments = normalized.split("/");
    const segmentRegex = patternToRegExp(pattern);
    return segments.some((seg) => segmentRegex.test(seg));
}
function createMatcher(patterns) {
    const cleaned = patterns
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    if (cleaned.length === 0) {
        return () => false;
    }
    return (relPath) => cleaned.some((pattern) => matchPattern(relPath, pattern));
}
function buildIncludePredicate(includes, excludes) {
    const includeMatch = createMatcher(includes);
    const excludeMatch = createMatcher(excludes);
    const includePrefixes = includes
        .map((p) => p.split(path_1.default.sep).join("/"))
        .map((p) => {
        const wildcardIndex = p.search(/[\*\?]/);
        return wildcardIndex === -1 ? p : p.slice(0, wildcardIndex);
    })
        .filter((p) => p.length > 0);
    return (relPath) => {
        const normalized = relPath.split(path_1.default.sep).join("/");
        if (includeMatch(normalized))
            return true;
        if (excludeMatch(normalized))
            return false;
        if (includes.length > 0) {
            return includePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
        }
        return true;
    };
}
