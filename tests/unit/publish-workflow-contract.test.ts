import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"

type MapValue = Record<string, unknown>

const workflowPath = join(import.meta.dir, "..", "..", ".github", "workflows", "publish.yml")
const pins = {
  checkout: "9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  node: "48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
  bun: "0c5077e51419868618aeaa5fe8019c62421857d6",
  upload: "ea165f8d65b6e75b540449e92b4886f43607fa02",
  download: "d3f86a106a0bac45b974a628896c90dbdf5c8093",
} as const

const map = (value: unknown, label: string): MapValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be a mapping`)
  return Object.fromEntries(Object.entries(value))
}
const text = (value: unknown): string => JSON.stringify(value) ?? ""
const steps = (job: MapValue): readonly MapValue[] => {
  if (!Array.isArray(job.steps)) throw new Error("job.steps must be an array")
  return job.steps.map((step, index) => map(step, `steps[${index}]`))
}
const step = (items: readonly MapValue[], pattern: RegExp): MapValue => {
  const found = items.find((candidate) => pattern.test(text(candidate)))
  if (!found) throw new Error(`step not found: ${String(pattern)}`)
  return found
}
const run = (item: MapValue): string => {
  if (typeof item.run !== "string") throw new Error("step.run must be a string")
  return item.run
}
const load = (): MapValue =>
  map(parseYaml(readFileSync(workflowPath, "utf8").replace(/\n(\s*['"])/g, "\\n$1")), "workflow")

describe("publish workflow contract", () => {
  test("Given the workflow When parsed Then verification and publishing have separate least privileges", () => {
    const workflow = load()
    expect(workflow.concurrency).toEqual({
      group: "solidity-argus-publish",
      queue: "max",
      "cancel-in-progress": false,
    })
    const jobs = map(workflow.jobs, "jobs")
    const verify = map(jobs.verify, "verify")
    const publish = map(jobs.publish, "publish")
    expect(map(verify.permissions, "verify.permissions")).toEqual({ contents: "read" })
    expect(map(publish.permissions, "publish.permissions")).toEqual({
      contents: "read",
      "id-token": "write",
    })
    expect(publish.needs).toBe("verify")
    expect(text(verify)).not.toContain("id-token")
  })

  test("Given the verify job When inspected Then it gates, packs once, verifies, and uploads only the tgz", () => {
    const verify = map(map(load().jobs, "jobs").verify, "verify")
    const items = steps(verify)
    expect(step(items, /actions\/checkout@/).uses).toBe(`actions/checkout@${pins.checkout}`)
    expect(step(items, /actions\/setup-node@/).uses).toBe(`actions/setup-node@${pins.node}`)
    expect(step(items, /oven-sh\/setup-bun@/).uses).toBe(`oven-sh/setup-bun@${pins.bun}`)
    expect(text(verify)).toContain("bun install --frozen-lockfile")
    expect(text(verify)).toContain("bun run ci")
    expect(text(verify)).toContain("bun run typecheck")
    expect(text(verify)).toContain("bun test")
    expect(text(verify).match(/npm pack --ignore-scripts/g)).toHaveLength(1)
    expect(text(verify)).toContain("scripts/verify-release-tarball.ts")
    const upload = step(items, /actions\/upload-artifact@/)
    expect(upload.uses).toBe(`actions/upload-artifact@${pins.upload}`)
    expect(map(upload.with, "upload.with")).toEqual({
      name: "release-tarball",
      path: "$" + "{{ steps.pack.outputs.tgz }}",
      "if-no-files-found": "error",
      "retention-days": 1,
      overwrite: false,
    })
  })

  test("Given the OIDC publish job When inspected Then it only downloads, validates, preflights, and publishes", () => {
    const publish = map(map(load().jobs, "jobs").publish, "publish")
    const items = steps(publish)
    const body = text(publish)
    expect(step(items, /actions\/download-artifact@/).uses).toBe(
      `actions/download-artifact@${pins.download}`,
    )
    const node = step(items, /actions\/setup-node@/)
    expect(node.uses).toBe(`actions/setup-node@${pins.node}`)
    expect(map(node.with, "node.with")).toEqual({
      "node-version": "24.18.0",
      "registry-url": "https://registry.npmjs.org/",
      "package-manager-cache": false,
    })
    for (const forbidden of [
      "actions/checkout",
      "setup-bun",
      "bun install",
      "bun run",
      "scripts/",
      "npm pack",
    ])
      expect(body).not.toContain(forbidden)
    const validate = run(step(items, /Validate release artifact/))
    expect(validate).toContain("node <<'NODE'")
    expect(validate).toContain("package/package.json")
    expect(validate).toContain("package/build-info.json")
    expect(validate).toContain("GITHUB_REF_NAME")
    expect(validate).toContain("GITHUB_SHA")
    expect(validate).toContain("GITHUB_RUN_ID")
    expect(validate).toContain('manifest.publishConfig?.access !== "public"')
    expect(validate).toContain('manifest.publishConfig?.registry !== "https://registry.npmjs.org/"')
    const preflightIndex = items.findIndex((item) => item.name === "Registry preflight")
    const publishIndex = items.findIndex((item) => item.name === "Publish release tarball")
    expect(preflightIndex).toBeGreaterThanOrEqual(0)
    expect(publishIndex).toBe(preflightIndex + 1)
    expect(run(items[publishIndex] ?? {})).toBe(
      'timeout --preserve-status 10m npm publish "$TGZ" --ignore-scripts --access public --provenance --tag "$TAG" --registry https://registry.npmjs.org/',
    )
  })

  test("Given the repository manifest When inspected Then its stable version source is exact semver", () => {
    const manifestPath = join(import.meta.dir, "..", "..", "package.json")
    const manifest = map(JSON.parse(readFileSync(manifestPath, "utf8")), "package.json")
    expect(manifest.version).toBe("0.8.0")
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("Given the workflow When inspected Then token secrets and alternate triggers are absent", () => {
    const body = text(load())
    for (const forbidden of ["NODE_AUTH_TOKEN", "NPM_TOKEN", "pull_request", "workflow_run"])
      expect(body).not.toContain(forbidden)
  })
})
