import type {
  BackgroundFailureDiagnostic,
  BackgroundManager,
  BackgroundTaskDiagnostic,
  BackgroundTaskStatus,
} from "../../managers/types"
import { createLogger } from "../../shared/logger"

type TaskStatus = BackgroundTaskStatus
type CompletionCallback = (taskId: string, result: unknown) => void

export interface BackgroundTaskOptions {
  priority?: number
  max_concurrent?: number
}

export interface BackgroundManagerWithTaskCallbacks extends BackgroundManager {
  dispatch(agentName: string, prompt: string, options?: BackgroundTaskOptions): string
  onComplete(callback: CompletionCallback): void
  onComplete(taskId: string, callback: CompletionCallback): void
}

interface TaskInfo {
  status: TaskStatus
  agentName: string
  prompt: string
  options?: BackgroundTaskOptions
  result?: unknown
  error?: unknown
  callbacks: Set<CompletionCallback>
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function classifyBackgroundFailure(
  error: unknown,
  task?: Pick<TaskInfo, "status" | "prompt">,
): BackgroundFailureDiagnostic {
  if (task?.status === "cancelled") {
    return {
      category: "cancelled",
      retry_recommendation: "do_not_retry",
      summary: "Background task was cancelled before completion.",
    }
  }

  const text = errorText(error)
  const lower = text.toLowerCase()
  if (text.includes("This model does not support assistant message prefill")) {
    return {
      category: "model_error",
      retry_recommendation: "retry_with_changes",
      summary: "Provider rejected assistant prefill; retry with a fresh or shorter prompt.",
    }
  }
  if (lower.includes("timed out")) {
    const likelySizeRelated = (task?.prompt.length ?? 0) > 5_000
    return {
      category: "timeout",
      retry_recommendation: likelySizeRelated ? "retry_with_changes" : "safe_to_retry",
      summary: likelySizeRelated
        ? "Background task timed out; retry with a shorter prompt or narrower scope."
        : "Background task timed out; retrying is safe if upstream services are healthy.",
    }
  }
  if (
    lower.includes("argus tool") ||
    lower.includes("command failed") ||
    lower.includes("tool error") ||
    lower.includes('"success":false')
  ) {
    return {
      category: "tool_error",
      retry_recommendation: "retry_with_changes",
      summary: "Background task failed inside a tool or command invocation.",
    }
  }
  return {
    category: "unknown",
    retry_recommendation: "retry_with_changes",
    summary: text.length > 0 ? text : "Background task failed for an unknown reason.",
  }
}

export type Dispatcher = (
  agentName: string,
  prompt: string,
  options?: BackgroundTaskOptions,
) => Promise<string>

export function createBackgroundManager(
  initialDispatcher: Dispatcher,
  options?: { maxConcurrent?: number; maxRetainedTasks?: number },
): BackgroundManagerWithTaskCallbacks {
  const logger = createLogger()
  const tasks = new Map<string, TaskInfo>()
  const queue: string[] = []
  const globalCallbacks = new Set<CompletionCallback>()

  const dispatcher = initialDispatcher
  let runningCount = 0
  const maxConcurrent = options?.maxConcurrent ?? 3
  const maxRetainedTasks = options?.maxRetainedTasks ?? 1000
  let taskCount = 0
  let drainScheduled = false

  function safeInvokeCallback(callback: CompletionCallback, taskId: string, result: unknown): void {
    try {
      callback(taskId, result)
    } catch (error: unknown) {
      logger.error(`Background callback failed: ${taskId}`, error)
    }
  }

  function invokeCallbacks(taskId: string, result: unknown): void {
    const task = tasks.get(taskId)
    if (!task) {
      return
    }

    for (const callback of globalCallbacks) {
      safeInvokeCallback(callback, taskId, result)
    }

    for (const callback of task.callbacks) {
      safeInvokeCallback(callback, taskId, result)
    }

    task.callbacks.clear()
  }

  function scheduleDrain(): void {
    if (drainScheduled) return
    drainScheduled = true
    queueMicrotask(() => {
      drainScheduled = false
      drainQueue()
    })
  }

  function drainQueue(): void {
    while (runningCount < maxConcurrent && queue.length > 0) {
      const nextTaskId = queue.shift()

      if (!nextTaskId) {
        return
      }

      const task = tasks.get(nextTaskId)
      if (!task || task.status === "cancelled") {
        continue
      }

      task.status = "running"
      runningCount += 1

      const TASK_TIMEOUT_MS = 5 * 60 * 1000
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Background task timed out after 5 minutes: ${nextTaskId}`)),
          TASK_TIMEOUT_MS,
        )
      })

      Promise.race([dispatcher(task.agentName, task.prompt, task.options), timeoutPromise])
        .then((result) => {
          const currentTask = tasks.get(nextTaskId)

          if (!currentTask || currentTask.status === "cancelled") {
            return
          }

          currentTask.status = "completed"
          currentTask.result = result
          invokeCallbacks(nextTaskId, result)
        })
        .catch((error: unknown) => {
          const currentTask = tasks.get(nextTaskId)

          if (!currentTask || currentTask.status === "cancelled") {
            return
          }

          const isTimeout =
            error instanceof Error && error.message.includes("timed out after 5 minutes")
          if (isTimeout) {
            logger.error(`Background task timed out: ${nextTaskId}`, error)
          } else {
            logger.error(`Background task failed: ${nextTaskId}`, error)
          }

          currentTask.status = "failed"
          currentTask.error = error
          invokeCallbacks(nextTaskId, error)
        })
        .finally(() => {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          runningCount = Math.max(0, runningCount - 1)
          scheduleDrain()
        })
    }
  }

  // Terminal tasks are retained for late result/status reads but never removed on their own; evict
  // the oldest terminal ones past the retention bound so a long-lived session can't leak the map.
  function evictOldestTerminalTasks(): void {
    if (tasks.size <= maxRetainedTasks) return
    for (const [taskId, task] of tasks) {
      if (tasks.size <= maxRetainedTasks) break
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        tasks.delete(taskId)
      }
    }
  }

  function dispatch(agentName: string, prompt: string, options?: BackgroundTaskOptions): string {
    taskCount += 1
    const taskId = `task-${taskCount}`

    tasks.set(taskId, {
      status: "queued",
      agentName,
      prompt,
      options,
      callbacks: new Set<CompletionCallback>(),
    })

    evictOldestTerminalTasks()
    queue.push(taskId)
    scheduleDrain()

    return taskId
  }

  function cancel(taskId: string): void {
    const task = tasks.get(taskId)
    if (!task) {
      return
    }

    task.status = "cancelled"

    const queuedTaskIndex = queue.indexOf(taskId)
    if (queuedTaskIndex >= 0) {
      queue.splice(queuedTaskIndex, 1)
    }
  }

  function getResult(taskId: string): Promise<unknown> {
    const task = tasks.get(taskId)
    if (!task || task.status !== "completed") {
      return Promise.resolve(undefined)
    }

    return Promise.resolve(task.result)
  }

  function getTaskStatus(taskId: string): Promise<BackgroundTaskDiagnostic | undefined> {
    const task = tasks.get(taskId)
    if (!task) return Promise.resolve(undefined)

    if (task.status === "completed") {
      return Promise.resolve({ status: task.status, result: task.result })
    }
    if (task.status === "failed" || task.status === "cancelled") {
      return Promise.resolve({
        status: task.status,
        error: task.error,
        diagnostic: classifyBackgroundFailure(task.error, task),
      })
    }
    return Promise.resolve({ status: task.status })
  }

  function onComplete(
    taskIdOrCallback: string | CompletionCallback,
    callback?: CompletionCallback,
  ): void {
    if (typeof taskIdOrCallback === "function") {
      globalCallbacks.add(taskIdOrCallback)
      return
    }

    if (!callback) {
      return
    }

    const task = tasks.get(taskIdOrCallback)
    if (!task) {
      return
    }

    if (task.status === "completed") {
      safeInvokeCallback(callback, taskIdOrCallback, task.result)
      return
    }

    task.callbacks.add(callback)
  }

  function getActiveCount(): number {
    let activeCount = 0

    for (const task of tasks.values()) {
      if (task.status === "queued" || task.status === "running") {
        activeCount += 1
      }
    }

    return activeCount
  }

  return {
    dispatch,
    cancel,
    getResult,
    getTaskStatus,
    onComplete,
    getActiveCount,
  }
}
