import path from "path";
import type { SetupStep, StreamConfig } from "./types";
import { cloneDatabase } from "./db";
import { logInfo } from "./logger";
import { runCommand, splitCommand } from "./utils/exec";

interface SetupContext {
  config: StreamConfig;
  streamName: string;
  streamPath: string;
  emitCd?: boolean;
}

function resolveCwd(template: string | undefined, streamPath: string): string {
  if (!template) return streamPath;
  if (template.includes("{stream}")) {
    return template.replace("{stream}", streamPath);
  }
  if (path.isAbsolute(template)) return template;
  return path.join(streamPath, template);
}

export async function runSetup(
  steps: SetupStep[],
  ctx: SetupContext
): Promise<{ dbName?: string }> {
  let dbName: string | undefined;
  for (const step of steps) {
    if (step.enabled === false) continue;
    if (step.type === "dbClone") {
      const result = await cloneDatabase(
        ctx.config,
        ctx.streamName,
        ctx.streamPath,
        step.strategy,
        ctx.emitCd
      );
      dbName = result.dbName;
      continue;
    }

    if (step.type === "shell") {
      const cwd = resolveCwd(step.cwd, ctx.streamPath);
      logInfo(`Running ${step.name} setup...`);
      const { cmd, args } = splitCommand(step.command);
      if (!cmd) throw new Error(`Invalid command for step ${step.name}`);
      const result = await runCommand(cmd, args, {
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
