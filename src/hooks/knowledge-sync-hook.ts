import os from "node:os"
import path from "node:path"
import { ScvdClient } from "../knowledge/scvd-client"
import { syncIncremental, type SyncResult } from "../knowledge/scvd-sync"
import type { ArgusConfig } from "../config/types"
import { createLogger } from "../shared/logger"

export type KnowledgeSyncDependencies = {
  createClient?: (apiUrl: string) => unknown
  syncIncrementalFn?: (client: unknown, indexPath: string) => Promise<SyncResult>
  log?: (message: string) => void
}

const DEFAULT_SCVD_API_URL = "https://api.scvd.dev"

function defaultDependencies(): Required<KnowledgeSyncDependencies> {
  return {
    createClient: (apiUrl: string) => new ScvdClient(apiUrl),
    syncIncrementalFn: async (client: unknown, indexPath: string) =>
      syncIncremental(client as ScvdClient, indexPath),
    log: (message: string) => {
       createLogger().info(message)
     },
  }
}

export function createKnowledgeSyncHook(
  argusConfig: ArgusConfig,
  deps: KnowledgeSyncDependencies = {}
): () => void {
  const dependencies = { ...defaultDependencies(), ...deps }

  return function triggerAutoSync(): void {
    if (!argusConfig.knowledge?.scvd?.enabled) {
      return
    }

    const apiUrl = argusConfig.knowledge?.scvd?.apiUrl ?? DEFAULT_SCVD_API_URL
    const indexPath = path.join(
      os.homedir(),
      ".cache",
      "solidity-argus",
      "scvd-index.json"
    )

    Promise.resolve().then(async () => {
       try {
         const client = dependencies.createClient(apiUrl)
         const result = await dependencies.syncIncrementalFn(client, indexPath)
         if (result.newFindings > 0) {
           dependencies.log(
             `[argus] SCVD index updated: ${result.newFindings} new findings (total: ${result.totalIndexed})`
           )
         }
       } catch (_e) { /* non-critical: sync errors are logged above */ }
     })
  }
}
