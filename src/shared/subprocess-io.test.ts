import { describe, expect, it } from "bun:test"
import { appendTruncationMarker, readStreamCapped } from "./subprocess-io"

function streamOf(bytes: Uint8Array, chunkSize = 4): ReadableStream<Uint8Array> {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, bytes.length)
      controller.enqueue(bytes.subarray(offset, end))
      offset = end
    },
  })
}

describe("readStreamCapped", () => {
  it("keeps all bytes when under the cap", async () => {
    const data = new TextEncoder().encode("hello world")
    const r = await readStreamCapped(streamOf(data), 1000)
    expect(r.text).toBe("hello world")
    expect(r.truncated).toBe(false)
    expect(r.omittedBytes).toBe(0)
  })

  it("caps kept bytes yet drains the whole stream (no child-write deadlock)", async () => {
    const data = new Uint8Array(10_000).fill(97)
    const r = await readStreamCapped(streamOf(data), 1000)
    expect(r.text.length).toBe(1000)
    expect(r.truncated).toBe(true)
    expect(r.omittedBytes).toBe(9000)
  })

  it("returns empty for a null stream", async () => {
    const r = await readStreamCapped(null, 1000)
    expect(r).toEqual({ text: "", truncated: false, omittedBytes: 0 })
  })

  it("appends a marker only when truncated", () => {
    expect(appendTruncationMarker({ text: "x", truncated: false, omittedBytes: 0 }, "stdout")).toBe(
      "x",
    )
    expect(
      appendTruncationMarker({ text: "x", truncated: true, omittedBytes: 5 }, "stdout"),
    ).toContain("stdout truncated: 5 bytes")
  })
})
