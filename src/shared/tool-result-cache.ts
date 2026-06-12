export type ToolResultCache = {
  set(sessionId: string, tool: string, result: string): void
  take(sessionId: string, tool: string): string | undefined
  size(): number
}

const DEFAULT_MAX_ENTRIES = 64
const SINGLETON_KEY = Symbol.for("solidity-argus:tool-result-cache")

function makeKey(sessionId: string, tool: string): string {
  return `${sessionId}\u0000${tool}`
}

export function createToolResultCache(maxEntries: number = DEFAULT_MAX_ENTRIES): ToolResultCache {
  const cap = Math.max(1, maxEntries)
  const store = new Map<string, string>()

  return {
    set(sessionId, tool, result) {
      const key = makeKey(sessionId, tool)
      store.delete(key)
      store.set(key, result)
      while (store.size > cap) {
        const oldest = store.keys().next().value
        if (oldest === undefined) break
        store.delete(oldest)
      }
    },
    take(sessionId, tool) {
      const key = makeKey(sessionId, tool)
      const value = store.get(key)
      if (value !== undefined) store.delete(key)
      return value
    },
    size() {
      return store.size
    },
  }
}

export function getToolResultCache(): ToolResultCache {
  const globals = globalThis as unknown as Record<symbol, ToolResultCache | undefined>
  let cache = globals[SINGLETON_KEY]
  if (!cache) {
    cache = createToolResultCache()
    globals[SINGLETON_KEY] = cache
  }
  return cache
}
