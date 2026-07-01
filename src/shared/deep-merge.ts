const deduplicateObjectIds = new WeakMap<object, number>()
let nextDeduplicateObjectId = 1

function getDeduplicateObjectKey(obj: object): string {
  let id = deduplicateObjectIds.get(obj)
  if (id === undefined) {
    id = nextDeduplicateObjectId++
    deduplicateObjectIds.set(obj, id)
  }
  return `object:${id}`
}

function deduplicateArray(arr: unknown[]): unknown[] {
  const seen = new Set<string>()
  const result: unknown[] = []

  for (const item of arr) {
    let key: string
    if (typeof item === "object" && item !== null) {
      try {
        key = `object:${JSON.stringify(item)}`
      } catch {
        key = getDeduplicateObjectKey(item)
      }
    } else {
      key = `${typeof item}:${String(item)}`
    }

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

// Keys that, if merged, would let lower-trust config (a project/repo JSON) reach
// the prototype chain (prototype pollution). They are never read or written here.
const UNSAFE_MERGE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

export function deepMerge(target: unknown, source: unknown): unknown {
  if (source === undefined) {
    return target
  }

  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null
  ) {
    return source
  }

  if (Array.isArray(target) && Array.isArray(source)) {
    return deduplicateArray([...target, ...source])
  }

  if (Array.isArray(target) || Array.isArray(source)) {
    return source
  }

  const tgt = target as Record<string, unknown>
  const src = source as Record<string, unknown>
  // Rebuild the target into a NULL-prototype object rather than spreading: this drops
  // any own "__proto__"/"constructor"/"prototype" smuggled in via JSON.parse AND makes
  // a downstream `key in merged` check read only own keys, never a polluted
  // Object.prototype.
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(tgt)) {
    if (!UNSAFE_MERGE_KEYS.has(key)) {
      result[key] = tgt[key]
    }
  }

  for (const key of Object.keys(src)) {
    // Reject prototype-pollution keys: never read or assign __proto__/constructor/prototype.
    if (UNSAFE_MERGE_KEYS.has(key)) {
      continue
    }

    const sourceValue = src[key]
    if (sourceValue === undefined) {
      continue
    }

    const existing = result[key]
    if (
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing) &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue)
    ) {
      result[key] = deepMerge(existing, sourceValue)
    } else if (Array.isArray(existing) && Array.isArray(sourceValue)) {
      result[key] = deduplicateArray([...existing, ...sourceValue])
    } else {
      result[key] = sourceValue
    }
  }

  return result
}
