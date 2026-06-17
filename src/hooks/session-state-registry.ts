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
  deleteSession(sessionId: string): void
}

export function createSessionStateRegistry(options: {
  projectDir: string
  maxSessions: number
}): SessionStateRegistry {
  const { projectDir, maxSessions } = options
  const managers = new Map<string, AuditStateManager>()
  const debouncedSaves = new Map<string, DebouncedSave>()

  function deleteSession(sessionId: string): void {
    const debouncedSave = debouncedSaves.get(sessionId)
    debouncedSave?.dispose()
    debouncedSaves.delete(sessionId)
    managers.delete(sessionId)
  }

  function evictOldestSessionIfNeeded(newSessionId: string): void {
    if (managers.size <= maxSessions) return

    const oldest = managers.keys().next()
    if (oldest.done) return

    const oldestSessionId = oldest.value
    if (oldestSessionId !== newSessionId) {
      deleteSession(oldestSessionId)
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
