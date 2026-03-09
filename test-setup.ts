import { beforeEach } from "bun:test"

process.env.NODE_ENV = "test"

beforeEach(() => {
  const lockKey = Symbol.for("solidity-argus:instance-lock")
  delete (globalThis as unknown as Record<symbol, unknown>)[lockKey]
})
