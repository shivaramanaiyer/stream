const fs = require("fs");
const path = require("path");

const cliPath = path.join(__dirname, "..", "dist", "cli.js");

try {
  fs.chmodSync(cliPath, 0o755);
} catch (err) {
  const message =
    err && typeof err === "object" && "message" in err
      ? err.message
      : "unknown error";
  console.error(`Failed to mark ${cliPath} as executable: ${message}`);
  process.exitCode = 1;
}
