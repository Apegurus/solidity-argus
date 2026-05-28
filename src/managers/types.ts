import type { AuditState } from "../state/types"

export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type BackgroundFailureDiagnostic = {
  category: "model_error" | "tool_error" | "timeout" | "cancelled" | "unknown"
  retry_recommendation: "safe_to_retry" | "retry_with_changes" | "do_not_retry"
  summary: string
}

export type BackgroundTaskDiagnostic = {
  status: BackgroundTaskStatus
  result?: unknown
  error?: unknown
  diagnostic?: BackgroundFailureDiagnostic
}

/**
 * BackgroundManager interface
 * Handles dispatching and managing background agent tasks
 */
export interface BackgroundManager {
  /**
   * Dispatch an agent task to run in the background
   * @param agentName - Name of the agent to dispatch (e.g., "sentinel", "pythia")
   * @param prompt - The prompt/instruction for the agent
   * @param options - Optional configuration (priority, timeout, etc.)
   * @returns taskId - Unique identifier for tracking this task
   */
  dispatch(agentName: string, prompt: string, options?: { priority?: number }): string

  /**
   * Cancel a running background task
   * @param taskId - The task ID to cancel
   */
  cancel(taskId: string): void

  /**
   * Get the result of a completed background task
   * @param taskId - The task ID to retrieve results for
   * @returns Promise resolving to the task result
   */
  getResult(taskId: string): Promise<unknown>

  /**
   * Get task status and structured diagnostics for completed, failed, queued, and cancelled tasks.
   * Unknown task IDs resolve to undefined.
   */
  getTaskStatus(taskId: string): Promise<BackgroundTaskDiagnostic | undefined>

  /**
   * Register a callback to be invoked when a task completes
   * @param callback - Function called with (taskId, result) when task finishes
   */
  onComplete(callback: (taskId: string, result: unknown) => void): void

  /**
   * Get the number of currently active/running tasks
   * @returns Number of active tasks
   */
  getActiveCount(): number
}

/**
 * AuditStateManager interface
 * Handles persistence and retrieval of audit state
 */
export interface AuditStateManager {
  /**
   * Bind this manager to a specific OpenCode session.
   * After binding, save/load operate on a session-scoped state file
   * (.argus/sessions/state-{sessionId}.json) instead of the shared file.
   * This prevents multi-instance contamination.
   * @param sessionId - The OpenCode session ID (e.g., "ses_abc123")
   */
  bindSession(sessionId: string): void

  /**
   * Load audit state from persistent storage.
   * If bound to a session, tries the session-scoped file first,
   * then falls back to the most recent state file from any session.
   * @returns Promise resolving to AuditState or null if not found
   */
  load(): Promise<AuditState | null>

  /**
   * Save audit state to persistent storage.
   * Writes to the session-scoped file if bound, otherwise the shared file.
   * @param state - The AuditState to persist
   */
  save(state: AuditState): Promise<void>

  /**
   * Get the current in-memory audit state
   * @returns The current AuditState or null if not loaded
   */
  get(): AuditState | null

  /**
   * Update the audit state with a partial patch
   * @param patch - Partial AuditState object with fields to update
   */
  update(patch: Partial<AuditState>): Promise<void>

  /**
   * Reset the audit state (clear all data)
   */
  reset(): Promise<void>

  /**
   * Archive current state (if meaningful) then reset
   */
  archive(): Promise<void>

  /**
   * Dispose the state manager, flushing pending state to disk and releasing resources.
   * Safe to call multiple times; subsequent calls are no-ops.
   */
  dispose(): Promise<void>
}

/**
 * Managers type
 * Container for all manager instances
 */
export type Managers = {
  backgroundManager: BackgroundManager
  auditStateManager: AuditStateManager
}
