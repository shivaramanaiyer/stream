# Stream CLI PRD

## Summary
Stream is a CLI tool that creates full project copies (“streams”) for parallel work. It supports configurable setup steps (including optional DB cloning and install commands), opens a dedicated VS Code/Cursor window with a Peacock color, and tracks stream status in a per-project `.stream-<project>` file.

## Goals
- One-command creation of a new Dots stream with isolated code, dependencies, and database.
- Works on macOS, Linux, and WSL.
- Fast, predictable setup with sensible defaults and clear progress/status.
- Configurable for future non-Dots repos and custom workflows.

## Non-Goals
- Replacing git or implementing git-level branching/merging.
- Managing remote database snapshots or cloud infra.
- Installing language runtimes (Node/Python) beyond using existing system tools.

## Primary Users
- Developers who need multiple isolated work lanes without worktree friction, especially on Dots.

## Key Requirements
### Naming & Location
- Stream name format: `stream-<slug>-<number>` (must end in a number; example: `stream-payments-1`).
- New stream directory lives next to the original repo (sibling directory).
- Reject invalid names with a clear error message.
- If a full name is provided (already starts with `stream-`), it is used as-is but still validated.

### Copy Behavior
- Copy the entire repo to a new sibling directory.
- Default excludes (configurable): `.git`, `node_modules`, `.venv`, `dist`, `tmp`, `.pytest_cache`, `__pycache__`, `.mypy_cache`, `.ruff_cache`, `.DS_Store`.
- Provide a `--include` and `--exclude` override mechanism.
- Supports glob-like patterns (`*`, `**`, `?`) for includes/excludes.

### Editor Integration
- Launch a new VS Code or Cursor window for the new stream.
- Use Peacock for window color via `.vscode/settings.json`:
  - Set `peacock.color` and optionally `workbench.colorCustomizations`.
- Random color is acceptable; store the chosen color in the stream settings so it stays stable.
- Default editor command is `code`, with configurable args (default `-n`).

### Dependency Setup
- Default order: copy → open editor → run setup steps.
- Setup steps are configurable and can include DB copy, backend install, and frontend install.
- Backend/frontend steps are not enabled by default; they must be configured as shell steps.
- Provide `--no-install` (or `--no-setup`) to skip setup steps.

### Database Cloning
- Read DB settings from configured env file (default: `backend/.env_development`).
- Create a new DB with the same data, named from the lane name.
  - Example scheme: `${POSTGRES_DATABASE}__${lane}` (sanitized; <= 63 chars).
- Default clone strategy:
  1) Try `CREATE DATABASE new WITH TEMPLATE old`.
  2) If template fails, fall back to `pg_dump | pg_restore`.
- Update the configured env file in the cloned repo with the new DB name.
- Allow a config option to choose clone strategy.
- Exposed as a setup step so it can be reordered or disabled.

### Status Tracking
- Write a per-project file named `.stream-<project>` in the parent directory of the base repo.
  - `<project>` is the base repo folder name (first folder name).
- Track at minimum: name, path, db name, createdAt, status, editor, color.
- Update status transitions: `created` → `opening_editor` → `installing` → `ready` (or `failed`).
- Track `updatedAt` and `lastActive`; optionally store `branch` when available.

## CLI Surface (Current)
- `stream <id>`: create or switch to stream `<id>` (e.g., `stream 1`).
- `stream`: interactive picker (list streams + actions).
- `stream -`: switch to previous stream.
- `stream main` / `stream master`: return to the base repo.
- `stream del <id>`: delete stream `<id>`.
- `stream checkout <branch>`: find stream by branch; if not found, create stream and checkout branch.
- `stream config`: print resolved config for debugging.
- `stream list|ls`: list streams.
- `stream cd <id>`: create/open stream and emit a `cd` command for `eval`.
- `stream shell`: print a shell function that auto-cd’s after `stream`.
- Options: `--include`, `--exclude`, `--no-setup`/`--no-install`, `--editor`, `--dry-run`, `--verbose`, `--cd`.

## Configuration
- Repo-wide config file: `stream.config.json` (primary source of truth).
- Configurable fields:
  - baseRepoPath (optional; defaults to config location or inferred from status file)
  - streamsRoot (default: parent of base repo)
  - copyExcludes
  - editor command (`code` or `cursor`)
  - editor args (`openArgs`)
  - setup steps (including DB copy and install commands)
  - setup enabled flag
  - db clone strategy
  - db max name length
  - naming rules
  - example (illustrative):
    - `setup.steps` could include a `dbClone` step plus `shell` steps for backend/frontend installs.

## Trade-offs & Risks
- Full copy uses more disk and takes longer than worktrees.
- `CREATE DATABASE ... TEMPLATE` is fast but may fail if connections are open or permissions lack.
- `pg_dump` fallback is slower but robust.
- Random colors add uniqueness but can be inconsistent if regenerated; storing color mitigates this.
- `stream checkout` requires `.git` in the stream; `.git` is excluded by default, so checkout fails unless `.git` is included.

## Open Questions
- Should `.git` be included by default or should checkout be disabled when `.git` is missing?
- Should default setup steps be provided for Dots (backend/frontend installs)?
- Do we need a more flexible naming policy (non-numeric ids, other prefixes)?

## Implementation Status
### Completed
- CLI commands: `stream <id>`, interactive picker, `-`, `main|master`, `del`, `checkout`, `config`, `list|ls`, `cd`, `shell`.
- Flags/options: `--include`, `--exclude`, `--no-setup`/`--no-install`, `--editor`, `--dry-run`, `--verbose`, `--cd`.
- Naming validation (`stream-<slug>-<number>`) and stream dir placement with configurable `streamsRoot`.
- Repo copy with include/exclude pattern matching.
- Editor integration with Peacock settings and deterministic color selection; open editor command.
- Status tracking in `.stream-<project>` with `lastActive`, `updatedAt`, and status transitions.
- Setup framework with `dbClone` + `shell` steps; order is copy → open editor → setup.
- DB clone using template (with pg_dump fallback), and env update in the stream.
- Config resolution (`stream.config.json`), defaults, and base repo inference.

### Not Yet / Partial
- Default setup steps for Dots (backend/frontend installs) are not included.
- Automated tests for parsing, config, db naming, or CLI flows.
