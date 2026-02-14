import { spawn } from "child_process";
import path from "path";
import { constants as fsConstants, promises as fs } from "fs";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    inheritStdout?: boolean;
    stdoutToStderr?: boolean;
  } = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const inheritStdout = options.inheritStdout ?? false;
    const stdoutToStderr = options.stdoutToStderr ?? false;
    const stdio: any = inheritStdout
      ? ["inherit", stdoutToStderr ? "pipe" : "inherit", stdoutToStderr ? "pipe" : "inherit"]
      : ["inherit", "pipe", "pipe"];
    const child = spawn(command, args, {
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
    } else if (stdoutToStderr) {
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

export function splitCommand(command: string): { cmd: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
      } else {
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

  if (current.length > 0) parts.push(current);

  return { cmd: parts[0] ?? "", args: parts.slice(1) };
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function windowsCandidateNames(command: string): string[] {
  const pathext = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((ext) => ext.trim())
    .filter((ext) => ext.length > 0);
  if (path.extname(command).length > 0) {
    return [command];
  }
  return [command, ...pathext.map((ext) => `${command}${ext}`)];
}

export async function commandExists(command: string): Promise<boolean> {
  if (!command.trim()) return false;
  if (hasPathSeparator(command)) {
    const resolved = path.isAbsolute(command) ? command : path.resolve(command);
    return isExecutable(resolved);
  }

  const pathValue = process.env.PATH ?? "";
  const dirs = pathValue.split(path.delimiter).filter((dir) => dir.length > 0);
  const commandNames = process.platform === "win32"
    ? windowsCandidateNames(command)
    : [command];

  for (const dir of dirs) {
    for (const name of commandNames) {
      if (await isExecutable(path.join(dir, name))) {
        return true;
      }
    }
  }
  return false;
}
