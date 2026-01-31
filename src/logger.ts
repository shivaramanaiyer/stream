let verbose = false;
let logToStderr = false;

export function setVerbose(flag: boolean): void {
  verbose = flag;
}

export function setLogToStderr(flag: boolean): void {
  logToStderr = flag;
}

export function logInfo(message: string): void {
  if (logToStderr) {
    console.error(message);
  } else {
    console.log(message);
  }
}

export function logWarn(message: string): void {
  console.warn(message);
}

export function logError(message: string): void {
  console.error(message);
}

export function logDebug(message: string): void {
  if (!verbose) return;
  if (logToStderr) {
    console.error(message);
  } else {
    console.log(message);
  }
}
