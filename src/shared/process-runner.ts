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
  "FOUNDRY_PROFILE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
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

// Expand an IPv6 literal (brackets/zone already stripped) to its 8 16-bit groups,
// or null if it is not parseable IPv6. Handles "::" compression and a trailing
// embedded IPv4 (e.g. ::ffff:127.0.0.1, 64:ff9b::127.0.0.1). String-prefix matching
// is not enough: `new URL()` normalizes literals into forms (e.g. ::ffff:0:7f00:1,
// 2002:7f00:1::, 64:ff9b::7f00:1) that a naive check misses, letting an internal
// destination slip past the guard (SSRF).
function ipv6Groups(input: string): number[] | null {
  if (!input.includes(":")) {
    return null
  }
  const host = input.split("%")[0] ?? input // drop any zone id (fe80::1%eth0)

  // Peel off an embedded dotted-quad IPv4 tail into two 16-bit groups.
  const v4Tail: number[] = []
  let work = host
  const dottedTail = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (dottedTail !== null) {
    const octets = [dottedTail[2], dottedTail[3], dottedTail[4], dottedTail[5]].map((o) =>
      Number(o),
    )
    if (octets.some((o) => o > 255)) {
      return null
    }
    v4Tail.push(
      ((octets[0] ?? 0) << 8) | (octets[1] ?? 0),
      ((octets[2] ?? 0) << 8) | (octets[3] ?? 0),
    )
    const prefix = dottedTail[1] ?? ""
    work = prefix.endsWith("::") ? prefix : prefix.slice(0, -1)
  }

  const parseSide = (side: string): number[] | null => {
    if (side === "") {
      return []
    }
    const groups: number[] = []
    for (const part of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) {
        return null
      }
      groups.push(Number.parseInt(part, 16))
    }
    return groups
  }

  const halves = work.split("::")
  if (halves.length > 2) {
    return null
  }
  if (halves.length === 2) {
    const left = parseSide(halves[0] ?? "")
    const right = parseSide(halves[1] ?? "")
    if (left === null || right === null) {
      return null
    }
    const fill = 8 - left.length - right.length - v4Tail.length
    if (fill < 0) {
      return null
    }
    return [...left, ...Array.from({ length: fill }, () => 0), ...right, ...v4Tail]
  }
  const only = parseSide(work.endsWith(":") ? work.slice(0, -1) : work)
  if (only === null) {
    return null
  }
  const all = [...only, ...v4Tail]
  return all.length === 8 ? all : null
}

// Extract the embedded IPv4 (dotted decimal) from an IPv6 group array for the
// prefixes that carry one: IPv4-mapped / IPv4-translated (::ffff:0:0/96), 6to4
// (2002::/16), and the NAT64 well-known prefix (64:ff9b::/96). null otherwise.
function embeddedIpv4(g: readonly number[]): string | null {
  const dq = (hi: number, lo: number): string =>
    `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g
  if (g0 === 0x2002) {
    return dq(g1 ?? 0, g2 ?? 0) // 6to4: embedded IPv4 is the second and third groups
  }
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return dq(g6 ?? 0, g7 ?? 0) // NAT64 well-known prefix
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0) {
    // IPv4-mapped (::ffff:x) or the deprecated IPv4-translated (::ffff:0:x) SIIT form
    if ((g4 === 0 && g5 === 0xffff) || (g4 === 0xffff && g5 === 0)) {
      return dq(g6 ?? 0, g7 ?? 0)
    }
  }
  return null
}

function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (h === "localhost" || h.endsWith(".localhost")) {
    return true
  }
  if (isPrivateIpv4(h)) {
    return true
  }
  const groups = ipv6Groups(h)
  if (groups === null) {
    return false
  }
  if (groups.every((g) => g === 0)) {
    return true // :: unspecified
  }
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
    return true // ::1 loopback
  }
  const embedded = embeddedIpv4(groups)
  if (embedded !== null && isPrivateIpv4(embedded)) {
    return true
  }
  const g0 = groups[0] ?? 0
  return (
    (g0 & 0xfe00) === 0xfc00 || // ULA fc00::/7
    (g0 & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (g0 & 0xffc0) === 0xfec0 // deprecated site-local fec0::/10
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
