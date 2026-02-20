import { expect, test } from "bun:test";
import type { ToolContext } from "@opencode-ai/plugin";
import { executeProxyDetection, proxyDetectionTool } from "./proxy-detection-tool";

function createContext(): { context: ToolContext; metadataCalls: Array<{ title?: string }> } {
  const metadataCalls: Array<{ title?: string }> = [];
  const abortController = new AbortController();
  const context: ToolContext = {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "argus",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: abortController.signal,
    metadata(input) {
      metadataCalls.push({ title: input.title });
    },
    async ask() {
      return;
    },
  };
  return { context, metadataCalls };
}

test("proxyDetectionTool uses tool() helper contract", () => {
  expect(proxyDetectionTool.description.length).toBeGreaterThan(0);
  expect(proxyDetectionTool.args).toBeDefined();
  expect(typeof proxyDetectionTool.execute).toBe("function");
});

test("detects ERC1967 storage slot indicators", async () => {
  const { context, metadataCalls } = createContext();
  const source = `
  contract ProxySlots {
    bytes32 internal constant _IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant _ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant _BEACON_SLOT = 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
  }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/ProxySlots.sol" },
    context,
    async () => source
  );

  expect(result.isProxy).toBe(true);
  expect(result.proxyType).toBe("erc1967");
  expect(result.indicators).toEqual(
    expect.arrayContaining([
      "erc1967-implementation-slot",
      "erc1967-admin-slot",
      "erc1967-beacon-slot",
    ])
  );
  expect(result.confidence).toBe("high");
  expect(metadataCalls[0]?.title).toContain("Detect proxy patterns");
});

test("detects delegatecall and fallback proxy pattern", async () => {
  const { context } = createContext();
  const source = `
  contract GenericProxy {
    fallback() external payable {
      (bool ok, ) = address(this).delegatecall(msg.data);
      require(ok);
    }
  }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/GenericProxy.sol" },
    context,
    async () => source
  );

  expect(result.isProxy).toBe(true);
  expect(result.proxyType).toBe("erc1967");
  expect(result.indicators).toEqual(
    expect.arrayContaining(["delegatecall", "fallback-function"])
  );
  expect(result.confidence).toBe("medium");
});

test("detects UUPS pattern indicators", async () => {
  const { context } = createContext();
  const source = `
  import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
  contract Vault is UUPSUpgradeable {
    function upgradeToAndCall(address impl, bytes memory data) external {}
    function _authorizeUpgrade(address) internal override {}
  }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/UUPSVault.sol" },
    context,
    async () => source
  );

  expect(result.isProxy).toBe(true);
  expect(result.proxyType).toBe("uups");
  expect(result.indicators).toEqual(
    expect.arrayContaining(["uups-authorize-upgrade", "uups-upgrade-to-and-call", "uups-upgradeable"])
  );
  expect(result.confidence).toBe("high");
});

test("detects diamond pattern indicators", async () => {
  const { context } = createContext();
  const source = `
  interface IDiamondCut { function diamondCut(bytes[] calldata cuts, address init, bytes calldata data) external; }
  interface IDiamondLoupe { function facetAddress(bytes4 selector) external view returns (address); }
  contract Diamond {
    event DiamondCut(bytes[] _diamondCut, address _init, bytes _calldata);
    function facetAddress(bytes4 selector) external view returns (address) {}
  }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/Diamond.sol" },
    context,
    async () => source
  );

  expect(result.isProxy).toBe(true);
  expect(result.proxyType).toBe("diamond");
  expect(result.indicators).toEqual(
    expect.arrayContaining(["diamond-cut", "diamond-loupe", "facet-address"])
  );
});

test("detects beacon pattern indicators", async () => {
  const { context } = createContext();
  const source = `
  import "@openzeppelin/contracts/proxy/beacon/IBeacon.sol";
  import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
  contract BProxy is BeaconProxy {}
  contract BImpl { function beacon() external view returns (IBeacon) {} }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/Beacon.sol" },
    context,
    async () => source
  );

  expect(result.isProxy).toBe(true);
  expect(result.proxyType).toBe("beacon");
  expect(result.indicators).toEqual(
    expect.arrayContaining(["beacon-interface", "beacon-proxy"])
  );
});

test("returns non-proxy result with empty indicators", async () => {
  const { context } = createContext();
  const source = `
  contract Token {
    string public name = "Token";
    function mint(address to, uint256 amount) external {}
  }
  `;

  const result = await executeProxyDetection(
    { file_path: "contracts/Token.sol" },
    context,
    async () => source
  );

  expect(result).toEqual({
    file: "contracts/Token.sol",
    isProxy: false,
    proxyType: null,
    indicators: [],
    confidence: "low",
  });
});

test("handles file-not-found without crashing", async () => {
  const { context } = createContext();

  const result = await executeProxyDetection(
    { file_path: "contracts/Missing.sol" },
    context,
    async () => {
      const error = new Error("ENOENT") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    }
  );

  expect(result.isProxy).toBe(false);
  expect(result.proxyType).toBeNull();
  expect(result.indicators).toEqual([]);
  expect(result.error).toContain("File not found: contracts/Missing.sol");
});
