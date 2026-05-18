import { expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { ArgusConfig } from "../config/types"
import { getScvdIndexPath } from "../shared/cache-paths"
import {
  executeSyncKnowledge,
  type SyncKnowledgeDependencies,
  syncKnowledgeTool,
} from "./sync-knowledge-tool"

function createContext(): {
  context: ToolContext
  metadataCalls: Array<{ title?: string }>
} {
  const metadataCalls: Array<{ title?: string }> = []
  const abortController = new AbortController()

  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title })
    },
    async ask() {
      return
    },
  }

  return { context, metadataCalls }
}

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

test("syncKnowledgeTool uses tool() helper contract", () => {
  expect(syncKnowledgeTool.description.length).toBeGreaterThan(0)
  expect(syncKnowledgeTool.args).toBeDefined()
  expect(typeof syncKnowledgeTool.execute).toBe("function")
})

test("executeSyncKnowledge runs full sync when force=true", async () => {
  const { context, metadataCalls } = createContext()
  const calls: string[] = []

  const deps: SyncKnowledgeDependencies = {
    loadConfig: () => createArgusConfig(true),
    createClient: (apiUrl, signal) => {
      calls.push(`client:${apiUrl}:${String(signal === context.abort)}`)
      return { kind: "client" }
    },
    syncAllFn: async (_client, indexPath) => {
      calls.push(`syncAll:${indexPath}`)
      return {
        status: "success" as const,
        success: true,
        newFindings: 4,
        totalIndexed: 42,
        lastSync: "2026-02-17T00:00:00.000Z",
      }
    },
    syncIncrementalFn: async () => {
      calls.push("syncIncremental")
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "",
      }
    },
  }

  const result = await executeSyncKnowledge({ force: true }, context, deps)

  expect(result.success).toBe(true)
  expect(result.scvd?.newFindings).toBe(4)
  expect(result.scvd?.totalIndexed).toBe(42)
  expect(result.errors).toEqual([])
  expect(calls.some((call) => call.startsWith("syncAll:"))).toBe(true)
  expect(calls.includes("syncIncremental")).toBe(false)
  expect(calls[0]).toContain("client:https://api.scvd.dev:true")
  expect(calls[1]).toContain(getScvdIndexPath())
  expect(metadataCalls[0]?.title).toBe("Syncing SCVD knowledge index...")
})

test("executeSyncKnowledge runs incremental sync by default", async () => {
  const { context } = createContext()
  let syncAllCalled = false
  let syncIncrementalCalled = false

  const deps: SyncKnowledgeDependencies = {
    loadConfig: () => createArgusConfig(true),
    createClient: () => ({ kind: "client" }),
    syncAllFn: async () => {
      syncAllCalled = true
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "",
      }
    },
    syncIncrementalFn: async () => {
      syncIncrementalCalled = true
      return {
        status: "success" as const,
        success: true,
        newFindings: 1,
        totalIndexed: 10,
        lastSync: "2026-02-17T00:00:00.000Z",
      }
    },
  }

  const result = await executeSyncKnowledge({ force: false }, context, deps)

  expect(result.success).toBe(true)
  expect(result.scvd?.newFindings).toBe(1)
  expect(result.scvd?.totalIndexed).toBe(10)
  expect(syncIncrementalCalled).toBe(true)
  expect(syncAllCalled).toBe(false)
})

test("executeSyncKnowledge returns disabled error when SCVD is off", async () => {
  const { context } = createContext()
  let syncCalled = false

  const deps: SyncKnowledgeDependencies = {
    loadConfig: () => createArgusConfig(false),
    createClient: () => ({ kind: "client" }),
    syncAllFn: async () => {
      syncCalled = true
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "",
      }
    },
    syncIncrementalFn: async () => {
      syncCalled = true
      return {
        status: "success" as const,
        success: true,
        newFindings: 0,
        totalIndexed: 0,
        lastSync: "",
      }
    },
  }

  const result = await executeSyncKnowledge({ force: false }, context, deps)

  expect(result.success).toBe(false)
  expect(result.error).toBe("SCVD sync disabled in config")
  expect(syncCalled).toBe(false)
})

test("executeSyncKnowledge handles thrown errors with structured response", async () => {
  const { context } = createContext()

  const deps: SyncKnowledgeDependencies = {
    loadConfig: () => {
      throw new Error("bad config")
    },
    createClient: () => ({ kind: "client" }),
    syncAllFn: async () => ({
      status: "success" as const,
      success: true,
      newFindings: 0,
      totalIndexed: 0,
      lastSync: "",
    }),
    syncIncrementalFn: async () => ({
      status: "success" as const,
      success: true,
      newFindings: 0,
      totalIndexed: 0,
      lastSync: "",
    }),
  }

  const result = await executeSyncKnowledge({ force: false }, context, deps)

  expect(result.success).toBe(false)
  expect(result.error).toContain("bad config")
  expect(result.errors?.[0]).toContain("bad config")
})
