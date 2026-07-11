import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { z } from "zod"

class TarballVerificationError extends Error {
  override readonly name = "TarballVerificationError"
}

const ArgumentsSchema = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.string().regex(/^[0-9a-f]{40}$/),
  z.string().min(1),
])
const PackOutputSchema = z.tuple([z.looseObject({ filename: z.string().min(1) })])
const ManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  publishConfig: z.object({
    access: z.literal("public"),
    registry: z.literal("https://registry.npmjs.org/"),
  }),
})
const BuildInfoSchema = z.object({
  version: z.string(),
  commit: z.string(),
  dirty: z.boolean(),
})
const requiredFiles = [
  "package/package.json",
  "package/build-info.json",
  "package/README.md",
  "package/src/index.ts",
] as const
const forbiddenTestArtifact =
  /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i

const fail = (message: string): never => {
  throw new TarballVerificationError(message)
}

const parseJson = (text: string, label: string): unknown => {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return fail(`${label} is not valid JSON`)
  }
}

function verify(): string {
  const parsedArguments = ArgumentsSchema.safeParse(process.argv.slice(2))
  if (!parsedArguments.success)
    return fail("expected pack-json, package, version, commit, temp-dir")
  const [packJson, packageName, releaseVersion, commit, tempDir] = parsedArguments.data
  const output = PackOutputSchema.safeParse(
    parseJson(readFileSync(packJson, "utf8"), "pack output"),
  )
  if (!output.success) return fail("pack output must contain exactly one entry with a filename")
  const filename = output.data[0].filename
  if (filename !== basename(filename) || !filename.endsWith(".tgz"))
    return fail("pack filename must be a tgz basename")
  const tgz = resolve(tempDir, filename)
  if (dirname(tgz) !== resolve(tempDir)) return fail("pack destination mismatch")
  if (!existsSync(tgz)) return fail("pack tarball missing")

  const extractJson = (innerPath: string): unknown =>
    parseJson(execFileSync("tar", ["-xOf", tgz, innerPath], { encoding: "utf8" }), innerPath)
  const manifest = ManifestSchema.safeParse(extractJson("package/package.json"))
  if (!manifest.success) return fail("publishConfig mismatch")
  if (manifest.data.name !== packageName) return fail("package name mismatch")
  if (manifest.data.version !== releaseVersion) return fail("package version mismatch")
  const buildInfo = BuildInfoSchema.safeParse(extractJson("package/build-info.json"))
  if (
    !buildInfo.success ||
    buildInfo.data.version !== releaseVersion ||
    buildInfo.data.commit !== commit ||
    buildInfo.data.dirty !== false
  )
    return fail("build-info mismatch")

  const files = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split(/\r?\n/)
  if (!requiredFiles.every((file) => files.includes(file))) return fail("required files missing")
  if (files.some((file) => forbiddenTestArtifact.test(file)))
    return fail("forbidden test files packed")
  return tgz
}

try {
  process.stdout.write(verify())
} catch (error) {
  if (!(error instanceof Error)) throw error
  console.error(error.message)
  process.exitCode = 1
}
