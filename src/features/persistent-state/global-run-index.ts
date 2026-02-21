import { appendFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createLogger } from "../../shared/logger"

const logger = createLogger()

const CACHE_DIR = join(homedir(), ".cache", "solidity-argus", "runs")
const INDEX_FILE = join(CACHE_DIR, "index.jsonl")

export type RunIndexEntry = {
  runId: string
  opencodeSessionId?: string
  projectDir: string
  statePath: string
  journalPath: string
  startedAt: number
  phase: string
  findingsCount: number
}

let dirEnsured = false

async function ensureDir(): Promise<void> {
  if (dirEnsured) return
  await mkdir(CACHE_DIR, { recursive: true })
  dirEnsured = true
}

export async function recordRun(entry: RunIndexEntry): Promise<void> {
  try {
    await ensureDir()
    appendFileSync(INDEX_FILE, `${JSON.stringify(entry)}\n`)
  } catch {
    logger.debug("Failed to write global run index entry")
  }
}
