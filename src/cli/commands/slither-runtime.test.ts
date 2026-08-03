import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inspectSlitherPythonRuntime } from "./slither-runtime"

describe("inspectSlitherPythonRuntime", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function fakeSlitherRuntime(version: string): string {
    const dir = mkdtempSync(join(tmpdir(), "argus-slither-runtime-"))
    tempDirs.push(dir)
    const python = join(dir, "python")
    const slither = join(dir, "slither")
    writeFileSync(python, `#!/bin/sh\nprintf '${version}\\n'\n`)
    writeFileSync(slither, `#!${python}\n`)
    chmodSync(python, 0o755)
    chmodSync(slither, 0o755)
    return slither
  }

  it("accepts Slither running on Python 3.13", () => {
    expect(inspectSlitherPythonRuntime(fakeSlitherRuntime("3.13.7"), process.cwd())).toEqual({
      status: "supported",
      version: "3.13.7",
    })
  })

  it("warns when Slither runs on Python 3.14", () => {
    expect(inspectSlitherPythonRuntime(fakeSlitherRuntime("3.14.4"), process.cwd())).toEqual({
      status: "compatibility-warning",
      version: "3.14.4",
    })
  })

  it("reports an unknown runtime for a non-Python launcher", () => {
    const dir = mkdtempSync(join(tmpdir(), "argus-slither-runtime-"))
    tempDirs.push(dir)
    const slither = join(dir, "slither")
    writeFileSync(slither, "#!/bin/sh\nprintf 'Slither 0.11.5\\n'\n")
    chmodSync(slither, 0o755)

    expect(inspectSlitherPythonRuntime(slither, process.cwd()).status).toBe("unknown")
  })
})
