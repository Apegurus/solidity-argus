import { expect, test } from "bun:test"
import type { ArgusConfig } from "../config/types"
import { getScvdIndexPath } from "../shared/cache-paths"
import { createKnowledgeSyncHook, type KnowledgeSyncDependencies } from "./knowledge-sync-hook"

function createArgusConfig(enabled: boolean): ArgusConfig {
  return {
    agents: {
      argus: {},
      sentinel: {},
      pythia: {},
      scribe: {},
    },
    tools: {},
    knowledge: {
      scvd: {
        enabled,
        apiUrl: "https://api.scvd.dev",
      },
      autoSync: true,
      skillPrecedence: "bundled-first" as const,
    },
    reporting: {
      format: "markdown",
      severityThreshold: "low",
      gasAnalysis: false,
      output_dir: ".opencode/reports/",
    },
    solodit: {
      enabled: true,
      port: 54173,
    },
    disabled_hooks: [],
    hooks: {},
    cli: {},
    background: { max_concurrent: 3 },
  }
}

test("createKnowledgeSyncHook returns quickly and does not block", async () => {
  let syncCalled = false

  const deps: KnowledgeSyncDependencies = {
    createClient: () => ({ kind: "client" }),
    syncIncrementalFn: async () => {
      syncCalled = true
      await Bun.sleep(25)
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "2026-02-17T00:00:00.000Z",
      }
    },
    log: () => {
      return
    },
  }

  const hook = createKnowledgeSyncHook(createArgusConfig(true), deps)
  const startedAt = performance.now()
  hook()
  const elapsed = performance.now() - startedAt

  expect(elapsed).toBeLessThan(10)
  expect(syncCalled).toBe(false)

  await Promise.resolve()
  await Promise.resolve()
  expect(syncCalled).toBe(true)
})

test("createKnowledgeSyncHook triggers async sync with default index path", async () => {
  const calls: string[] = []

  const deps: KnowledgeSyncDependencies = {
    createClient: (apiUrl) => {
      calls.push(`client:${apiUrl}`)
      return { kind: "client" }
    },
    syncIncrementalFn: async (_client, indexPath) => {
      calls.push(`sync:${indexPath}`)
      return {
        status: "success" as const,
        success: true,
        newFindings: 2,
        totalIndexed: 12,
        lastSync: "2026-02-17T00:00:00.000Z",
      }
    },
    log: (message) => {
      calls.push(`log:${message}`)
    },
  }

  const hook = createKnowledgeSyncHook(createArgusConfig(true), deps)
  hook()

  await Promise.resolve()
  await Promise.resolve()

  expect(calls[0]).toBe("client:https://api.scvd.dev")
  expect(calls[1]).toContain(getScvdIndexPath())
  expect(calls[2]).toContain("SCVD index updated: 2 new findings")
})

test("createKnowledgeSyncHook skips sync when SCVD disabled", async () => {
  let syncCalled = false

  const deps: KnowledgeSyncDependencies = {
    createClient: () => ({ kind: "client" }),
    syncIncrementalFn: async () => {
      syncCalled = true
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "2026-02-17T00:00:00.000Z",
      }
    },
    log: () => {
      return
    },
  }

  const hook = createKnowledgeSyncHook(createArgusConfig(false), deps)
  hook()

  await Promise.resolve()
  await Promise.resolve()
  expect(syncCalled).toBe(false)
})
