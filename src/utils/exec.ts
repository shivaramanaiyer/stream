import { spawn } from "child_process";

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
