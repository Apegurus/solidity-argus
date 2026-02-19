import { test, expect, describe } from "bun:test";
import { scanDependencyRisks } from "./dependency-scanner";

describe("scanDependencyRisks", () => {
  test("flags outdated OpenZeppelin < 4.9 as high risk", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "^4.8.0",
      },
    });

    expect(risks.length).toBeGreaterThanOrEqual(1);
    const ozRisk = risks.find(
      (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
    );
    expect(ozRisk).toBeDefined();
    expect(ozRisk!.category).toBe("known-vulnerability");
    expect(ozRisk!.recommendation).toContain("4.9");
  });

  test("does not flag OpenZeppelin >= 5.0", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "^5.0.0",
      },
    });

    const ozHighRisk = risks.find(
      (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
    );
    expect(ozHighRisk).toBeUndefined();
  });

  test("flags upgradeable contracts without hardhat-upgrades as medium risk", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts-upgradeable": "^4.9.0",
      },
      devDependencies: {
        hardhat: "^2.17.0",
      },
    });

    const upgradeRisk = risks.find(
      (r) =>
        r.package === "@openzeppelin/contracts-upgradeable" &&
        r.risk === "medium"
    );
    expect(upgradeRisk).toBeDefined();
    expect(upgradeRisk!.category).toBe("missing-tooling");
    expect(upgradeRisk!.recommendation).toContain("hardhat-upgrades");
  });

  test("does not flag upgradeable when hardhat-upgrades is present", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts-upgradeable": "^4.9.0",
      },
      devDependencies: {
        "@openzeppelin/hardhat-upgrades": "^2.0.0",
      },
    });

    const upgradeRisk = risks.find(
      (r) =>
        r.package === "@openzeppelin/contracts-upgradeable" &&
        r.risk === "medium" &&
        r.category === "missing-tooling"
    );
    expect(upgradeRisk).toBeUndefined();
  });

  test("returns empty risks for empty dependencies", () => {
    const risks = scanDependencyRisks({});
    expect(risks).toEqual([]);
  });

  test("returns empty risks for undefined dependencies", () => {
    const risks = scanDependencyRisks({
      dependencies: undefined,
      devDependencies: undefined,
    });
    expect(risks).toEqual([]);
  });

  test("detects multiple risks simultaneously", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "^4.7.3",
        "@openzeppelin/contracts-upgradeable": "^4.7.3",
        solmate: "^5.0.0",
      },
      devDependencies: {
        hardhat: "^2.17.0",
      },
    });

    expect(risks.length).toBeGreaterThanOrEqual(3);

    const ozHigh = risks.find(
      (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
    );
    const upgradeMedium = risks.find(
      (r) =>
        r.package === "@openzeppelin/contracts-upgradeable" &&
        r.category === "missing-tooling"
    );
    const solmateMedium = risks.find(
      (r) => r.package === "solmate" && r.risk === "medium"
    );

    expect(ozHigh).toBeDefined();
    expect(upgradeMedium).toBeDefined();
    expect(solmateMedium).toBeDefined();
  });

  test("flags outdated solmate < 6.0 as medium risk", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        solmate: "^5.2.0",
      },
    });

    const solmateRisk = risks.find(
      (r) => r.package === "solmate" && r.risk === "medium"
    );
    expect(solmateRisk).toBeDefined();
    expect(solmateRisk!.category).toBe("outdated");
    expect(solmateRisk!.recommendation).toContain("6");
  });

  test("does not flag solmate >= 6.0", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        solmate: "^6.0.0",
      },
    });

    const solmateRisk = risks.find(
      (r) => r.package === "solmate" && r.risk === "medium"
    );
    expect(solmateRisk).toBeUndefined();
  });

  test("flags OZ < 5.0 as low risk for upgrade suggestion", () => {
    const risks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "^4.9.3",
      },
    });

    const ozHigh = risks.find(
      (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
    );
    expect(ozHigh).toBeUndefined();

    const ozLow = risks.find(
      (r) => r.package === "@openzeppelin/contracts" && r.risk === "low"
    );
    expect(ozLow).toBeDefined();
    expect(ozLow!.category).toBe("upgrade-available");
    expect(ozLow!.recommendation).toContain("v5");
  });

  test("handles caret and tilde version ranges correctly", () => {
    const caretRisks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "^4.8.0",
      },
    });
    expect(
      caretRisks.some(
        (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
      )
    ).toBe(true);

    const tildeRisks = scanDependencyRisks({
      dependencies: {
        "@openzeppelin/contracts": "~4.8.3",
      },
    });
    expect(
      tildeRisks.some(
        (r) => r.package === "@openzeppelin/contracts" && r.risk === "high"
      )
    ).toBe(true);
  });
});
