# Stream CLI

Git worktrees alternative inspired by [lane](https://github.com/benhylak/lane).

Stream creates full project copies ("streams") for parallel work, with monorepo and db cloning setup and support.

## Quick start

```bash
npm install
npm install -g .
stream init
# follow the printed "source ..." command to activate
stream 1
```

Global install uses the `prepare` script to build `dist/` automatically.

`stream init` installs shell integration into `~/.bashrc`, `~/.zshrc`, or fish config and prints the `source` command to activate it.

## Commands

- `stream <id>`: create or open a stream by number (e.g. `stream 1`)
- `stream`: interactive picker
- `stream -`: open previous stream
- `stream main|master`: open base repo
- `stream del [id]`: delete a stream (prompts when omitted)
- `stream checkout <branch>`: open or create a stream for a branch; use `-b` to create a new branch without prompting
- `stream list|ls`: list streams
- `stream status`: show current stream/base status
- `stream setup`: in current stream (or base repo), rename focused niri workspace and open Cursor
- `stream cd <id>`: create/open and emit a cd marker for shell integration
- `stream shell`: print a shell function that auto-cd's after stream commands
- `stream completion [bash|zsh|fish]`: print shell completion script
- `stream init`: install shell integration for auto-cd
- `stream config`: print resolved config

Examples:

```bash
stream init
stream 1
```

## Options

- `--include <path>`: include path(s) when copying (repeatable)
- `--exclude <path>`: exclude path(s) when copying (repeatable)
- `--no-setup` / `--no-install`: skip setup steps
- `--editor <command>`: override editor command
- `--name <name>`: override the stream folder name (`checkout` only)
- `--cd`: emit a cd marker for shell wrapper
- `--dry-run`: show actions without running
- `--force`: bypass safety checks for destructive actions (e.g. delete with local changes)
- `--verbose`: verbose logging

Notes:
- `stream` interactive picker supports fuzzy filtering and arrow-key selection.
- `--include`/`--exclude` support glob-like patterns (`*`, `**`, `?`).
- `stream checkout` requires `.git` in the stream; `.git` is copied by default unless excluded.
- `stream checkout` auto-names streams like `<prefix>-<slug>-<branch>-<n>` (branch is slugified); use `--name` to override.
- `stream checkout <branch> -b` creates the branch from `defaultBranch` without prompting, like `git checkout -b`.
- If `-b` is omitted and the branch doesn't exist, you'll be prompted whether to create it.

## Configuration

Create `stream.config.json` in the repo root:

```json
{
  "streamsRoot": "..",
  "copyExcludes": ["node_modules"],
  "editor": { "command": "auto", "openArgs": ["-n"] },
  "setup": {
    "enabled": true,
    "steps": []
  },
  "db": {
    "type": "postgres",
    "cloneStrategy": "template",
    "maxNameLength": 50,
    "envFile": "backend/.env_development"
  },
  "naming": { "prefix": "stream", "slug": "myrepo" },
  "defaultBranch": "main"
}
```

`defaultBranch` controls which branch new branches are cut from when using `stream checkout -b` (defaults to `"main"`).

`db.maxNameLength` caps the generated database name (defaults to `50`). Postgres truncates
identifiers at 63 characters, and other tools append their own suffixes to the name
(`_template`, `_test`, pytest-xdist's `_gw0`, numeric copies), so the value is always clamped
to `63 - 13 = 50` to leave room for them. When `<database>__<stream>` is longer than the cap,
both halves are truncated and a short hash of the full name is appended so streams on
similarly-named branches still get distinct databases.

Editor notes:
- `editor.command: "auto"` picks `cursor` first, then `code`.
- If `niri` is available, creating a new stream opens a new niri workspace, names it after the stream without the naming prefix (for example `myrepo-1` instead of `stream-myrepo-1`), and then launches the editor.
- `stream del [id]` attempts to close the matching named niri workspace before deleting the stream files.

To enable setup steps, add shell or dbClone steps. Example:

```json
{
  "type": "shell",
  "name": "backend",
  "command": "uv venv backend/.venv && uv pip install -r backend/requirements.txt",
  "cwd": "{stream}"
}
```

When using `dbClone`, `db.envFile` controls which env file is copied into the stream
(if missing) and updated with the new `POSTGRES_DATABASE` value.
Only `db.type: "postgres"` is supported right now.
