export interface DependencyRisk {
  package: string;
  version: string;
  risk: "high" | "medium" | "low";
  category: string;
  recommendation: string;
}

interface DependencyInput {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parseVersion(raw: string): [number, number, number] {
  const cleaned = raw.replace(/^[^0-9]*/, "");
  if (!cleaned) {
    return [0, 0, 0];
  }
  const parts = cleaned.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  const minor = parseInt(parts[1] ?? "0", 10);
  const patch = parseInt(parts[2] ?? "0", 10);
  return [
    Number.isNaN(major) ? 0 : major,
    Number.isNaN(minor) ? 0 : minor,
    Number.isNaN(patch) ? 0 : patch,
  ];
}

function versionLt(
  raw: string,
  major: number,
  minor: number,
  patch = 0
): boolean {
  const [a, b, c] = parseVersion(raw);
  if (a !== major) return a < major;
  if (b !== minor) return b < minor;
  return c < patch;
}

export function scanDependencyRisks(input: DependencyInput): DependencyRisk[] {
  const risks: DependencyRisk[] = [];
  const deps = input.dependencies ?? {};
  const devDeps = input.devDependencies ?? {};
  const allDeps = { ...deps, ...devDeps };

  const ozVersion = deps["@openzeppelin/contracts"];
  if (ozVersion) {
    if (versionLt(ozVersion, 4, 9)) {
      risks.push({
        package: "@openzeppelin/contracts",
        version: ozVersion,
        risk: "high",
        category: "known-vulnerability",
        recommendation:
          "Upgrade to @openzeppelin/contracts >= 4.9.0 — known vulnerabilities in OZ < 4.9",
      });
    } else if (versionLt(ozVersion, 5, 0)) {
      risks.push({
        package: "@openzeppelin/contracts",
        version: ozVersion,
        risk: "low",
        category: "upgrade-available",
        recommendation:
          "Consider upgrading to OZ v5 for latest patterns and Solidity 0.8.20+ support",
      });
    }
  }

  const ozUpgradeableVersion = deps["@openzeppelin/contracts-upgradeable"];
  if (ozUpgradeableVersion) {
    const hasUpgradeTooling =
      "@openzeppelin/hardhat-upgrades" in allDeps;
    if (!hasUpgradeTooling) {
      risks.push({
        package: "@openzeppelin/contracts-upgradeable",
        version: ozUpgradeableVersion,
        risk: "medium",
        category: "missing-tooling",
        recommendation:
          "Add @openzeppelin/hardhat-upgrades to devDependencies for safe upgrade workflows",
      });
    }
  }

  const solmateVersion = deps["solmate"];
  if (solmateVersion && versionLt(solmateVersion, 6, 0)) {
    risks.push({
      package: "solmate",
      version: solmateVersion,
      risk: "medium",
      category: "outdated",
      recommendation: "Upgrade solmate to >= 6.0.0 for latest fixes",
    });
  }

  return risks;
}
