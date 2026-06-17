import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import {
  ARGUS_PLUGIN_ROOT,
  ARGUS_PLUGIN_VERSION,
  computeBuildProvenance,
  formatBuildBanner,
  formatBuildId,
  resolveBuildProvenance,
} from "./plugin-metadata"

describe("formatBuildBanner", () => {
  test("includes git sha and dirty marker when present", () => {
    expect(
      formatBuildBanner({
        version: "0.7.0-dev",
        root: "/x/argus",
        gitSha: "abc1234",
        gitDirty: true,
      }),
    ).toBe("v0.7.0-dev (abc1234+dirty) loaded from /x/argus")
  })

  test("omits the dirty marker for a clean tree", () => {
    expect(
      formatBuildBanner({
        version: "0.7.0-dev",
        root: "/x/argus",
        gitSha: "abc1234",
        gitDirty: false,
      }),
    ).toBe("v0.7.0-dev (abc1234) loaded from /x/argus")
  })

  test("omits git segment entirely when sha is unavailable (npm install)", () => {
    expect(formatBuildBanner({ version: "0.6.2", root: "/pkg/argus" })).toBe(
      "v0.6.2 loaded from /pkg/argus",
    )
  })
})

describe("resolveBuildProvenance", () => {
  test("always reports version and an absolute root containing package.json", () => {
    const provenance = resolveBuildProvenance()
    expect(provenance.version).toBe(ARGUS_PLUGIN_VERSION)
    expect(provenance.root).toBe(ARGUS_PLUGIN_ROOT)
    expect(isAbsolute(provenance.root)).toBe(true)
    expect(existsSync(join(provenance.root, "package.json"))).toBe(true)
  })

  test("git fields are well-formed when resolvable", () => {
    const { gitSha, gitDirty } = resolveBuildProvenance()
    if (gitSha !== undefined) {
      expect(gitSha).toMatch(/^[0-9a-f]{7,40}$/)
      expect(typeof gitDirty).toBe("boolean")
    } else {
      expect(gitDirty).toBeUndefined()
    }
  })
})

describe("computeBuildProvenance", () => {
  const version = "0.7.0-dev"
  const root = "/x/argus"

  test("prefers the build stamp over runtime git (published install)", () => {
    const provenance = computeBuildProvenance(version, root, {
      stamp: () => ({ commit: "5e74b08aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dirty: false }),
      gitShortSha: () => "deadbee",
      gitDirty: () => true,
    })
    expect(provenance.source).toBe("stamp")
    expect(provenance.gitSha).toBe("5e74b08aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    expect(provenance.gitDirty).toBe(false)
  })

  test("falls back to runtime git in a source worktree", () => {
    const provenance = computeBuildProvenance(version, root, {
      stamp: () => null,
      gitShortSha: () => "5e74b08",
      gitDirty: () => true,
    })
    expect(provenance.source).toBe("git")
    expect(provenance.gitSha).toBe("5e74b08")
    expect(provenance.gitDirty).toBe(true)
  })

  test("reports version-only when no commit is resolvable", () => {
    const provenance = computeBuildProvenance(version, root, {
      stamp: () => null,
      gitShortSha: () => null,
      gitDirty: () => false,
    })
    expect(provenance.source).toBe("version-only")
    expect(provenance.gitSha).toBeUndefined()
    expect(provenance.gitDirty).toBeUndefined()
  })
})

describe("formatBuildId", () => {
  test("embeds the short commit as semver build metadata", () => {
    expect(
      formatBuildId({ version: "0.7.0-dev", root: "/x", gitSha: "5e74b08", source: "git" }),
    ).toBe("0.7.0-dev+g5e74b08")
  })

  test("marks a dirty worktree", () => {
    expect(
      formatBuildId({
        version: "0.7.0-dev",
        root: "/x",
        gitSha: "5e74b08",
        gitDirty: true,
        source: "git",
      }),
    ).toBe("0.7.0-dev+g5e74b08.dirty")
  })

  test("truncates a full sha to 12 characters", () => {
    expect(
      formatBuildId({
        version: "0.7.0",
        root: "/x",
        gitSha: "5e74b08abcdef0123456789",
        source: "stamp",
      }),
    ).toBe("0.7.0+g5e74b08abcde")
  })

  test("falls back to the bare version without a commit", () => {
    expect(formatBuildId({ version: "0.6.2", root: "/x", source: "version-only" })).toBe("0.6.2")
  })
})
