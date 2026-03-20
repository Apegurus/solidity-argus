import type { BackgroundManager } from "../../managers/types"
import { createLogger } from "../../shared/logger"

type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled"
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

export type Dispatcher = (
  agentName: string,
  prompt: string,
  options?: BackgroundTaskOptions,
) => Promise<string>

export function createBackgroundManager(
  initialDispatcher: Dispatcher,
  options?: { maxConcurrent?: number },
): BackgroundManagerWithTaskCallbacks {
  const logger = createLogger()
  const tasks = new Map<string, TaskInfo>()
  const queue: string[] = []
  const globalCallbacks = new Set<CompletionCallback>()

  const dispatcher = initialDispatcher
  let runningCount = 0
  const maxConcurrent = options?.maxConcurrent ?? 3
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
    onComplete,
    getActiveCount,
  }
}
