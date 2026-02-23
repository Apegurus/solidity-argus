import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AuditStateManager } from "../../managers/types"
import { createLogger } from "../../shared/logger"
import { type ArgusRootResolver, defaultRootResolver } from "../../shared/path-root-resolver"
import { createAuditState } from "../../state/audit-state"
import { projectAuditState, stableHash } from "../../state/projectors"
import type { AuditState, PersistentAuditState } from "../../state/types"
import { readEvents } from "./event-sink"

const STATE_FILE_NAME = "argus-state.json"
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
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingState: AuditState | null = null

  async function persistPendingState(): Promise<void> {
    if (!pendingState) {
      return
    }

    const stateToPersist = pendingState
    pendingState = null

    try {
      await saveState(stateToPersist)
    } catch {
      createLogger().debug("Debounced state persistence failed")
    }
  }

  return {
    save(state: AuditState): void {
      pendingState = state

      if (timer) {
        clearTimeout(timer)
      }

      timer = setTimeout(() => {
        timer = null
        void persistPendingState()
      }, delayMs)
    },
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }

      await persistPendingState()
    },
  }
}

export function createAuditStateManager(
  projectDir: string,
  resolver: ArgusRootResolver = defaultRootResolver,
): AuditStateManager {
  const logger = createLogger()

  const stateFilePath = join(resolver.writeRoot(projectDir), STATE_FILE_NAME)
  let currentState: AuditState = createAuditState(projectDir).state

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

  async function load(): Promise<AuditState | null> {
    try {
      const resolvedPath = resolver.resolveReadPath(projectDir, STATE_FILE_NAME)
      const readPath = resolvedPath ?? stateFilePath

      const file = Bun.file(readPath)
      if (!(await file.exists())) {
        return null
      }

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

  let saveInFlight = false

  async function save(state: AuditState): Promise<void> {
    currentState = state

    if (saveInFlight) return
    saveInFlight = true

    try {
      while (true) {
        const stateToSave = currentState
        const consistent = await deriveConsistentState(stateToSave)

        if (consistent.repaired) {
          logger.warn(
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
        await mkdir(dirname(stateFilePath), { recursive: true })
        await Bun.write(tempFilePath, `${JSON.stringify(persistentState, null, 2)}\n`)
        await rename(tempFilePath, stateFilePath)

        if (currentState === consistent.state) break
      }
    } catch (err) {
      logger.warn("Failed to persist audit state", err)
      throw err
    } finally {
      saveInFlight = false
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
        const archivesDir = join(dirname(stateFilePath), "archives")
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
    await save(currentState)
  }

  return {
    load,
    save,
    get,
    update,
    reset,
    archive,
  }
}
