export type ToolResultCache = {
  set(sessionId: string, tool: string, result: string): void
  setTracking(
    sessionId: string,
    tool: string,
    displayedResult: string,
    trackingResult: string,
  ): void
  takeMatch(sessionId: string, tool: string, prefix: string): string | undefined
  takeTrackingMatch(sessionId: string, tool: string, displayedResult: string): string | undefined
  takeNext(sessionId: string, tool: string): string | undefined
  size(): number
}

const DEFAULT_MAX_ENTRIES = 64
const SINGLETON_KEY = Symbol.for("solidity-argus:tool-result-cache")

type CacheEntry = { key: string; result: string; displayedResult?: string }

function makeKey(sessionId: string, tool: string): string {
  return `${sessionId}\u0000${tool}`
}

export function createToolResultCache(maxEntries: number = DEFAULT_MAX_ENTRIES): ToolResultCache {
  const cap = Math.max(1, maxEntries)
  const entries: CacheEntry[] = []

  return {
    set(sessionId, tool, result) {
      entries.push({ key: makeKey(sessionId, tool), result })
      while (entries.length > cap) entries.shift()
    },
    setTracking(sessionId, tool, displayedResult, trackingResult) {
      entries.push({ key: makeKey(sessionId, tool), result: trackingResult, displayedResult })
      while (entries.length > cap) entries.shift()
    },
    takeMatch(sessionId, tool, prefix) {
      const key = makeKey(sessionId, tool)
      let bestIndex = -1
      let bestLength = -1
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        if (entry === undefined || entry.key !== key) continue
        if (!entry.result.startsWith(prefix)) continue
        if (entry.result.length > bestLength) {
          bestIndex = i
          bestLength = entry.result.length
        }
      }
      if (bestIndex === -1) return undefined
      const removed = entries.splice(bestIndex, 1)[0]
      return removed?.result
    },
    takeTrackingMatch(sessionId, tool, displayedResult) {
      const key = makeKey(sessionId, tool)
      const index = entries.findIndex(
        (entry) => entry.key === key && entry.displayedResult === displayedResult,
      )
      if (index === -1) return undefined
      const removed = entries.splice(index, 1)[0]
      const displayedIndex = entries.findIndex(
        (entry) =>
          entry.key === key &&
          entry.displayedResult === undefined &&
          entry.result === displayedResult,
      )
      if (displayedIndex !== -1) entries.splice(displayedIndex, 1)
      return removed?.result
    },
    takeNext(sessionId, tool) {
      const key = makeKey(sessionId, tool)
      const index = entries.findIndex((entry) => entry.key === key)
      if (index === -1) return undefined
      const removed = entries.splice(index, 1)[0]
      return removed?.result
    },
    size() {
      return entries.length
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
