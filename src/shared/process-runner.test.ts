import { expect, test } from "bun:test"
import {
  assertAllowedHost,
  buildSafeEnv,
  ProcessRunnerError,
  runTrusted,
  safeCliValue,
  validateUrlScheme,
} from "./process-runner"

const BUN = process.execPath

test("buildSafeEnv withholds non-allowlisted variables (no secret inheritance)", () => {
  process.env.ARGUS_TEST_SECRET = "super-secret"
  try {
    const env = buildSafeEnv()
    expect(env.ARGUS_TEST_SECRET).toBeUndefined()
    expect(env.PATH).toBeDefined()
  } finally {
    delete process.env.ARGUS_TEST_SECRET
  }
})

test("buildSafeEnv includes explicit extra variables", () => {
  const env = buildSafeEnv({ FOUNDRY_PROFILE: "ci" })
  expect(env.FOUNDRY_PROFILE).toBe("ci")
})

test("runTrusted runs a trusted binary and captures stdout + exit code", () => {
  const r = runTrusted({ cmd: [BUN, "-e", "console.log('ok')"], cwd: process.cwd() })
  expect(r.code).toBe(0)
  expect(r.stdout).toContain("ok")
  expect(r.timedOut).toBe(false)
  expect(r.truncated).toBe(false)
})

test("runTrusted does not inherit host secrets into the child", () => {
  process.env.ARGUS_TEST_SECRET = "leak-me"
  try {
    const r = runTrusted({
      cmd: [BUN, "-e", "console.log(process.env.ARGUS_TEST_SECRET ?? 'absent')"],
      cwd: process.cwd(),
    })
    expect(r.stdout.trim()).toBe("absent")
  } finally {
    delete process.env.ARGUS_TEST_SECRET
  }
})

test("runTrusted reports a nonzero exit code", () => {
  const r = runTrusted({ cmd: [BUN, "-e", "process.exit(3)"], cwd: process.cwd() })
  expect(r.code).toBe(3)
})

test("runTrusted enforces a timeout", () => {
  const r = runTrusted({
    cmd: [BUN, "-e", "Bun.sleepSync(5000)"],
    cwd: process.cwd(),
    timeoutMs: 200,
  })
  expect(r.timedOut).toBe(true)
})

test("runTrusted caps oversized output", () => {
  const r = runTrusted({
    cmd: [BUN, "-e", "process.stdout.write('x'.repeat(100000))"],
    cwd: process.cwd(),
    maxOutputBytes: 100,
  })
  expect(r.truncated).toBe(true)
  expect(r.stdout.length).toBeLessThanOrEqual(100)
})

test("runTrusted throws ProcessRunnerError for a missing binary", () => {
  expect(() =>
    runTrusted({ cmd: ["definitely-not-real-binary-xyz-123"], cwd: process.cwd() }),
  ).toThrow(ProcessRunnerError)
})

test("runTrusted throws for an empty command", () => {
  expect(() => runTrusted({ cmd: [], cwd: process.cwd() })).toThrow(ProcessRunnerError)
})

test("assertAllowedHost accepts a public https host", () => {
  expect(assertAllowedHost("https://api.scvd.dev/query").hostname).toBe("api.scvd.dev")
})

test("assertAllowedHost rejects loopback, private, link-local, and non-http targets", () => {
  for (const bad of [
    "http://localhost:54173",
    "http://127.0.0.1/x",
    "http://10.1.2.3/x",
    "http://192.168.0.5",
    "http://172.16.0.1",
    "http://169.254.1.1",
    "http://[::1]/x",
    "http://0.0.0.0",
    "file:///etc/passwd",
    "ftp://example.com",
  ]) {
    expect(() => assertAllowedHost(bad)).toThrow(ProcessRunnerError)
  }
})

test("assertAllowedHost rejects non-global special-purpose IPv4 ranges", () => {
  for (const bad of [
    "http://100.64.0.1/x",
    "http://100.127.255.254/x",
    "http://198.18.0.1/x",
    "http://198.19.255.1/x",
    "http://192.0.0.1/x",
    "http://192.0.2.5/x",
    "http://198.51.100.5/x",
    "http://203.0.113.5/x",
    "http://224.0.0.1/x",
    "http://240.0.0.1/x",
    "http://255.255.255.255/x",
    "http://[::ffff:100.64.0.1]/x",
  ]) {
    expect(() => assertAllowedHost(bad)).toThrow(ProcessRunnerError)
  }
})

test("assertAllowedHost still allows genuine public IPv4 adjacent to special ranges", () => {
  for (const ok of [
    "http://8.8.8.8/x",
    "http://100.63.255.255/x",
    "http://100.128.0.1/x",
    "http://198.17.255.255/x",
    "http://198.20.0.1/x",
    "http://223.255.255.255/x",
  ]) {
    expect(() => assertAllowedHost(ok)).not.toThrow()
  }
})

test("safeCliValue passes a normal value through", () => {
  expect(safeCliValue("match-path", "test/Foo.t.sol")).toBe("test/Foo.t.sol")
})

test("safeCliValue rejects an option-flag-shaped value", () => {
  expect(() => safeCliValue("fork-url", "--fork-url=http://evil")).toThrow(ProcessRunnerError)
  expect(() => safeCliValue("match", "-x")).toThrow(ProcessRunnerError)
})

test("safeCliValue rejects a NUL byte", () => {
  expect(() => safeCliValue("match", "a\0b")).toThrow(ProcessRunnerError)
})

test("safeCliValue allows a leading dash only when explicitly opted in", () => {
  expect(safeCliValue("flag", "-v", { allowLeadingDash: true })).toBe("-v")
})

test("assertAllowedHost pins to an allowlist when provided", () => {
  expect(
    assertAllowedHost("https://api.scvd.dev/x", { allowHosts: ["api.scvd.dev"] }).hostname,
  ).toBe("api.scvd.dev")
  expect(() =>
    assertAllowedHost("https://evil.example.com/x", { allowHosts: ["api.scvd.dev"] }),
  ).toThrow(ProcessRunnerError)
})

test("assertAllowedHost rejects IPv4-mapped IPv6 loopback/private literals", () => {
  for (const bad of [
    "http://[::ffff:127.0.0.1]/x",
    "http://[::ffff:10.0.0.1]/x",
    "http://[::ffff:172.16.0.1]/x",
    "http://[::ffff:192.168.0.1]/x",
    "http://[::ffff:169.254.1.1]/x",
  ]) {
    expect(() => assertAllowedHost(bad)).toThrow(ProcessRunnerError)
  }
})

test("assertAllowedHost still allows a public IPv4-mapped IPv6 host", () => {
  expect(() => assertAllowedHost("http://[::ffff:8.8.8.8]/x")).not.toThrow()
})

test("assertAllowedHost rejects alternate IPv6 encodings of loopback/private (SSRF bypass)", () => {
  for (const bad of [
    "http://[::ffff:0:127.0.0.1]/x", // IPv4-translated (SIIT) ::ffff:0:0/96 form
    "http://[::ffff:0:7f00:1]/x", // hex spelling of the same
    "http://[2002:7f00:1::]/x", // 6to4 (2002::/16) wrapping 127.0.0.1
    "http://[2002:a00:1::]/x", // 6to4 wrapping 10.0.0.1
    "http://[64:ff9b::7f00:1]/x", // NAT64 well-known prefix (64:ff9b::/96) wrapping 127.0.0.1
    "http://[64:ff9b::127.0.0.1]/x", // NAT64 dotted form
    "http://[fec0::1]/x", // deprecated site-local fec0::/10
  ]) {
    expect(() => assertAllowedHost(bad)).toThrow(ProcessRunnerError)
  }
})

test("assertAllowedHost still allows public IPv6 and 6to4/NAT64 wrapping public IPv4", () => {
  for (const ok of [
    "http://[2001:db8::1]/x", // global documentation range
    "http://[2002:808:808::]/x", // 6to4 wrapping 8.8.8.8 (public)
    "http://[64:ff9b::8.8.8.8]/x", // NAT64 wrapping public IPv4
  ]) {
    expect(() => assertAllowedHost(ok)).not.toThrow()
  }
})

test("validateUrlScheme accepts http and https", () => {
  expect(validateUrlScheme("http://localhost:8545")).toBe(true)
  expect(validateUrlScheme("https://mainnet.infura.io/v3/key")).toBe(true)
})

test("validateUrlScheme rejects non-http schemes and unparseable strings", () => {
  expect(validateUrlScheme("file:///etc/passwd")).toBe(false)
  expect(validateUrlScheme("not-a-url")).toBe(false)
})
