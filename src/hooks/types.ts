/**
 * Hook system types
 * Defines all available hook names in the Argus plugin
 */

export type HookName =
  | "system-prompt"
  | "compaction"
  | "tool-tracking"
  | "event"
  | "knowledge-sync"
  | "session-recovery"
  | "tool-error-recovery"
  | "context-window-monitor"
  | "tool-output-truncator"
  | "audit-continuation";
