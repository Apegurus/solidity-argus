import { beforeEach } from "bun:test"
import { join } from "node:path"

process.env.NODE_ENV = "test"
process.env.ARGUS_CACHE_DIR ??= join("/tmp", `solidity-argus-test-cache-${process.pid}`)

beforeEach(() => {
  const lockKey = Symbol.for("solidity-argus:instance-lock")
  delete (globalThis as unknown as Record<symbol, unknown>)[lockKey]
})
