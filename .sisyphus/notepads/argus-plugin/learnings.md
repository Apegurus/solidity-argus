# Argus Plugin — Learnings & Conventions

<!-- Append entries below. Never overwrite. Format: ## [TIMESTAMP] Task: {N} -->

## [2026-02-17T22:51:36Z] Bootstrap
- Working directory: `/Users/ignacioblitzer/Develop/defizoo/solidity-auditor`
- Project is greenfield — only `argus-planning-prompt.md` and `.sisyphus/` exist
- npm package name: `opencode-argus`
- Plugin entry point pattern: `const ArgusPlugin: Plugin = async (ctx) => { return { tool: {}, config: async (config) => {}, ... } }`
- OpenCode plugin API: `@opencode-ai/plugin` provides `Plugin` type and `tool()` helper
- Agent registration: via `config.agent` mutation in config handler
- Skills registration: via `config.skills.paths` in config handler
- MCP registration: via `config.mcp` mutation in config handler
- System prompt injection: via `experimental.chat.system.transform` hook
- All test output: `bun test` (NOT jest/mocha)
- TypeScript strict mode, ES2022 target, moduleResolution bundler
- NO `as any`, `@ts-ignore`, type suppression
- All evidence files go to `.sisyphus/evidence/task-{N}-{slug}.txt`

## [2026-02-17T22:55:12Z] Task 1: Plugin Scaffold Complete
- Initialized bun project with `bun init -y`
- Created directory structure: src/{tools,hooks,state,utils,agents,constants,knowledge}, skills/, tests/fixtures/, .sisyphus/evidence/
- Updated package.json: name="opencode-argus", version="0.1.0", main="./src/index.ts"
- Added dependencies: @opencode-ai/plugin, zod
- Added scripts: build, test, typecheck
- tsconfig.json: target ES2022, module ESNext, moduleResolution bundler, strict: true
- bunfig.toml: [test] preload = ["./test-setup.ts"]
- src/index.ts: Plugin type from @opencode-ai/plugin, async function returning { tool: {}, config: async () => {} }
- tests/smoke.test.ts: Basic smoke test using bun:test
- Build output: 187 bytes, 1 module, successful
- Test output: 1 pass, 0 fail
- Commit: b5463b4 "chore(scaffold): initialize opencode-argus plugin with TDD infrastructure"
- Evidence files saved: task-1-plugin-export.txt, task-1-test-infra.txt
