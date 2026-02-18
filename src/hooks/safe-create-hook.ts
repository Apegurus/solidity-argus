export function safeCreateHook<T>(
  factory: () => T,
  hookName: string
): T | undefined {
  try {
    return factory();
  } catch (error) {
    console.error(
      `[argus-hook-error] Failed to create hook "${hookName}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}
