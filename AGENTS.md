# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the TypeScript sources. Key entry points: `src/cli.ts` (CLI parsing), `src/stream.ts` (core stream operations), `src/config.ts` (config loading), and `src/utils/` (shared helpers).
- `dist/` is generated build output from `tsc`. Do not edit files here directly.
- `stream.config.json` is the optional user config file for the CLI. See `README.md` for examples.
- `AGENT_STREAM_CONFIG.md` documents how agents should generate configs.

## Build, Test, and Development Commands
- `npm install`: install dependencies (Node >=18).
- `npm run build`: compile TypeScript from `src/` to `dist/`.
- `npm run start`: run the CLI via `node dist/cli.js`.
- `npm run typecheck`: strict typecheck without emitting JS.

Example local run:

```bash
npm run build
./dist/cli.js 1
```

## Coding Style & Naming Conventions
- TypeScript, CommonJS output, strict mode (`tsconfig.json`).
- Use 2-space indentation, double quotes, and semicolons to match existing files.
- Keep file names lower-case and descriptive (e.g., `git.ts`, `setup.ts`).
- No formatter/linter is configured; keep changes consistent with nearby code.

## Testing Guidelines
- No automated test runner is configured today.
- Use `npm run typecheck` and manual CLI verification for changes.
- If adding tests, introduce a `tests/` or `src/__tests__/` folder and wire an npm script.

## Commit & Pull Request Guidelines
- The repo has no commit history yet, so no convention is established.
- Use short, imperative messages (e.g., "Add stream config validation").
- PRs should include: a concise summary, rationale, and the command(s) used to verify changes.
- If behavior changes affect CLI UX, include before/after examples in the PR description.

## Configuration Notes
- `stream.config.json` defaults are described in `README.md` and `AGENT_STREAM_CONFIG.md`.
- Avoid enabling DB cloning unless explicitly required by the project setup.
