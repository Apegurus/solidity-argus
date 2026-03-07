import { createLogger } from "../shared/logger"

export interface SafeCreateHookOptions {
  critical?: boolean
}

export function safeCreateHook<T>(
  factory: () => T,
  hookName: string,
  options: SafeCreateHookOptions = {},
): T | undefined {
  const { critical = false } = options
  try {
    return factory()
  } catch (error) {
    const logger = createLogger()
    logger.error(
      `Failed to create hook "${hookName}": ${error instanceof Error ? error.message : String(error)}`,
    )
    if (critical) {
      throw error
    }
    return undefined
  }
}
