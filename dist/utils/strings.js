"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.sanitizeDbName = sanitizeDbName;
exports.nowIso = nowIso;
exports.stripJsonComments = stripJsonComments;
function slugify(input) {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-") || "stream";
}
function sanitizeDbName(name, maxLength) {
    let sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    sanitized = sanitized.replace(/^_+|_+$/g, "");
    if (!sanitized)
        sanitized = "db";
    if (/^[0-9]/.test(sanitized))
        sanitized = `db_${sanitized}`;
    if (sanitized.length > maxLength) {
        sanitized = sanitized.slice(0, maxLength);
        sanitized = sanitized.replace(/_+$/g, "");
    }
    return sanitized;
}
function nowIso() {
    return new Date().toISOString();
}
function stripJsonComments(raw) {
    return raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
