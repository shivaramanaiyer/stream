"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommand = runCommand;
exports.splitCommand = splitCommand;
const child_process_1 = require("child_process");
async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const inheritStdout = options.inheritStdout ?? false;
        const stdoutToStderr = options.stdoutToStderr ?? false;
        const stdio = inheritStdout
            ? ["inherit", stdoutToStderr ? "pipe" : "inherit", stdoutToStderr ? "pipe" : "inherit"]
            : ["inherit", "pipe", "pipe"];
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio
        });
        let stdout = "";
        let stderr = "";
        if (!inheritStdout) {
            if (child.stdout) {
                child.stdout.on("data", (chunk) => {
                    stdout += chunk.toString();
                });
            }
            if (child.stderr) {
                child.stderr.on("data", (chunk) => {
                    stderr += chunk.toString();
                });
            }
        }
        else if (stdoutToStderr) {
            if (child.stdout) {
                child.stdout.on("data", (chunk) => {
                    process.stderr.write(chunk);
                });
            }
            if (child.stderr) {
                child.stderr.on("data", (chunk) => {
                    process.stderr.write(chunk);
                });
            }
        }
        child.on("error", (err) => reject(err));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
}
function splitCommand(command) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";
    for (let i = 0; i < command.length; i += 1) {
        const char = command[i];
        if (inQuotes) {
            if (char === quoteChar) {
                inQuotes = false;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === "\"" || char === "'") {
            inQuotes = true;
            quoteChar = char;
            continue;
        }
        if (char === " ") {
            if (current.length > 0) {
                parts.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (current.length > 0)
        parts.push(current);
    return { cmd: parts[0] ?? "", args: parts.slice(1) };
}
