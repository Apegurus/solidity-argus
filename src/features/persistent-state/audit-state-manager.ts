import { createHash } from "node:crypto"
import { mkdirSync } from "node:fs"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AuditStateManager } from "../../managers/types"
import { createLogger } from "../../shared/logger"
import { type ArgusRootResolver, defaultRootResolver } from "../../shared/path-root-resolver"
import { createAuditState } from "../../state/audit-state"
import { projectAuditState, stableHash } from "../../state/projectors"
import type { AuditState, PersistentAuditState } from "../../state/types"
import { readEvents } from "./event-sink"

const STATE_FILE_NAME = "argus-state.json"
const SESSIONS_DIR = "sessions"
const STATE_VERSION = "2"

type ProjectedAuditCore = Pick<
  AuditState,
  "contractsReviewed" | "findings" | "toolsExecuted" | "currentPhase" | "scope"
>

interface ConsistentStateResult {
  state: AuditState
  sourceOfTruth: "events" | "snapshot"
  lastEventSeq?: number
  eventStreamHash?: string
  repaired: boolean
}

const SAVE_MUTEX_TIMEOUT_MS = 30_000
const MAX_SAVE_CAS_RETRIES = 10
const LEGACY_OBSERVATION_ID_PATTERN = /^obs-\d+$/

function generateDeterministicFindingId(
  check: string,
  file: string,
  lines: [number, number],
): string {
  return createHash("sha256")
    .update(`${check}:${file}:${lines[0]}-${lines[1]}`)
    .digest("hex")
    .substring(0, 16)
}

function migrateLegacyFindingIds(state: AuditState): number {
  let migratedCount = 0

  state.findings = state.findings.map((finding) => {
    if (!LEGACY_OBSERVATION_ID_PATTERN.test(finding.id)) {
      return finding
    }

    migratedCount += 1
    return {
      ...finding,
      id: generateDeterministicFindingId(finding.check, finding.file, finding.lines),
    }
  })

  return migratedCount
}

export function createAsyncMutex(timeoutMs = SAVE_MUTEX_TIMEOUT_MS) {
  const logger = createLogger()
  let chain = Promise.resolve()

  return {
    async acquire(): Promise<() => void> {
      const previous = chain
      let releaseCurrent!: () => void
      chain = new Promise<void>((resolve) => {
        releaseCurrent = resolve
      })

      await previous

      let released = false
      const timeout = setTimeout(() => {
        // Log the timeout but do NOT release — the holder must finish
        // its critical section and call release() explicitly.
        logger.error(`audit-state-manager mutex held for >${timeoutMs}ms — possible deadlock`)
      }, timeoutMs)

      return () => {
        if (released) {
          return
        }

        released = true
        clearTimeout(timeout)
        releaseCurrent()
      }
    },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isAuditState(value: unknown): value is AuditState {
  if (!isObject(value)) {
    return false
  }

  return (
    typeof value.sessionId === "string" &&
    typeof value.projectDir === "string" &&
    isStringArray(value.contractsReviewed) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.toolsExecuted) &&
    typeof value.currentPhase === "string" &&
    isStringArray(value.scope) &&
    typeof value.startTime === "number"
  )
}

function isPersistentAuditState(value: unknown): value is PersistentAuditState {
  if (!isAuditState(value) || !isObject(value)) {
    return false
  }

  const hasSupportedVersion = value.version === "1" || value.version === "2"

  return (
    typeof value.savedAt === "number" && hasSupportedVersion && typeof value.filePath === "string"
  )
}

function projectCoreState(
  state: AuditState,
  events: Awaited<ReturnType<typeof readEvents>>,
): ProjectedAuditCore {
  const projected = projectAuditState(events, state.projectDir)

  return {
    contractsReviewed: projected.contractsReviewed,
    findings: projected.findings,
    toolsExecuted: projected.toolsExecuted,
    currentPhase: projected.currentPhase,
    scope: projected.scope,
  }
}

function hasProjectedCoreMismatch(state: AuditState, projectedCore: ProjectedAuditCore): boolean {
  const stateCore: ProjectedAuditCore = {
    contractsReviewed: state.contractsReviewed,
    findings: state.findings,
    toolsExecuted: state.toolsExecuted,
    currentPhase: state.currentPhase,
    scope: state.scope,
  }

  return stableHash(stateCore) !== stableHash(projectedCore)
}

function hasSnapshotStampMismatch(
  snapshotSeq: number | undefined,
  snapshotHash: string | undefined,
  derivedSeq: number | undefined,
  derivedHash: string | undefined,
): boolean {
  if (snapshotSeq === undefined && snapshotHash === undefined) {
    return false
  }

  if (snapshotSeq !== undefined && derivedSeq !== undefined && snapshotSeq !== derivedSeq) {
    return true
  }

  if (snapshotHash !== undefined && derivedHash !== undefined && snapshotHash !== derivedHash) {
    return true
  }

  return false
}

export function createDebouncedSave(
  saveState: (state: AuditState) => Promise<void>,
  delayMs = 5_000,
): {
  save: (state: AuditState) => void
  flush: () => Promise<void>
  dispose: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  const pendingStates: AuditState[] = []
  let persistQueue = Promise.resolve()

  async function persistPendingStateQueue(): Promise<void> {
    if (pendingStates.length === 0) {
      return
    }

    const statesToPersist = pendingStates.splice(0, pendingStates.length)

    for (const state of statesToPersist) {
      try {
        await saveState(state)
      } catch {
        createLogger().debug("Debounced state persistence failed")
      }
    }

    if (pendingStates.length > 0) {
      await persistPendingStateQueue()
    }
  }

  function enqueuePersist(): Promise<void> {
    persistQueue = persistQueue.then(() => persistPendingStateQueue())
    return persistQueue
  }

  return {
    save(state: AuditState): void {
      pendingStates.push(state)

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        void enqueuePersist()
      }, delayMs)
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      await enqueuePersist()
    },
    dispose(): void {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      pendingStates.length = 0
    },
  }
}

export function createAuditStateManager(
  projectDir: string,
  resolver: ArgusRootResolver = defaultRootResolver,
): AuditStateManager {
  const logger = createLogger()

  const argusRoot = resolver.writeRoot(projectDir)
  const sharedStateFilePath = join(argusRoot, STATE_FILE_NAME)
  const sessionsDirPath = join(argusRoot, SESSIONS_DIR)
  let stateFilePath = sharedStateFilePath
  let boundSessionId: string | undefined
  let currentState: AuditState = createAuditState(projectDir).state
  const saveMutex = createAsyncMutex()

  async function cleanupStaleTempFiles(): Promise<void> {
    for (const dirPath of [argusRoot, sessionsDirPath]) {
      let entries: string[]

      try {
        entries = await readdir(dirPath)
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.endsWith(".tmp")) {
          continue
        }

        try {
          await rm(join(dirPath, entry), { force: true })
        } catch (error) {
          logger.warn(`Failed to remove stale tmp state file ${entry}`, error)
        }
      }
    }
  }

  const startupCleanup = cleanupStaleTempFiles()

  async function deriveConsistentState(state: AuditState): Promise<ConsistentStateResult> {
    if (!state.sessionId || !state.projectDir) {
      return {
        state,
        sourceOfTruth: "snapshot",
        repaired: false,
      }
    }

    try {
      const events = await readEvents(state.sessionId, state.projectDir, resolver)
      const lastEventSeq = events.at(-1)?.seq ?? 0
      const eventStreamHash = stableHash(events)

      if (events.length === 0) {
        return {
          state,
          sourceOfTruth: "events",
          lastEventSeq,
          eventStreamHash,
          repaired: false,
        }
      }

      const projectedCore = projectCoreState(state, events)
      const repaired = hasProjectedCoreMismatch(state, projectedCore)

      return {
        state: repaired
          ? {
              ...state,
              ...projectedCore,
            }
          : state,
        sourceOfTruth: "events",
        lastEventSeq,
        eventStreamHash,
        repaired,
      }
    } catch (error) {
      logger.warn(
        `Failed to derive state from events for run ${state.sessionId}; using snapshot fallback`,
        error,
      )
      return {
        state,
        sourceOfTruth: "snapshot",
        repaired: false,
      }
    }
  }

  function bindSession(sessionId: string): void {
    if (boundSessionId) {
      logger.debug(`Already bound to session ${boundSessionId}, ignoring bind for ${sessionId}`)
      return
    }
    boundSessionId = sessionId
    stateFilePath = join(sessionsDirPath, `state-${sessionId}.json`)
    try {
      mkdirSync(sessionsDirPath, { recursive: true })
    } catch {
      logger.warn(`Failed to create sessions directory: ${sessionsDirPath}`)
    }
    logger.debug(`Bound state manager to session ${sessionId}: ${stateFilePath}`)
  }

  async function load(): Promise<AuditState | null> {
    try {
      // 1. If bound to a session, try the session-scoped file first
      let readPath: string | null = null

      if (boundSessionId) {
        const sessionFile = Bun.file(stateFilePath)
        if (await sessionFile.exists()) {
          readPath = stateFilePath
        }
      }

      // 2. Bound sessions with no matching file start clean — no cross-session contamination
      if (!readPath && boundSessionId) {
        logger.info("Starting new audit session with clean state")
        return null
      }

      // 3. Unbound: scan sessions dir for most recent (backward compat)
      if (!readPath) {
        try {
          const entries = await readdir(sessionsDirPath)
          const jsonFiles = entries.filter((e) => e.startsWith("state-") && e.endsWith(".json"))

          if (jsonFiles.length > 0) {
            let newest: { name: string; mtime: number } | null = null
            for (const name of jsonFiles) {
              const filePath = join(sessionsDirPath, name)
              try {
                const s = await stat(filePath)
                const mtime = s.mtimeMs
                if (
                  !newest ||
                  mtime > newest.mtime ||
                  (mtime === newest.mtime && name > newest.name)
                ) {
                  newest = { name, mtime }
                }
              } catch {
                // Skip unreadable files
              }
            }
            if (newest) {
              readPath = join(sessionsDirPath, newest.name)
              logger.debug(
                `No session-scoped file for (unbound), falling back to newest: ${newest.name}`,
              )
            }
          }
        } catch {
          // sessions dir doesn't exist yet
        }
      }

      // 4. Unbound: try legacy shared file
      if (!readPath) {
        const resolvedPath = resolver.resolveReadPath(projectDir, STATE_FILE_NAME)
        const legacyPath = resolvedPath ?? sharedStateFilePath
        const legacyFile = Bun.file(legacyPath)
        if (await legacyFile.exists()) {
          readPath = legacyPath
          logger.debug(`Falling back to legacy shared state file: ${legacyPath}`)
        }
      }

      if (!readPath) {
        return null
      }

      const file = Bun.file(readPath)
      const content = await file.text()
      if (!content.trim()) {
        return null
      }

      const parsed: unknown = JSON.parse(content)
      if (!isPersistentAuditState(parsed)) {
        logger.warn("Persistent audit state is invalid, ignoring", readPath)
        return null
      }

      const {
        savedAt: _savedAt,
        version,
        filePath: _filePath,
        source_of_truth: snapshotSourceOfTruth,
        last_event_seq: snapshotSeq,
        event_stream_hash: snapshotEventHash,
        ...state
      } = parsed

      if (version === "1") {
        if (!state.soloditResults) {
          state.soloditResults = []
        }
        if (!state.fuzzCounterexamples) {
          state.fuzzCounterexamples = []
        }
      }

      const migratedFindingCount = migrateLegacyFindingIds(state)
      if (migratedFindingCount > 0) {
        logger.info(`Migrating ${migratedFindingCount} finding IDs to deterministic format`)
      }

      if (snapshotSeq !== undefined) {
        logger.debug(`Loaded snapshot with last_event_seq=${snapshotSeq} from ${readPath}`)
      }

      const consistent = await deriveConsistentState(state)
      const stampMismatch =
        consistent.sourceOfTruth === "events" &&
        hasSnapshotStampMismatch(
          snapshotSeq,
          snapshotEventHash,
          consistent.lastEventSeq,
          consistent.eventStreamHash,
        )

      if (consistent.repaired || stampMismatch) {
        const mismatchReason = consistent.repaired ? "projected core mismatch" : "stamp mismatch"
        logger.warn(
          `Recovered audit state from event stream for run ${state.sessionId}: ${mismatchReason}`,
        )
      } else if (snapshotSourceOfTruth === "events" && consistent.sourceOfTruth !== "events") {
        logger.warn(
          `Snapshot for run ${state.sessionId} was marked event-derived but could not be validated against events`,
        )
      }

      currentState = consistent.state
      return currentState
    } catch (err) {
      logger.warn("Failed to load persisted audit state", err)
      return null
    }
  }

  async function save(state: AuditState): Promise<void> {
    await startupCleanup
    const releaseMutex = await saveMutex.acquire()
    currentState = state

    try {
      for (let attempt = 0; attempt < MAX_SAVE_CAS_RETRIES; attempt += 1) {
        const stateToSave = currentState
        const consistent = await deriveConsistentState(stateToSave)

        if (consistent.repaired) {
          logger.debug(
            `State/core divergence detected for run ${stateToSave.sessionId}; auto-repairing`,
          )
          currentState = consistent.state
        }

        const persistentState: PersistentAuditState = {
          ...consistent.state,
          savedAt: Date.now(),
          version: STATE_VERSION,
          filePath: stateFilePath,
          source_of_truth: consistent.sourceOfTruth,
          last_event_seq: consistent.lastEventSeq,
          event_stream_hash: consistent.eventStreamHash,
        }

        const tempFilePath = `${stateFilePath}.${Date.now()}.tmp`
        const targetDir = dirname(stateFilePath)
        await mkdir(targetDir, { recursive: true })

        // Retry write+rename on ENOENT — mkdir may not have flushed to
        // disk before Bun.write attempts to use the directory.
        const ENOENT_RETRIES = 3
        for (let fsRetry = 0; fsRetry < ENOENT_RETRIES; fsRetry += 1) {
          try {
            await Bun.write(tempFilePath, `${JSON.stringify(persistentState, null, 2)}\n`)
            await rename(tempFilePath, stateFilePath)
            break
          } catch (fsErr) {
            const isEnoent =
              fsErr instanceof Error && (fsErr as NodeJS.ErrnoException).code === "ENOENT"
            if (!isEnoent || fsRetry === ENOENT_RETRIES - 1) {
              throw fsErr
            }
            // Re-create directory and retry after a brief delay
            await mkdir(targetDir, { recursive: true })
            await Bun.sleep(50)
          }
        }

        if (currentState === consistent.state) {
          return
        }
      }

      logger.warn("CAS retries exhausted after 10 attempts; using last read state")
    } catch (err) {
      logger.warn("Failed to persist audit state", err)
      throw err
    } finally {
      releaseMutex()
    }
  }

  function get(): AuditState {
    return currentState
  }

  async function update(patch: Partial<AuditState>): Promise<void> {
    currentState = {
      ...currentState,
      ...patch,
    }

    await save(currentState)
  }

  async function reset(): Promise<void> {
    currentState = createAuditState(projectDir).state
    await save(currentState)
  }

  async function archive(): Promise<void> {
    const hasContent =
      currentState.findings.length > 0 ||
      currentState.toolsExecuted.length > 0 ||
      currentState.currentPhase !== "reconnaissance"

    if (hasContent) {
      try {
        const consistent = await deriveConsistentState(currentState)
        const archivesDir = join(argusRoot, "archives")
        await mkdir(archivesDir, { recursive: true })
        const archivePath = join(archivesDir, `argus-state.${Date.now()}.json`)
        const persistentState: PersistentAuditState = {
          ...consistent.state,
          savedAt: Date.now(),
          version: STATE_VERSION,
          filePath: archivePath,
          source_of_truth: consistent.sourceOfTruth,
          last_event_seq: consistent.lastEventSeq,
          event_stream_hash: consistent.eventStreamHash,
        }
        await Bun.write(archivePath, `${JSON.stringify(persistentState, null, 2)}\n`)
      } catch {
        logger.debug("Failed to archive audit state")
      }
    }

    currentState = createAuditState(projectDir).state

    try {
      await rm(stateFilePath, { force: true })
    } catch (error) {
      logger.warn(`Failed to remove live state file after archive: ${stateFilePath}`, error)
    }
  }

  let disposed = false

  async function dispose(): Promise<void> {
    if (disposed) {
      return
    }
    disposed = true

    try {
      await save(currentState)
    } catch (err) {
      logger.warn("Failed to flush state during dispose", err)
    }
  }

  return {
    bindSession,
    load,
    save,
    get,
    update,
    reset,
    archive,
    dispose,
  }
}
