import type { Hooks as PluginHooks } from "@opencode-ai/plugin"

type ChatParamsInput = Parameters<NonNullable<PluginHooks["chat.params"]>>[0] & {
  agent?: string
}
type ChatMessageInput = Parameters<NonNullable<PluginHooks["chat.message"]>>[0]

const ARGUS_FAMILY = new Set(["argus", "sentinel", "pythia", "scribe"])

export type AgentTracker = ReturnType<typeof createAgentTracker>

export function createAgentTracker() {
  const sessions = new Map<string, string>()
  const childSessions = new Map<string, Set<string>>()
  const parentByChild = new Map<string, string>()

  const trackSession = (sessionID: string, agent?: string): void => {
    if (!agent) {
      return
    }

    sessions.set(sessionID, agent)
  }

  return {
    chatParamsHook: (input: ChatParamsInput): void => {
      trackSession(input.sessionID, input.agent)
    },

    chatMessageHook: (input: ChatMessageInput): void => {
      trackSession(input.sessionID, input.agent)
    },

    getAgentForSession: (sessionID: string): string | undefined => {
      return sessions.get(sessionID)
    },

    isArgusAgent: (sessionID: string): boolean => {
      const agent = sessions.get(sessionID)
      if (!agent) {
        return false
      }

      return ARGUS_FAMILY.has(agent)
    },

    clearSession: (sessionID: string): void => {
      sessions.delete(sessionID)
      const children = childSessions.get(sessionID)
      if (children) {
        for (const child of children) {
          parentByChild.delete(child)
        }
      }
      childSessions.delete(sessionID)
    },

    getTrackedSessions: (): Map<string, string> => {
      return sessions
    },

    trackChildSession: (parentSessionId: string, childSessionId: string): void => {
      let children = childSessions.get(parentSessionId)
      if (!children) {
        children = new Set()
        childSessions.set(parentSessionId, children)
      }
      children.add(childSessionId)
      parentByChild.set(childSessionId, parentSessionId)
    },

    getChildSessions: (parentSessionId: string): string[] => {
      const children = childSessions.get(parentSessionId)
      return children ? Array.from(children) : []
    },

    getParentSession: (childSessionId: string): string | undefined => {
      return parentByChild.get(childSessionId)
    },
  }
}
