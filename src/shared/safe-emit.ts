import { createLogger } from "./logger"
import { formatError } from "./format-error"
import type { AuditEvent } from "../state/schemas"
import type { EventSink } from "../features/persistent-state/event-sink"

const logger = createLogger()

export async function safeEmitToSink(
  sink: EventSink | null,
  event: AuditEvent,
  options?: { failFast?: boolean },
): Promise<void> {
  if (!sink) return
  try {
    await sink.append(event)
  } catch (error) {
    const message = `Failed to emit ${event.type} event to sink: ${formatError(error)}`
    logger.error(message)

    if (options?.failFast) {
      throw new Error(message)
    }
  }
}
