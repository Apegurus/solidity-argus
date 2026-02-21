import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AuditStateManager } from "../../managers/types"
import { createLogger } from "../../shared/logger"
import { createAuditState } from "../../state/audit-state"
import type { AuditState, PersistentAuditState } from "../../state/types"

const STATE_FILE_DIR = ".opencode"
const STATE_FILE_NAME = "argus-state.json"
const STATE_VERSION = "2"

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

export function createAuditStateManager(projectDir: string): AuditStateManager {
  const logger = createLogger()
  const stateFilePath = join(projectDir, STATE_FILE_DIR, STATE_FILE_NAME)
  let currentState: AuditState = createAuditState(projectDir).state

  async function load(): Promise<AuditState | null> {
    try {
      const file = Bun.file(stateFilePath)
      if (!(await file.exists())) {
        return null
      }

      const content = await file.text()
      if (!content.trim()) {
        return null
      }

      const parsed: unknown = JSON.parse(content)
      if (!isPersistentAuditState(parsed)) {
        logger.warn("Persistent audit state is invalid, ignoring", stateFilePath)
        return null
      }

      const { savedAt: _savedAt, version, filePath: _filePath, ...state } = parsed

      if (version === "1") {
        if (!state.soloditResults) {
          state.soloditResults = []
        }
        if (!state.fuzzCounterexamples) {
          state.fuzzCounterexamples = []
        }
      }

      currentState = state
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

        const persistentState: PersistentAuditState = {
          ...stateToSave,
          savedAt: Date.now(),
          version: STATE_VERSION,
          filePath: stateFilePath,
        }

        const tempFilePath = `${stateFilePath}.${Date.now()}.tmp`
        await mkdir(dirname(stateFilePath), { recursive: true })
        await Bun.write(tempFilePath, `${JSON.stringify(persistentState, null, 2)}\n`)
        await rename(tempFilePath, stateFilePath)

        if (currentState === stateToSave) break
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
        const archivesDir = join(dirname(stateFilePath), "archives")
        await mkdir(archivesDir, { recursive: true })
        const archivePath = join(archivesDir, `argus-state.${Date.now()}.json`)
        const persistentState: PersistentAuditState = {
          ...currentState,
          savedAt: Date.now(),
          version: STATE_VERSION,
          filePath: archivePath,
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
