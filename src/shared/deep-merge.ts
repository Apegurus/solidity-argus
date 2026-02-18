export function deepMerge(target: any, source: any): any {
  // If source is undefined, return target as-is
  if (source === undefined) {
    return target;
  }

  // If either is not an object, return source (override)
  if (
    typeof target !== "object" ||
    target === null ||
    typeof source !== "object" ||
    source === null
  ) {
    return source;
  }

  // If both are arrays, concatenate and deduplicate
  if (Array.isArray(target) && Array.isArray(source)) {
    const merged = [...target, ...source];
    // Deduplicate by filtering unique values
    return Array.from(new Set(merged));
  }

  // If target is array but source is not, return source
  if (Array.isArray(target) && !Array.isArray(source)) {
    return source;
  }

  // If source is array but target is not, return source
  if (!Array.isArray(target) && Array.isArray(source)) {
    return source;
  }

  // Both are plain objects, merge recursively
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];

      // Skip undefined values from source
      if (sourceValue === undefined) {
        continue;
      }

      // If both are objects (and not arrays), recurse
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
        // Both are arrays, concatenate and deduplicate
        const merged = [...result[key], ...sourceValue];
        result[key] = Array.from(new Set(merged));
      } else {
        // Override with source value
        result[key] = sourceValue;
      }
    }
  }

  return result;
}
