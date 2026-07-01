import { realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"

/**
 * Raised when a path or identifier fails a containment / component-safety check.
 *
 * Fail-closed contract: a caller that cannot prove containment (e.g. an
 * unresolvable path, a symlink loop, a permission error) receives this error and
 * MUST treat the input as unsafe rather than proceeding.
 */
export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PathSafetyError"
  }
}

// Conservative allowlist for identifiers used as filesystem path components
// (run IDs, session IDs). Machine-generated IDs — UUIDs, `ses_...`, hex digests,
// and dotted timestamps — all satisfy this. Separators, NUL, a leading dot, an
// absolute path, and the empty string do not; `..` is rejected explicitly below.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MAX_ID_LENGTH = 255
// A path cannot have more real components than this; bounds the ancestor walk so
// the loop has no constant-true condition.
const MAX_PATH_DEPTH = 4096

function validateComponent(kind: string, id: string): string {
  if (id.length === 0 || id.length > MAX_ID_LENGTH || !SAFE_ID.test(id) || id.includes("..")) {
    throw new PathSafetyError(
      `invalid ${kind} ${JSON.stringify(id)}: must match ${String(SAFE_ID)} and contain no ".."`,
    )
  }
  return id
}

/**
 * Realpath `target`. Returns `null` on ENOENT so the caller can walk up to an
 * existing ancestor; converts every other fs error (ELOOP, EACCES, …) into a
 * {@link PathSafetyError} so containment fails closed.
 */
function tryRealpath(target: string): string | null {
  try {
    return realpathSync(target)
  } catch (err) {
    const code = err instanceof Error && "code" in err ? err.code : undefined
    if (code === "ENOENT") {
      return null
    }
    throw new PathSafetyError(
      `cannot resolve ${JSON.stringify(target)}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Canonicalize `target` by realpath-resolving its nearest existing ancestor and
 * re-appending the not-yet-existing tail. Resolving the existing prefix follows
 * intermediate symlinks — which a purely lexical `resolve` cannot — so a symlink
 * that escapes the intended root is detectable even when the final path does not
 * exist yet (e.g. a write target such as a run journal that has not been created).
 */
function canonicalize(target: string): string {
  let current = resolve(target)
  const pending: string[] = []
  for (let depth = 0; depth < MAX_PATH_DEPTH; depth++) {
    const real = tryRealpath(current)
    if (real !== null) {
      return pending.length === 0 ? real : join(real, ...pending.slice().reverse())
    }
    const parent = dirname(current)
    if (parent === current) {
      break
    }
    pending.push(basename(current))
    current = parent
  }
  return pending.length === 0 ? current : join(current, ...pending.slice().reverse())
}

/**
 * Assert that `child` resolves inside `root` after canonicalizing both (symlinks
 * resolved on the existing prefix of each). Returns the canonical child path, or
 * throws {@link PathSafetyError}. Parameter order matches the lexical
 * `path-containment` module this supersedes, so call sites migrate as a drop-in.
 *
 * TOCTOU: containment is verified at call time. A caller that then writes to the
 * returned path should re-validate the parent after creating directories, since an
 * attacker could swap a directory for an escaping symlink between check and use.
 */
export function assertContained(child: string, root: string): string {
  const canonicalRoot = canonicalize(root)
  const canonicalChild = canonicalize(resolve(canonicalRoot, child))
  const rel = relative(canonicalRoot, canonicalChild)
  if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new PathSafetyError(
      `path ${JSON.stringify(child)} resolves outside root ${JSON.stringify(root)}`,
    )
  }
  return canonicalChild
}

/**
 * Boolean form of {@link assertContained}; fail-closed — returns `false` whenever
 * containment cannot be proven (traversal, escaping symlink, or unresolvable path).
 */
export function isContained(child: string, root: string): boolean {
  try {
    assertContained(child, root)
    return true
  } catch (err) {
    if (err instanceof PathSafetyError) {
      return false
    }
    throw err
  }
}

/** Validate a run identifier used as a filesystem path component. Throws {@link PathSafetyError} on unsafe input. */
export function validateRunId(runId: string): string {
  return validateComponent("run_id", runId)
}

/** Validate a session identifier used as a filesystem path component. Throws {@link PathSafetyError} on unsafe input. */
export function validateSessionId(sessionId: string): string {
  return validateComponent("session_id", sessionId)
}

/**
 * Resolve a Forge/analysis target to a project-contained absolute path. With no
 * target, defaults to the canonical project root; a supplied target must resolve
 * inside `projectRoot`, else {@link PathSafetyError}.
 */
export function safeForgeTarget(projectRoot: string, target?: string): string {
  if (target === undefined || target.trim() === "") {
    return canonicalize(projectRoot)
  }
  return assertContained(target, projectRoot)
}

/**
 * Validate a Forge `--match-path` value: it must be a project-relative path or glob
 * that stays inside `projectRoot`. Rejects absolute paths, `..` traversal, escaping
 * symlinks, and flag-shaped values; returns the normalized relative form, or
 * `undefined` when no match path is supplied.
 */
export function safeForgeMatchPath(projectRoot: string, matchPath?: string): string | undefined {
  if (matchPath === undefined || matchPath.trim() === "") {
    return undefined
  }
  if (matchPath.startsWith("-")) {
    throw new PathSafetyError(
      `match_path ${JSON.stringify(matchPath)} may not start with '-' (option injection)`,
    )
  }
  if (isAbsolute(matchPath)) {
    throw new PathSafetyError(
      `match_path ${JSON.stringify(matchPath)} must be project-relative, not absolute`,
    )
  }
  const contained = assertContained(matchPath, projectRoot)
  const rel = relative(canonicalize(projectRoot), contained)
  return rel === "" ? "." : rel
}
