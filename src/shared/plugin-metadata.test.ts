import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import {
  ARGUS_PLUGIN_ROOT,
  ARGUS_PLUGIN_VERSION,
  formatBuildBanner,
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
