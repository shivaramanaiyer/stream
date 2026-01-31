"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setVerbose = setVerbose;
exports.setLogToStderr = setLogToStderr;
exports.logInfo = logInfo;
exports.logWarn = logWarn;
exports.logError = logError;
exports.logDebug = logDebug;
let verbose = false;
let logToStderr = false;
function setVerbose(flag) {
    verbose = flag;
}
function setLogToStderr(flag) {
    logToStderr = flag;
}
function logInfo(message) {
    if (logToStderr) {
        console.error(message);
    }
    else {
        console.log(message);
    }
}
function logWarn(message) {
    console.warn(message);
}
function logError(message) {
    console.error(message);
}
function logDebug(message) {
    if (!verbose)
        return;
    if (logToStderr) {
        console.error(message);
    }
    else {
        console.log(message);
    }
}
