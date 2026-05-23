import { describe, expect, it, mock } from "bun:test"
import { type BackgroundTaskOptions, createBackgroundManager } from "./background-manager"

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe("createBackgroundManager", () => {
  it("dispatches a task and returns a task id", async () => {
    const dispatcher = mock(async () => "remote-task-1")
    const manager = createBackgroundManager(dispatcher)

    const taskId = manager.dispatch("argus", "audit this")

    expect(taskId).toMatch(/^task-/)

    // scheduleDrain defers execution to a microtask, so flush before asserting
    await flushMicrotasks()
    expect(dispatcher).toHaveBeenCalledTimes(1)
    expect(dispatcher).toHaveBeenCalledWith("argus", "audit this", undefined)
    expect(await manager.getResult(taskId)).toBe("remote-task-1")
  })

  it("tracks active tasks for running and queued work", () => {
    const deferredA = createDeferred<string>()
    const deferredB = createDeferred<string>()
    const dispatcher = mock(
      (_agentName: string, prompt: string, _options?: BackgroundTaskOptions) => {
        if (prompt === "one") {
          return deferredA.promise
        }

        return deferredB.promise
      },
    )

    const manager = createBackgroundManager(dispatcher)

    manager.dispatch("argus", "one")
    manager.dispatch("argus", "two")

    expect(manager.getActiveCount()).toBe(2)
  })

  it("respects max_concurrent and queues extra tasks", async () => {
    const deferredA = createDeferred<string>()
    const deferredB = createDeferred<string>()
    const calls: string[] = []

    const dispatcher = mock(
      (_agentName: string, prompt: string, _options?: BackgroundTaskOptions) => {
        calls.push(prompt)

        if (prompt === "one") {
          return deferredA.promise
        }

        return deferredB.promise
      },
    )

    const manager = createBackgroundManager(dispatcher, { maxConcurrent: 1 })

    const taskA = manager.dispatch("argus", "one")
    const taskB = manager.dispatch("argus", "two")

    expect(taskA).toMatch(/^task-/)
    expect(taskB).toMatch(/^task-/)

    // scheduleDrain defers execution to a microtask, so flush before asserting
    await flushMicrotasks()
    expect(calls).toEqual(["one"])

    deferredA.resolve("done-1")
    await flushMicrotasks()

    expect(calls).toEqual(["one", "two"])
    deferredB.resolve("done-2")
  })

  it("fires task completion callback when task completes", async () => {
    const deferred = createDeferred<string>()
    const dispatcher = mock(async () => deferred.promise)
    const manager = createBackgroundManager(dispatcher)
    const onComplete = mock((_taskId: string, _result: unknown) => {})

    const taskId = manager.dispatch("argus", "audit this")
    manager.onComplete(taskId, onComplete)

    deferred.resolve("complete")
    await flushMicrotasks()

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(taskId, "complete")
  })

  it("fires onComplete callback when task fails", async () => {
    const deferred = createDeferred<string>()
    const dispatcher = mock(async () => deferred.promise)
    const manager = createBackgroundManager(dispatcher)
    const onComplete = mock((_taskId: string, _result: unknown) => {})

    const taskId = manager.dispatch("argus", "audit this")
    manager.onComplete(taskId, onComplete)

    const error = new Error("task failed")
    deferred.reject(error)
    await flushMicrotasks()

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith(taskId, error)
  })

  it("uses real dispatcher when provided (ctx.task wiring pattern)", async () => {
    const mockCtxTask = mock(async (agentName: string, _prompt: string) => {
      return { task_id: `remote-${agentName}-${Date.now()}` }
    })

    const realDispatcher = async (agentName: string, prompt: string) => {
      const result = await mockCtxTask(agentName, prompt)
      if (typeof result === "object" && result !== null) {
        const taskId = (result as Record<string, unknown>).task_id
        if (typeof taskId === "string") {
          return taskId
        }
      }
      return `task-${Date.now()}`
    }

    const manager = createBackgroundManager(realDispatcher)
    const taskId = manager.dispatch("sentinel", "run slither")

    await flushMicrotasks()

    expect(mockCtxTask).toHaveBeenCalledTimes(1)
    expect(mockCtxTask).toHaveBeenCalledWith("sentinel", "run slither")
    const result = await manager.getResult(taskId)
    expect(typeof result).toBe("string")
    expect((result as string).startsWith("remote-sentinel-")).toBe(true)
  })

  it("isolates callback errors from task completion", async () => {
    const deferred = createDeferred<string>()
    const dispatcher = mock(async () => deferred.promise)
    const manager = createBackgroundManager(dispatcher)
    const throwingCallback = mock(() => {
      throw new Error("callback boom")
    })
    const healthyCallback = mock((_taskId: string, _result: unknown) => {})

    const taskId = manager.dispatch("argus", "audit this")
    manager.onComplete(taskId, throwingCallback)
    manager.onComplete(taskId, healthyCallback)

    deferred.resolve("complete")
    await flushMicrotasks()

    expect(throwingCallback).toHaveBeenCalledTimes(1)
    expect(healthyCallback).toHaveBeenCalledTimes(1)
    expect(await manager.getResult(taskId)).toBe("complete")
  })

  it("getTaskStatus returns completed task diagnostics", async () => {
    const dispatcher = mock(async () => "complete")
    const manager = createBackgroundManager(dispatcher)
    const taskId = manager.dispatch("argus", "audit this")

    await flushMicrotasks()

    expect(await manager.getTaskStatus(taskId)).toEqual({
      status: "completed",
      result: "complete",
    })
  })

  it("getTaskStatus classifies provider prefill failures", async () => {
    const error = new Error("This model does not support assistant message prefill")
    const dispatcher = mock(async () => {
      throw error
    })
    const manager = createBackgroundManager(dispatcher)
    const taskId = manager.dispatch("sentinel", "audit this")

    await flushMicrotasks()

    expect(await manager.getTaskStatus(taskId)).toEqual({
      status: "failed",
      error,
      diagnostic: {
        category: "model_error",
        retry_recommendation: "retry_with_changes",
        summary: "Provider rejected assistant prefill; retry with a fresh or shorter prompt.",
      },
    })
  })

  it("getTaskStatus classifies tool failures", async () => {
    const error = new Error('Argus tool error payload: {"success":false,"error":"Slither failed"}')
    const dispatcher = mock(async () => {
      throw error
    })
    const manager = createBackgroundManager(dispatcher)
    const taskId = manager.dispatch("sentinel", "run slither")

    await flushMicrotasks()

    const status = await manager.getTaskStatus(taskId)
    expect(status?.diagnostic).toEqual({
      category: "tool_error",
      retry_recommendation: "retry_with_changes",
      summary: "Background task failed inside a tool or command invocation.",
    })
  })

  it("getTaskStatus reports queued and unknown task ids", async () => {
    const deferred = createDeferred<string>()
    const dispatcher = mock(async () => deferred.promise)
    const manager = createBackgroundManager(dispatcher, { maxConcurrent: 1 })

    manager.dispatch("argus", "one")
    const queued = manager.dispatch("argus", "two")

    await flushMicrotasks()

    expect(await manager.getTaskStatus(queued)).toEqual({ status: "queued" })
    expect(await manager.getTaskStatus("missing-task")).toBeUndefined()
    deferred.resolve("done")
  })
})
