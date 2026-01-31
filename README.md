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
- `stream del <id>`: delete a stream
- `stream checkout <branch>`: open or create a stream for a branch
- `stream list|ls`: list streams
- `stream cd <id>`: create/open and emit a cd marker for shell integration
- `stream shell`: print a shell function that auto-cd's after stream commands
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
- `--cd`: emit a cd marker for shell wrapper
- `--dry-run`: show actions without running
- `--verbose`: verbose logging

Notes:
- `--include`/`--exclude` support glob-like patterns (`*`, `**`, `?`).
- `stream checkout` requires `.git` in the stream; `.git` is copied by default unless excluded.
- `stream checkout` creates streams named like `<prefix>-<slug>-<branch>-<n>` (branch is slugified).

## Configuration

Create `stream.config.json` in the repo root:

```json
{
  "streamsRoot": "..",
  "copyExcludes": ["node_modules"],
  "editor": { "command": "code", "openArgs": ["-n"] },
  "setup": {
    "enabled": true,
    "steps": []
  },
  "db": {
    "type": "postgres",
    "cloneStrategy": "template",
    "maxNameLength": 63,
    "envFile": "backend/.env_development"
  },
  "naming": { "prefix": "stream", "slug": "myrepo" }
}
```

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
