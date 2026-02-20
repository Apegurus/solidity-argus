function deduplicateArray(arr: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const item of arr) {
    const key = typeof item === "object" && item !== null
      ? JSON.stringify(item)
      : `${typeof item}:${String(item)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

export function deepMerge(target: unknown, source: unknown): unknown {
  if (source === undefined) {
    return target;
  }

  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null
  ) {
    return source;
  }

  if (Array.isArray(target) && Array.isArray(source)) {
    return deduplicateArray([...target, ...source]);
  }

  if (Array.isArray(target) || Array.isArray(source)) {
    return source;
  }

  const tgt = target as Record<string, unknown>;
  const src = source as Record<string, unknown>;
  const result: Record<string, unknown> = { ...tgt };

  for (const key in src) {
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      const sourceValue = src[key];

      if (sourceValue === undefined) {
        continue;
      }

      if (
        typeof result[key] === "object" &&
        result[key] !== null &&
        !Array.isArray(result[key]) &&
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue)
      ) {
        result[key] = deepMerge(result[key], sourceValue);
      } else if (
        Array.isArray(result[key]) &&
        Array.isArray(sourceValue)
      ) {
        result[key] = deduplicateArray([...(result[key] as unknown[]), ...sourceValue]);
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result;
}
