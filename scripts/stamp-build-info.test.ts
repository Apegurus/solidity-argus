import { afterEach, describe, expect, test } from "bun:test"
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const BuildInfoSchema = z.object({
  version: z.string(),
  commit: z.string(),
  dirty: z.boolean(),
  builtAt: z.iso.datetime(),
})

type CommandResult = {
  readonly exitCode: number
  readonly stderr: string
}

const temporaryRoots: string[] = []

async function createSandbox(gitScript: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "argus-stamp-"))
  temporaryRoots.push(root)
  await mkdir(join(root, "scripts"))
  await mkdir(join(root, "bin"))
  await symlink(
    new URL("../../../node_modules", import.meta.url),
    join(root, "node_modules"),
    "dir",
  )
  await cp(
    new URL("./stamp-build-info.ts", import.meta.url),
    join(root, "scripts/stamp-build-info.ts"),
  )
  await writeFile(join(root, "package.json"), '{"version":"1.2.3"}\n')
  await writeFile(join(root, "bin/git"), gitScript)
  await chmod(join(root, "bin/git"), 0o755)
  return root
}

function stamp(root: string, ...args: readonly string[]): CommandResult {
  const result = Bun.spawnSync(["bun", "scripts/stamp-build-info.ts", ...args], {
    cwd: root,
    env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}` },
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, stderr: result.stderr?.toString() ?? "" }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })))
})

describe("stamp-build-info current behavior", () => {
  test("Given package and git metadata When stamping Then it writes the observable build identity", async () => {
    // Given
    const root = await createSandbox(
      '#!/bin/sh\nif [ "$1" = "rev-parse" ]; then printf "ABCDEF0123456789\\n"; else printf " M package.json\\n"; fi\n',
    )

    // When
    const result = stamp(root)

    // Then
    expect(result.exitCode, result.stderr).toBe(0)
    const buildInfo = BuildInfoSchema.parse(
      JSON.parse(await readFile(join(root, "build-info.json"), "utf8")),
    )
    expect(buildInfo).toMatchObject({ version: "1.2.3", commit: "ABCDEF0123456789", dirty: true })
    expect(result.stderr).toContain("ABCDEF0123456789 +dirty")
  })

  test("Given explicit CI identity When stamping Then manifest dirtiness cannot replace it", async () => {
    // Given
    const root = await createSandbox(
      '#!/bin/sh\nprintf "unexpected git invocation\\n" >&2\nexit 99\n',
    )

    // When
    const result = stamp(root, "--commit", "80F693BCA1234567890", "--dirty", "false")

    // Then
    expect(result.exitCode, result.stderr).toBe(0)
    const buildInfo = BuildInfoSchema.parse(
      JSON.parse(await readFile(join(root, "build-info.json"), "utf8")),
    )
    expect(buildInfo).toMatchObject({
      version: "1.2.3",
      commit: "80f693bca1234567890",
      dirty: false,
    })
    expect(result.stderr).toContain("80f693bca1234567890")
    expect(result.stderr).not.toContain("dirty")
    expect(result.stderr).not.toContain("unexpected git invocation")
  })

  test("Given an EISDIR build-info target When stamping Then it fails without claiming success", async () => {
    // Given
    const root = await createSandbox('#!/bin/sh\nprintf "unused\\n"\n')
    await mkdir(join(root, "build-info.json"))

    // When
    const result = stamp(root, "--commit", "80f693bca1234567890", "--dirty", "false")

    // Then
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain("[stamp-build-info] failed:")
    expect(result.stderr).not.toContain("build-info.json <-")
  })
})
