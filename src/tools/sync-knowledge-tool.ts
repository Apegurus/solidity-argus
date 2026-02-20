import os from "node:os"
import path from "node:path"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import { ScvdClient } from "../knowledge/scvd-client"
import { syncAll, syncIncremental, type SyncResult } from "../knowledge/scvd-sync"
import { loadArgusConfig } from "../config/loader"
import type { ArgusConfig } from "../config/types"
import { resolveProjectDir } from "../shared/project-utils"

type SyncKnowledgeArgs = {
  force?: boolean
}

export type SyncKnowledgeResult = {
  success: boolean
  scvd?: {
    newFindings: number
    totalIndexed: number
    lastSync: string
  }
  errors?: string[]
  error?: string
}

export type SyncKnowledgeDependencies = {
  loadConfig?: (projectDir: string) => ArgusConfig
  createClient?: (apiUrl: string, signal: AbortSignal) => unknown
  syncAllFn?: (client: unknown, indexPath: string) => Promise<SyncResult>
  syncIncrementalFn?: (client: unknown, indexPath: string) => Promise<SyncResult>
}

const DEFAULT_SCVD_API_URL = "https://api.scvd.dev"

function defaultDependencies(): Required<SyncKnowledgeDependencies> {
  return {
    loadConfig: loadArgusConfig,
    createClient: (apiUrl: string, signal: AbortSignal) => new ScvdClient(apiUrl, signal),
    syncAllFn: async (client: unknown, indexPath: string) =>
      syncAll(client as ScvdClient, indexPath),
    syncIncrementalFn: async (client: unknown, indexPath: string) =>
      syncIncremental(client as ScvdClient, indexPath),
  }
}

function buildSuccessResult(result: SyncResult): SyncKnowledgeResult {
  const errors = result.error ? [result.error] : []

  return {
    success: result.success,
    scvd: {
      newFindings: result.newFindings,
      totalIndexed: result.totalIndexed,
      lastSync: result.lastSync,
    },
    errors,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown SCVD sync error"
}

export async function executeSyncKnowledge(
  args: SyncKnowledgeArgs,
  context: ToolContext,
  deps: SyncKnowledgeDependencies = {}
): Promise<SyncKnowledgeResult> {
  const dependencies = { ...defaultDependencies(), ...deps }

  context.metadata({ title: "Syncing SCVD knowledge index..." })

  try {
    const projectDir = resolveProjectDir(context)
    const argusConfig = dependencies.loadConfig(projectDir)

    if (!argusConfig.knowledge?.scvd?.enabled) {
      return {
        success: false,
        error: "SCVD sync disabled in config",
        errors: ["SCVD sync disabled in config"],
      }
    }

    const apiUrl = argusConfig.knowledge?.scvd?.apiUrl ?? DEFAULT_SCVD_API_URL
    const indexPath = path.join(
      os.homedir(),
      ".cache",
      "solidity-argus",
      "scvd-index.json"
    )

    const client = dependencies.createClient(apiUrl, context.abort)
    const result = args.force
      ? await dependencies.syncAllFn(client, indexPath)
      : await dependencies.syncIncrementalFn(client, indexPath)

    return buildSuccessResult(result)
  } catch (error) {
    const message = toErrorMessage(error)
    return {
      success: false,
      error: message,
      errors: [message],
    }
  }
}

export const syncKnowledgeTool = tool({
  description: "Sync SCVD knowledge index to local cache for pattern-aware matching.",
  args: {
    force: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const result = await executeSyncKnowledge(args, context)
    return JSON.stringify(result)
  },
})
