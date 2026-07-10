export const MAX_SUBPROCESS_STDOUT_BYTES = 64 * 1024 * 1024
export const MAX_SUBPROCESS_STDERR_BYTES = 2 * 1024 * 1024
export const DEFAULT_SUBPROCESS_TIMEOUT_MS = 600_000

export type CappedStream = { text: string; truncated: boolean; omittedBytes: number }

/**
 * Read a spawned child's output stream keeping at most `maxBytes`, but KEEP
 * draining past the cap so the child's pipe buffer never fills — otherwise the
 * child blocks on write and never exits (deadlock). Bounds memory against a
 * hostile/broken subprocess that emits unbounded stdout.
 */
export async function readStreamCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number,
): Promise<CappedStream> {
  if (!stream) {
    return { text: "", truncated: false, omittedBytes: 0 }
  }
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let kept = 0
  let seen = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value === undefined) {
        continue
      }
      seen += value.byteLength
      if (kept < maxBytes) {
        const room = maxBytes - kept
        if (value.byteLength <= room) {
          chunks.push(value)
          kept += value.byteLength
        } else {
          chunks.push(value.subarray(0, room))
          kept = maxBytes
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  const text = Buffer.concat(chunks).toString("utf-8")
  const omittedBytes = seen - kept
  return { text, truncated: omittedBytes > 0, omittedBytes }
}

export function appendTruncationMarker(stream: CappedStream, label: string): string {
  if (!stream.truncated) {
    return stream.text
  }
  return `${stream.text}\n[${label} truncated: ${stream.omittedBytes} bytes omitted]`
}
