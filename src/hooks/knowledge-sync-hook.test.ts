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
      auditSpecialist: {},
      scribe: {},
      themis: {},
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
      confidenceThreshold: 80,
      severityThreshold: "low",
      output_dir: ".opencode/reports/",
    },
    solodit: {
      enabled: true,
    },
    disabled_hooks: [],
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

test("createKnowledgeSyncHook rejects a private/loopback SCVD host from config (SSRF)", async () => {
  let clientCreated = false

  const deps: KnowledgeSyncDependencies = {
    createClient: () => {
      clientCreated = true
      return { kind: "client" }
    },
    syncIncrementalFn: async () => ({
      status: "success" as const,
      success: true,
      newFindings: 0,
      totalIndexed: 0,
      lastSync: "2026-02-17T00:00:00.000Z",
    }),
    log: () => {
      return
    },
  }

  const config = createArgusConfig(true)
  if (config.knowledge?.scvd) {
    config.knowledge.scvd.apiUrl = "http://169.254.169.254/latest/meta-data"
  }
  const hook = createKnowledgeSyncHook(config, deps)
  hook()

  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(clientCreated).toBe(false)
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
