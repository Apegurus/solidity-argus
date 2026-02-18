# Argus Overhaul — Architectural Decisions

## Clean break config: YES (no migration from old format)
## TDD: RED → GREEN → REFACTOR for all new code
## CLI: Full CLI with Bun.argv (no commander/yargs)
## Config: Multi-level (user ~/.config/opencode/ + project .opencode/)
## BackgroundManager: Injectable dispatcher, standalone concurrency only
## Event v2: Typed delegation only, NO event bus/pub-sub
## CLI output: Plain ANSI colors only (green ✓, red ✗, yellow ⚠)
## AuditPhase: Keep existing values (scanning, research) — no rename
