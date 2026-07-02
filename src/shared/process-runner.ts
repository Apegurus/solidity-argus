import { spawnSync } from "node:child_process"

export class ProcessRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProcessRunnerError"
  }
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024

// Variables a trusted analysis binary legitimately needs. Everything else — API
// keys, tokens, cloud credentials common in OpenCode/CI — is withheld so a
// compromised, unpinned, or auto-installed tool cannot exfiltrate host secrets.
const ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "TZ",
]

export interface RunOptions {
  readonly cmd: readonly string[]
  readonly cwd: string
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly env?: Readonly<Record<string, string>>
}

export interface RunResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly truncated: boolean
}

/** Build a minimal environment from an allowlist plus explicit extras — never the full inherited `process.env`. */
export function buildSafeEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) {
      env[key] = value
    }
  }
  if (extra !== undefined) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value
    }
  }
  return env
}

/**
 * Guard a caller-supplied value that will be passed as a CLI argument so it cannot
 * be reinterpreted as an option flag (argument injection). Since {@link runTrusted}
 * runs with no shell, the residual risk is a value like `--fork-url=…` sliding into
 * flag position; reject a leading dash (unless explicitly allowed) and NUL bytes.
 */
export function safeCliValue(
  name: string,
  value: string,
  options?: { readonly allowLeadingDash?: boolean },
): string {
  if (value.includes("\0")) {
    throw new ProcessRunnerError(`${name} contains a NUL byte`)
  }
  if (value.startsWith("-") && !(options?.allowLeadingDash ?? false)) {
    throw new ProcessRunnerError(
      `${name} ${JSON.stringify(value)} may not start with '-' (option injection)`,
    )
  }
  return value
}

function cap(text: string, maxBytes: number): { text: string; truncated: boolean } {
  return text.length <= maxBytes
    ? { text, truncated: false }
    : { text: text.slice(0, maxBytes), truncated: true }
}

/**
 * Run a trusted binary one-shot with a filtered environment, a hard timeout, an
 * output cap, and no shell (args are passed literally, so no shell injection).
 * Throws {@link ProcessRunnerError} only when the process cannot be spawned;
 * timeout and output-cap are reported as flags on the result, not thrown.
 */
export function runTrusted(options: RunOptions): RunResult {
  const bin = options.cmd[0]
  if (bin === undefined) {
    throw new ProcessRunnerError("cmd must include a binary path")
  }
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  const result = spawnSync(bin, options.cmd.slice(1), {
    cwd: options.cwd,
    env: buildSafeEnv(options.env),
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: maxBytes,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  })

  const errorCode =
    result.error instanceof Error && "code" in result.error ? result.error.code : undefined
  if (errorCode !== undefined && errorCode !== "ETIMEDOUT" && errorCode !== "ENOBUFS") {
    const detail = result.error instanceof Error ? result.error.message : String(errorCode)
    throw new ProcessRunnerError(`failed to run ${JSON.stringify(bin)}: ${detail}`)
  }

  const stdout = cap(result.stdout ?? "", maxBytes)
  const stderr = cap(result.stderr ?? "", maxBytes)
  return {
    code: result.status,
    stdout: stdout.text,
    stderr: stderr.text,
    timedOut: errorCode === "ETIMEDOUT",
    truncated: errorCode === "ENOBUFS" || stdout.truncated || stderr.truncated,
  }
}

function isPrivateIpv4(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (v4 === null) {
    return false
  }
  const a = Number(v4[1])
  const b = Number(v4[2])
  return (
    a === 0 ||
    a === 127 ||
    a === 10 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

// Decode an IPv4-mapped IPv6 literal back to dotted IPv4 so the loopback/private
// checks apply. `new URL()` normalizes `::ffff:127.0.0.1` to the hex form
// `::ffff:7f00:1`, so both the dotted and hex spellings must be handled — otherwise
// `http://[::ffff:127.0.0.1]` slips past the guard (SSRF).
function mappedIpv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host)
  if (dotted !== null) {
    return dotted[1] ?? null
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (hex === null) {
    return null
  }
  const hi = Number.parseInt(hex[1] ?? "", 16)
  const lo = Number.parseInt(hex[2] ?? "", 16)
  if (Number.isNaN(hi) || Number.isNaN(lo)) {
    return null
  }
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (h === "localhost" || h.endsWith(".localhost")) {
    return true
  }
  if (h === "::" || h === "::1") {
    return true
  }
  const mapped = mappedIpv4(h)
  if (mapped !== null && isPrivateIpv4(mapped)) {
    return true
  }
  if (isPrivateIpv4(h)) {
    return true
  }
  return (
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe8") ||
    h.startsWith("fe9") ||
    h.startsWith("fea") ||
    h.startsWith("feb")
  )
}

/**
 * Parse and vet an outbound URL for a knowledge fetch (e.g. SCVD): require an
 * http/https scheme and reject loopback, link-local, and private-range host
 * literals so a malicious project config cannot point sync at an internal endpoint.
 * Pass `allowHosts` to PIN the hostname to a known set — the robust closure for a
 * fixed endpoint like SCVD, and the only defense against a public name that
 * resolves to a private address (DNS rebinding), which the lexical checks cannot see.
 */
export function assertAllowedHost(
  target: string,
  options?: { readonly allowHosts?: readonly string[] },
): URL {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    throw new ProcessRunnerError(`invalid URL ${JSON.stringify(target)}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProcessRunnerError(
      `disallowed URL scheme ${JSON.stringify(url.protocol)} — only http/https`,
    )
  }
  const hostname = url.hostname.toLowerCase()
  const allowHosts = options?.allowHosts
  if (allowHosts !== undefined && !allowHosts.some((h) => h.toLowerCase() === hostname)) {
    throw new ProcessRunnerError(
      `host ${JSON.stringify(url.hostname)} is not in the allowed host list`,
    )
  }
  if (isPrivateOrLoopbackHost(hostname)) {
    throw new ProcessRunnerError(
      `disallowed host ${JSON.stringify(url.hostname)} — loopback/link-local/private addresses are blocked`,
    )
  }
  return url
}

/** True when `url` parses and uses an http/https scheme; `false` otherwise (e.g. a Forge `--fork-url` pre-check). */
export function validateUrlScheme(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
