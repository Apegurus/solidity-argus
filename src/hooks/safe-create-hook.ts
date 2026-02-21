import { createLogger } from "../shared/logger"

export function safeCreateHook<T>(factory: () => T, hookName: string): T | undefined {
  try {
    return factory()
  } catch (error) {
    const logger = createLogger()
    logger.error(
      `Failed to create hook "${hookName}": ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}
