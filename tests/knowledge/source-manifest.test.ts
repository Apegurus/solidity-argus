import { test, expect } from "bun:test"
import { readdir, readFile } from "fs/promises"
import { join } from "path"
import type { SourceManifest } from "../../src/knowledge/source-manifest"
import { createDefaultRegistry } from "../../src/knowledge/source-manifest"

const MANIFESTS_DIR = join(import.meta.dir, "../../skills/manifests")

test("manifest files exist in skills/manifests/", async () => {
  const files = await readdir(MANIFESTS_DIR)
  expect(files.length).toBeGreaterThan(0)
})

test("all 8 manifest files are present", async () => {
  const expectedManifests = [
    "cyfrin.json",
    "kadenzipfel.json",
    "defifofum.json",
    "smartbugs.json",
    "sunweb3sec.json",
    "scvd.json",
    "trailofbits.json",
    "solodit.json",
  ]

  const files = await readdir(MANIFESTS_DIR)
  for (const manifest of expectedManifests) {
    expect(files).toContain(manifest)
  }
})

test("each manifest is valid JSON", async () => {
  const files = await readdir(MANIFESTS_DIR)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  for (const file of jsonFiles) {
    const content = await readFile(join(MANIFESTS_DIR, file), "utf-8")
    expect(() => JSON.parse(content)).not.toThrow()
  }
})

test("each manifest conforms to SourceManifest type", async () => {
  const files = await readdir(MANIFESTS_DIR)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  for (const file of jsonFiles) {
    const content = await readFile(join(MANIFESTS_DIR, file), "utf-8")
    const manifest: any = JSON.parse(content)

    expect(manifest.name).toBeDefined()
    expect(typeof manifest.name).toBe("string")

    expect(manifest.mode).toBeDefined()
    expect(["baked-in", "on-demand", "hybrid"]).toContain(manifest.mode)

    expect(manifest.url).toBeDefined()
    expect(typeof manifest.url).toBe("string")

    expect(manifest.license).toBeDefined()
    expect(typeof manifest.license).toBe("string")

    expect(manifest.updateCadence).toBeDefined()
    expect(typeof manifest.updateCadence).toBe("string")

    if (manifest.lastUpdated !== undefined) {
      expect(typeof manifest.lastUpdated).toBe("string")
    }
    if (manifest.hash !== undefined) {
      expect(typeof manifest.hash).toBe("string")
    }
    if (manifest.version !== undefined) {
      expect(typeof manifest.version).toBe("string")
    }
  }
})

test("manifest names match file names", async () => {
  const files = await readdir(MANIFESTS_DIR)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  for (const file of jsonFiles) {
    const content = await readFile(join(MANIFESTS_DIR, file), "utf-8")
    const manifest: SourceManifest = JSON.parse(content)
    const expectedName = file.replace(".json", "")

    expect(manifest.name).toBe(expectedName)
  }
})

test("baked-in sources have files array", async () => {
  const bakedInSources = ["cyfrin", "kadenzipfel", "defifofum", "smartbugs", "sunweb3sec"]

  for (const source of bakedInSources) {
    const content = await readFile(join(MANIFESTS_DIR, `${source}.json`), "utf-8")
    const manifest: any = JSON.parse(content)

    expect(manifest.mode).toBe("baked-in")
    expect(Array.isArray(manifest.files || [])).toBe(true)
    expect((manifest.files || []).length).toBeGreaterThan(0)
  }
})

test("on-demand and hybrid sources have correct modes", async () => {
  const onDemandSources = ["solodit"]
  const hybridSources = ["scvd", "trailofbits"]

  for (const source of onDemandSources) {
    const content = await readFile(join(MANIFESTS_DIR, `${source}.json`), "utf-8")
    const manifest: SourceManifest = JSON.parse(content)
    expect(manifest.mode).toBe("on-demand")
  }

  for (const source of hybridSources) {
    const content = await readFile(join(MANIFESTS_DIR, `${source}.json`), "utf-8")
    const manifest: SourceManifest = JSON.parse(content)
    expect(manifest.mode).toBe("hybrid")
  }
})

test("manifest licenses are correct", async () => {
  const expectedLicenses: Record<string, string> = {
    cyfrin: "unspecified",
    kadenzipfel: "MIT",
    defifofum: "MIT",
    smartbugs: "Apache-2.0",
    sunweb3sec: "reference-only",
    scvd: "CC0",
    trailofbits: "varies",
    solodit: "varies",
  }

  for (const [source, expectedLicense] of Object.entries(expectedLicenses)) {
    const content = await readFile(join(MANIFESTS_DIR, `${source}.json`), "utf-8")
    const manifest: SourceManifest = JSON.parse(content)
    expect(manifest.license).toBe(expectedLicense)
  }
})

test("manifest URLs are valid", async () => {
  const files = await readdir(MANIFESTS_DIR)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  for (const file of jsonFiles) {
    const content = await readFile(join(MANIFESTS_DIR, file), "utf-8")
    const manifest: any = JSON.parse(content)

    expect(manifest.url).toMatch(/^https?:\/\//)
  }
})

test("createDefaultRegistry includes all 8 sources", () => {
  const registry = createDefaultRegistry()
  const sources = registry.list()

  expect(sources.length).toBe(8)

  const sourceNames = sources.map((s) => s.name).sort()
  const expectedNames = [
    "cyfrin",
    "defifofum",
    "kadenzipfel",
    "scvd",
    "smartbugs",
    "solodit",
    "sunweb3sec",
    "trailofbits",
  ].sort()

  expect(sourceNames).toEqual(expectedNames)
})

test("registry can retrieve each source by name", () => {
  const registry = createDefaultRegistry()
  const sourceNames = [
    "cyfrin",
    "kadenzipfel",
    "defifofum",
    "smartbugs",
    "sunweb3sec",
    "scvd",
    "trailofbits",
    "solodit",
  ]

  for (const name of sourceNames) {
    const source = registry.get(name)
    expect(source).not.toBeNull()
    expect(source?.name).toBe(name)
  }
})

test("registry can filter sources by mode", () => {
  const registry = createDefaultRegistry()

  const bakedIn = registry.getByMode("baked-in")
  expect(bakedIn.length).toBe(5)
  expect(bakedIn.map((s) => s.name).sort()).toEqual(
    ["cyfrin", "defifofum", "kadenzipfel", "smartbugs", "sunweb3sec"].sort()
  )

  const hybrid = registry.getByMode("hybrid")
  expect(hybrid.length).toBe(2)
  expect(hybrid.map((s) => s.name).sort()).toEqual(["scvd", "trailofbits"].sort())

  const onDemand = registry.getByMode("on-demand")
  expect(onDemand.length).toBe(1)
  expect(onDemand[0]?.name).toBe("solodit")
})

test("manifest files have lastVerified field", async () => {
  const files = await readdir(MANIFESTS_DIR)
  const jsonFiles = files.filter((f) => f.endsWith(".json"))

  for (const file of jsonFiles) {
    const content = await readFile(join(MANIFESTS_DIR, file), "utf-8")
    const manifest: any = JSON.parse(content)

    expect(manifest.lastVerified || manifest.lastUpdated).toBeDefined()
  }
})
