import { expect, spyOn, test } from "bun:test"
import { extractContractInfo, extractJson } from "./solidity-parser"

// Mock ABI output from forge inspect
const mockABIOutput = JSON.stringify([
  {
    type: "function",
    name: "deposit",
    inputs: [],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transferOwnership",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "Deposit",
    inputs: [{ name: "user", type: "address", indexed: true }],
  },
])

const mockStorageLayoutOutput = JSON.stringify({
  storage: [
    {
      astId: 1,
      contract: "TestContract",
      label: "balance",
      offset: 0,
      slot: "0",
      type: "t_uint256",
    },
    {
      astId: 2,
      contract: "TestContract",
      label: "owner",
      offset: 0,
      slot: "1",
      type: "t_address",
    },
  ],
  types: {
    t_uint256: {
      encoding: "inplace",
      label: "uint256",
      numberOfBytes: "32",
    },
    t_address: {
      encoding: "inplace",
      label: "address",
      numberOfBytes: "20",
    },
  },
})

test("extractJson returns the complete JSON segment with trailing output ignored", () => {
  expect(extractJson('forge logs\n{"success":true,"tests":[]}\nmore logs', "{")).toBe(
    '{"success":true,"tests":[]}',
  )
})

test("extractJson does not return a chopped JSON segment", () => {
  expect(extractJson('forge logs\n{"success":true,"tests":[', "{")).toBe("")
})

const mockAccessControlABIOutput = JSON.stringify([
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
])

const mockCustomAccessControlABIOutput = JSON.stringify([
  {
    type: "function",
    name: "onlyAdmin",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "requireAdmin",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
])

function mockSpawnResult(stdout: string, stderr: string, exitCode: number) {
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stdout))
        controller.close()
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(stderr))
        controller.close()
      },
    }),
    pid: 0,
    kill: () => {},
  }
}

function createSpawnMock(abiOutput: string, storageOutput: string, success = true) {
  return (cmd: string[] | unknown) => {
    const args = cmd as string[]
    if (args.includes("abi")) {
      return mockSpawnResult(abiOutput, "", success ? 0 : 1)
    }
    if (args.includes("storage-layout")) {
      return mockSpawnResult(storageOutput, "", success ? 0 : 1)
    }
    return mockSpawnResult("", "Unknown command", 1)
  }
}

test("extractContractInfo - parses basic contract with ownable pattern", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(mockABIOutput, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("TestContract", "/test/project")

    expect(result.name).toBe("TestContract")
    expect(result.functions.length).toBeGreaterThan(0)
    expect(result.accessControlPattern).toBe("ownable")
    expect(result.error).toBeUndefined()

    // Check that deposit function is parsed
    const depositFunc = result.functions.find((f) => f.name === "deposit")
    expect(depositFunc).toBeDefined()
    expect(depositFunc?.mutability).toBe("payable")

    // Check that owner function is parsed
    const ownerFunc = result.functions.find((f) => f.name === "owner")
    expect(ownerFunc).toBeDefined()
    expect(ownerFunc?.mutability).toBe("view")
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - detects access-control pattern", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(mockAccessControlABIOutput, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("AccessControlContract", "/test/project")

    expect(result.accessControlPattern).toBe("access-control")
    expect(result.error).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - detects custom access control pattern", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(mockCustomAccessControlABIOutput, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("CustomAccessContract", "/test/project")

    expect(result.accessControlPattern).toBe("custom")
    expect(result.error).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - handles forge error gracefully", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation((() =>
    mockSpawnResult("", "Error: Contract not found", 1)) as unknown as typeof Bun.spawn)

  try {
    const result = await extractContractInfo("NonExistentContract", "/test/project")

    expect(result.error).toBeDefined()
    expect(result.error).toContain("Error")
    expect(result.functions).toEqual([])
    expect(result.stateVars).toEqual([])
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - maps stateMutability to visibility correctly", async () => {
  const abiWithAllMutabilities = JSON.stringify([
    {
      type: "function",
      name: "pureFunc",
      inputs: [],
      outputs: [],
      stateMutability: "pure",
    },
    {
      type: "function",
      name: "viewFunc",
      inputs: [],
      outputs: [],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "nonpayableFunc",
      inputs: [],
      outputs: [],
      stateMutability: "nonpayable",
    },
    {
      type: "function",
      name: "payableFunc",
      inputs: [],
      outputs: [],
      stateMutability: "payable",
    },
  ])

  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(abiWithAllMutabilities, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("MutabilityTest", "/test/project")

    const pureFunc = result.functions.find((f) => f.name === "pureFunc")
    expect(pureFunc?.visibility).toBe("view")
    expect(pureFunc?.mutability).toBe("pure")

    const viewFunc = result.functions.find((f) => f.name === "viewFunc")
    expect(viewFunc?.visibility).toBe("view")
    expect(viewFunc?.mutability).toBe("view")

    const nonpayableFunc = result.functions.find((f) => f.name === "nonpayableFunc")
    expect(nonpayableFunc?.visibility).toBe("external")
    expect(nonpayableFunc?.mutability).toBe("nonpayable")

    const payableFunc = result.functions.find((f) => f.name === "payableFunc")
    expect(payableFunc?.visibility).toBe("external")
    expect(payableFunc?.mutability).toBe("payable")
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - parses state variables from storage layout", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(mockABIOutput, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("TestContract", "/test/project")

    expect(result.stateVars.length).toBeGreaterThan(0)

    const balanceVar = result.stateVars.find((v) => v.name === "balance")
    expect(balanceVar).toBeDefined()
    expect(balanceVar?.type).toBe("uint256")

    const ownerVar = result.stateVars.find((v) => v.name === "owner")
    expect(ownerVar).toBeDefined()
    expect(ownerVar?.type).toBe("address")
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - handles invalid JSON gracefully", async () => {
  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock("invalid json {", "invalid json {") as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("BadJSON", "/test/project")

    expect(result.error).toBeDefined()
    expect(result.functions).toEqual([])
    expect(result.stateVars).toEqual([])
  } finally {
    spy.mockRestore()
  }
})

test("extractContractInfo - returns default none pattern when no access control detected", async () => {
  const simpleABI = JSON.stringify([
    {
      type: "function",
      name: "getValue",
      inputs: [],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ])

  const spy = spyOn(Bun, "spawn").mockImplementation(
    createSpawnMock(simpleABI, mockStorageLayoutOutput) as typeof Bun.spawn,
  )

  try {
    const result = await extractContractInfo("SimpleContract", "/test/project")

    expect(result.accessControlPattern).toBe("none")
    expect(result.error).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})
