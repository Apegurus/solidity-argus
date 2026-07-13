// Writes build-info.json at pack time so published installs (no .git) can report their
// commit. Wired as the package.json "prepack" script; write failures stop the pack via exit status.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const PackageSchema = z.object({ version: z.string() })
const MetadataSourceSchema = z
  .union([
    z.tuple([]),
    z.tuple([
      z.literal("--commit"),
      z.string().regex(/^[0-9a-fA-F]{7,64}$/, "commit must be 7 to 64 hexadecimal characters"),
      z.literal("--dirty"),
      z.enum(["true", "false"]),
    ]),
  ])
  .transform((args) =>
    args.length === 0
      ? ({ kind: "git" } as const)
      : ({ kind: "explicit", commit: args[1].toLowerCase(), dirty: args[3] === "true" } as const),
  )

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000 }).trim()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return ""
  }
}

function readVersion(): string {
  try {
    const parsed = PackageSchema.safeParse(
      JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
    )
    return parsed.success ? parsed.data.version : "unknown"
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return "unknown"
  }
}

const source = MetadataSourceSchema.safeParse(process.argv.slice(2))
if (!source.success) {
  console.error(
    `[stamp-build-info] invalid input: ${source.error.issues.map((issue) => issue.message).join("; ")}`,
  )
  process.exitCode = 1
} else {
  const metadata =
    source.data.kind === "explicit"
      ? source.data
      : {
          kind: "git",
          commit: git(["rev-parse", "HEAD"]),
          dirty: git(["status", "--porcelain"]).length > 0,
        }
  const stamp = {
    version: readVersion(),
    commit: metadata.commit,
    dirty: metadata.dirty,
    builtAt: new Date().toISOString(),
  }

  try {
    writeFileSync(resolve(root, "build-info.json"), `${JSON.stringify(stamp, null, 2)}\n`)
    console.error(
      `[stamp-build-info] build-info.json <- ${metadata.commit || "(no git commit)"}${metadata.dirty ? " +dirty" : ""}`,
    )
  } catch (error) {
    console.error(
      `[stamp-build-info] failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  }
}
