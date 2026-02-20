import { describe, expect, it, mock } from "bun:test";
import { createBackgroundManager, type BackgroundTaskOptions } from "./background-manager";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createBackgroundManager", () => {
  it("dispatches a task and returns a task id", async () => {
    const dispatcher = mock(async () => "remote-task-1");
    const manager = createBackgroundManager(dispatcher);

    const taskId = manager.dispatch("argus", "audit this");

    expect(taskId).toMatch(/^task-/);
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(dispatcher).toHaveBeenCalledWith("argus", "audit this", undefined);

    await flushMicrotasks();
    expect(await manager.getResult(taskId)).toBe("remote-task-1");
  });

  it("tracks active tasks for running and queued work", () => {
    const deferredA = createDeferred<string>();
    const deferredB = createDeferred<string>();
    const dispatcher = mock((_agentName: string, prompt: string, _options?: BackgroundTaskOptions) => {
      if (prompt === "one") {
        return deferredA.promise;
      }

      return deferredB.promise;
    });

    const manager = createBackgroundManager(dispatcher);

    manager.dispatch("argus", "one");
    manager.dispatch("argus", "two");

    expect(manager.getActiveCount()).toBe(2);
  });

  it("respects max_concurrent and queues extra tasks", async () => {
    const deferredA = createDeferred<string>();
    const deferredB = createDeferred<string>();
    const calls: string[] = [];

    const dispatcher = mock((_agentName: string, prompt: string, _options?: BackgroundTaskOptions) => {
      calls.push(prompt);

      if (prompt === "one") {
        return deferredA.promise;
      }

      return deferredB.promise;
    });

    const manager = createBackgroundManager(dispatcher, { maxConcurrent: 1 });

    const taskA = manager.dispatch("argus", "one");
    const taskB = manager.dispatch("argus", "two");

    expect(taskA).toMatch(/^task-/);
    expect(taskB).toMatch(/^task-/);
    expect(calls).toEqual(["one"]);

    deferredA.resolve("done-1");
    await flushMicrotasks();

    expect(calls).toEqual(["one", "two"]);
    deferredB.resolve("done-2");
  });

  it("fires task completion callback when task completes", async () => {
    const deferred = createDeferred<string>();
    const dispatcher = mock(async () => deferred.promise);
    const manager = createBackgroundManager(dispatcher);
    const onComplete = mock((_taskId: string, _result: unknown) => {});

    const taskId = manager.dispatch("argus", "audit this");
    manager.onComplete(taskId, onComplete);

    deferred.resolve("complete");
    await flushMicrotasks();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(taskId, "complete");
  });
});
