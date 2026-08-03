import {
  createAuditStateManager,
  createDebouncedSave,
} from "../features/persistent-state/audit-state-manager"
import type { AuditStateManager } from "../managers/types"

type DebouncedSave = ReturnType<typeof createDebouncedSave>

export interface SessionStateRegistry {
  getManager(sessionId: string): AuditStateManager
  getExistingManager(sessionId: string): AuditStateManager | undefined
  hasManager(sessionId: string): boolean
  getDebouncedSave(sessionId: string): DebouncedSave
  disposeDebouncedSaves(): void
  deleteSession(sessionId: string): Promise<void>
}

export function createSessionStateRegistry(options: {
  projectDir: string
  maxSessions: number
}): SessionStateRegistry {
  const { projectDir, maxSessions } = options
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new RangeError("maxSessions must be a positive integer")
  }
  const managers = new Map<string, AuditStateManager>()
  const debouncedSaves = new Map<string, DebouncedSave>()

  async function deleteSession(sessionId: string): Promise<void> {
    const debouncedSave = debouncedSaves.get(sessionId)
    if (debouncedSave) {
      // WS-3 I2: flush pending debounced saves BEFORE dispose — dispose() only clears the
      // timer, so disposing without flushing silently drops the last buffered findings/progress.
      await debouncedSave.flush()
      debouncedSave.dispose()
    }
    debouncedSaves.delete(sessionId)
    managers.delete(sessionId)
  }

  function evictOldestSessionIfNeeded(newSessionId: string): void {
    if (managers.size <= maxSessions) return

    const oldest = managers.keys().next()
    if (oldest.done) return

    const oldestSessionId = oldest.value
    if (oldestSessionId !== newSessionId) {
      // Capacity eviction keeps getManager synchronous: fire-and-forget the async
      // flush-then-dispose (still flushes before dropping the manager — I2).
      void deleteSession(oldestSessionId).catch(() => undefined)
    }
  }

  function getManager(sessionId: string): AuditStateManager {
    let manager = managers.get(sessionId)
    if (!manager) {
      manager = createAuditStateManager(projectDir)
      manager.bindSession(sessionId)
      managers.set(sessionId, manager)
      evictOldestSessionIfNeeded(sessionId)
    }

    return manager
  }

  return {
    getManager,

    getExistingManager(sessionId: string): AuditStateManager | undefined {
      return managers.get(sessionId)
    },

    hasManager(sessionId: string): boolean {
      return managers.has(sessionId)
    },

    getDebouncedSave(sessionId: string): DebouncedSave {
      let debouncedSave = debouncedSaves.get(sessionId)
      if (!debouncedSave) {
        debouncedSave = createDebouncedSave(getManager(sessionId).save)
        debouncedSaves.set(sessionId, debouncedSave)
      }
      return debouncedSave
    },

    disposeDebouncedSaves(): void {
      for (const debouncedSave of debouncedSaves.values()) {
        debouncedSave.dispose()
      }
    },

    deleteSession,
  }
}
