import { z } from "zod"

const ReleaseVersionInputSchema = z.object({
  branch: z.enum(["staging", "main"], { error: "branch must be staging or main" }),
  runId: z.string().regex(/^[1-9]\d*$/, "run ID must be a positive integer"),
  sha: z
    .string()
    .regex(/^[0-9a-fA-F]{7,64}$/, "SHA must be 7 to 64 hexadecimal characters")
    .transform((value) => value.toLowerCase()),
  stableVersion: z
    .string()
    .regex(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
      "stable version must be a stable X.Y.Z semantic version",
    ),
})
const CliArgumentsSchema = z
  .array(z.string())
  .length(4, "arguments must contain exactly branch, run ID, SHA, and stable version")

export type ReleaseVersionInput = z.infer<typeof ReleaseVersionInputSchema>

export function deriveReleaseVersion(input: ReleaseVersionInput): string {
  switch (input.branch) {
    case "staging":
      return `${input.stableVersion}-dev.${input.runId}.g${input.sha.slice(0, 7)}`
    case "main":
      return input.stableVersion
    default: {
      const unreachable: never = input.branch
      return unreachable
    }
  }
}

function runCli(args: readonly string[]): number {
  const arity = CliArgumentsSchema.safeParse(args)
  if (!arity.success) {
    console.error(
      `[release-version] invalid input: ${arity.error.issues.map((issue) => issue.message).join("; ")}`,
    )
    return 1
  }
  const parsed = ReleaseVersionInputSchema.safeParse({
    branch: arity.data[0],
    runId: arity.data[1],
    sha: arity.data[2],
    stableVersion: arity.data[3],
  })
  if (!parsed.success) {
    console.error(
      `[release-version] invalid input: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    )
    return 1
  }
  console.log(deriveReleaseVersion(parsed.data))
  return 0
}

if (import.meta.main) {
  process.exitCode = runCli(process.argv.slice(2))
}
