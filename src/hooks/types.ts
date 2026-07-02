/**
 * Hook system types
 * Defines all available hook names in the Argus plugin
 */

export const HOOK_NAMES = [
  "compaction",
  "tool-tracking",
  "event",
  "knowledge-sync",
  "session-recovery",
  "tool-error-recovery",
  "context-window-monitor",
  "tool-output-truncator",
  "audit-continuation",
  "system-prompt",
  "audit-specialist-watchdog",
] as const

export type HookName = (typeof HOOK_NAMES)[number]
