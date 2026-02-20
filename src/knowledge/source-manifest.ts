export type SourceMode = "baked-in" | "on-demand" | "hybrid"

export interface SourceManifest {
  name: string
  mode: SourceMode
  url: string
  license: string
  updateCadence: string
  lastUpdated?: string
  hash?: string
  version?: string
}

export class IngestionRegistry {
  private sources = new Map<string, SourceManifest>()

  register(manifest: SourceManifest): void {
    this.sources.set(manifest.name, manifest)
  }

  get(name: string): SourceManifest | null {
    return this.sources.get(name) ?? null
  }

  list(): SourceManifest[] {
    return Array.from(this.sources.values())
  }

  getByMode(mode: SourceMode): SourceManifest[] {
    return Array.from(this.sources.values()).filter((m) => m.mode === mode)
  }
}

export function createDefaultRegistry(): IngestionRegistry {
  const registry = new IngestionRegistry()

  registry.register({
    name: "cyfrin",
    mode: "baked-in",
    url: "https://github.com/Cyfrin/audit-checklist",
    license: "unspecified",
    updateCadence: "per-release",
  })

  registry.register({
    name: "kadenzipfel",
    mode: "baked-in",
    url: "https://github.com/kadenzipfel/smart-contract-vulnerabilities",
    license: "MIT",
    updateCadence: "per-release",
  })

  registry.register({
    name: "defifofum",
    mode: "baked-in",
    url: "https://github.com/DeFiFoFum/fofum-solidity-skills",
    license: "MIT",
    updateCadence: "per-release",
  })

  registry.register({
    name: "smartbugs",
    mode: "baked-in",
    url: "https://github.com/smartbugs/smartbugs-curated",
    license: "Apache-2.0",
    updateCadence: "per-release",
  })

  registry.register({
    name: "sunweb3sec",
    mode: "baked-in",
    url: "https://github.com/SunWeb3Sec/DeFiHackLabs",
    license: "reference-only",
    updateCadence: "per-release",
  })

  registry.register({
    name: "scvd",
    mode: "hybrid",
    url: "https://api.scvd.dev",
    license: "CC0",
    updateCadence: "on-sync",
  })

  registry.register({
    name: "trailofbits",
    mode: "hybrid",
    url: "https://github.com/trailofbits/solidity-security-research",
    license: "varies",
    updateCadence: "on-install",
  })

  registry.register({
    name: "solodit",
    mode: "on-demand",
    url: "https://solodit.xyz",
    license: "varies",
    updateCadence: "per-request",
  })

  return registry
}
