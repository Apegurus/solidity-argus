import { describe, it, expect } from "bun:test"
import type { SourceMode, SourceManifest } from "./source-manifest"
import { IngestionRegistry, createDefaultRegistry } from "./source-manifest"

describe("SourceManifest", () => {
  it("should have all required fields in SourceManifest type", () => {
    const manifest: SourceManifest = {
      name: "test-source",
      mode: "baked-in",
      url: "https://example.com",
      license: "MIT",
      updateCadence: "per-release",
    }

    expect(manifest.name).toBe("test-source")
    expect(manifest.mode).toBe("baked-in")
    expect(manifest.url).toBe("https://example.com")
    expect(manifest.license).toBe("MIT")
    expect(manifest.updateCadence).toBe("per-release")
  })

  it("should support optional fields (lastUpdated, hash, version)", () => {
    const manifest: SourceManifest = {
      name: "test-source",
      mode: "on-demand",
      url: "https://example.com",
      license: "CC0",
      updateCadence: "per-request",
      lastUpdated: "2026-02-19T00:00:00Z",
      hash: "abc123def456",
      version: "1.0.0",
    }

    expect(manifest.lastUpdated).toBe("2026-02-19T00:00:00Z")
    expect(manifest.hash).toBe("abc123def456")
    expect(manifest.version).toBe("1.0.0")
  })
})

describe("IngestionRegistry", () => {
  it("should register and retrieve a manifest by name", () => {
    const registry = new IngestionRegistry()
    const manifest: SourceManifest = {
      name: "test-source",
      mode: "baked-in",
      url: "https://example.com",
      license: "MIT",
      updateCadence: "per-release",
    }

    registry.register(manifest)
    const retrieved = registry.get("test-source")

    expect(retrieved).not.toBeNull()
    expect(retrieved?.name).toBe("test-source")
    expect(retrieved?.mode).toBe("baked-in")
  })

  it("should return null for unknown source", () => {
    const registry = new IngestionRegistry()
    const result = registry.get("unknown-source")

    expect(result).toBeNull()
  })

  it("should list all registered manifests", () => {
    const registry = new IngestionRegistry()
    const manifest1: SourceManifest = {
      name: "source-1",
      mode: "baked-in",
      url: "https://example1.com",
      license: "MIT",
      updateCadence: "per-release",
    }
    const manifest2: SourceManifest = {
      name: "source-2",
      mode: "on-demand",
      url: "https://example2.com",
      license: "CC0",
      updateCadence: "per-request",
    }

    registry.register(manifest1)
    registry.register(manifest2)
    const list = registry.list()

    expect(list.length).toBe(2)
    expect(list[0]!.name).toBe("source-1")
    expect(list[1]!.name).toBe("source-2")
  })

  it("should filter manifests by mode", () => {
    const registry = new IngestionRegistry()
    const bakedIn: SourceManifest = {
      name: "baked-in-source",
      mode: "baked-in",
      url: "https://example1.com",
      license: "MIT",
      updateCadence: "per-release",
    }
    const onDemand: SourceManifest = {
      name: "on-demand-source",
      mode: "on-demand",
      url: "https://example2.com",
      license: "CC0",
      updateCadence: "per-request",
    }
    const hybrid: SourceManifest = {
      name: "hybrid-source",
      mode: "hybrid",
      url: "https://example3.com",
      license: "Apache-2.0",
      updateCadence: "on-sync",
    }

    registry.register(bakedIn)
    registry.register(onDemand)
    registry.register(hybrid)

    const bakedInList = registry.getByMode("baked-in")
    const onDemandList = registry.getByMode("on-demand")
    const hybridList = registry.getByMode("hybrid")

    expect(bakedInList.length).toBe(1)
    expect(bakedInList[0]!.name).toBe("baked-in-source")

    expect(onDemandList.length).toBe(1)
    expect(onDemandList[0]!.name).toBe("on-demand-source")

    expect(hybridList.length).toBe(1)
    expect(hybridList[0]!.name).toBe("hybrid-source")
  })
})

describe("createDefaultRegistry", () => {
  it("should return a registry with all 8 known sources pre-registered", () => {
    const registry = createDefaultRegistry()
    const list = registry.list()

    expect(list.length).toBe(8)
  })

  it("should have correct mode for each known source", () => {
    const registry = createDefaultRegistry()

    const cyfrin = registry.get("cyfrin")
    const kadenzipfel = registry.get("kadenzipfel")
    const defifofum = registry.get("defifofum")
    const smartbugs = registry.get("smartbugs")
    const sunweb3sec = registry.get("sunweb3sec")
    const scvd = registry.get("scvd")
    const trailofbits = registry.get("trailofbits")
    const solodit = registry.get("solodit")

    expect(cyfrin?.mode).toBe("baked-in")
    expect(kadenzipfel?.mode).toBe("baked-in")
    expect(defifofum?.mode).toBe("baked-in")
    expect(smartbugs?.mode).toBe("baked-in")
    expect(sunweb3sec?.mode).toBe("baked-in")
    expect(scvd?.mode).toBe("hybrid")
    expect(trailofbits?.mode).toBe("hybrid")
    expect(solodit?.mode).toBe("on-demand")
  })

  it("should have correct license for each known source", () => {
    const registry = createDefaultRegistry()

    const cyfrin = registry.get("cyfrin")
    const kadenzipfel = registry.get("kadenzipfel")
    const defifofum = registry.get("defifofum")
    const smartbugs = registry.get("smartbugs")
    const sunweb3sec = registry.get("sunweb3sec")
    const scvd = registry.get("scvd")
    const trailofbits = registry.get("trailofbits")
    const solodit = registry.get("solodit")

    expect(cyfrin?.license).toBe("unspecified")
    expect(kadenzipfel?.license).toBe("MIT")
    expect(defifofum?.license).toBe("MIT")
    expect(smartbugs?.license).toBe("Apache-2.0")
    expect(sunweb3sec?.license).toBe("reference-only")
    expect(scvd?.license).toBe("CC0")
    expect(trailofbits?.license).toBe("varies")
    expect(solodit?.license).toBe("varies")
  })

  it("should have correct updateCadence for each known source", () => {
    const registry = createDefaultRegistry()

    // Baked-in sources use per-release
    expect(registry.get("cyfrin")?.updateCadence).toBe("per-release")
    expect(registry.get("kadenzipfel")?.updateCadence).toBe("per-release")
    expect(registry.get("defifofum")?.updateCadence).toBe("per-release")
    expect(registry.get("smartbugs")?.updateCadence).toBe("per-release")
    expect(registry.get("sunweb3sec")?.updateCadence).toBe("per-release")

    // Hybrid sources
    expect(registry.get("scvd")?.updateCadence).toBe("on-sync")
    expect(registry.get("trailofbits")?.updateCadence).toBe("on-install")

    // On-demand sources
    expect(registry.get("solodit")?.updateCadence).toBe("per-request")
  })

  it("should have correct URLs for each known source", () => {
    const registry = createDefaultRegistry()

    expect(registry.get("scvd")?.url).toBe("https://api.scvd.dev")
    expect(registry.get("solodit")?.url).toContain("solodit")
  })
})
