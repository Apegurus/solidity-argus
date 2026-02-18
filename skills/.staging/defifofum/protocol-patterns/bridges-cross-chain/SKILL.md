---
name: bridges-cross-chain
description: Cross-chain bridge security guidance for message verification, replay prevention, and validator risk.
---

<!-- Source: DeFiFoFum/fofum-solidity-skills (MIT) -->

# Cross-Chain Bridge Security Guide

## Overview

Bridges transfer assets/messages between blockchains. They are the highest-value targets in DeFi — $2B+ stolen from bridges. Core security concerns: message verification, validator security, and replay attacks.

---

## Architecture

```
┌─────────────────┐                      ┌─────────────────┐
│   Chain A       │                      │   Chain B       │
│                 │                      │                 │
│  ┌───────────┐  │      Message         │  ┌───────────┐  │
│  │  Bridge   │  │ ──────────────────►  │  │  Bridge   │  │
│  │ Contract  │  │                      │  │ Contract  │  │
│  └───────────┘  │                      │  └───────────┘  │
│       │         │                      │       │         │
│  Lock/Burn      │    ┌──────────────┐  │  Mint/Unlock    │
│  Tokens         │    │  Validators  │  │  Tokens         │
│                 │    │  / Relayers  │  │                 │
└─────────────────┘    └──────────────┘  └─────────────────┘
                              │
                    Sign attestations
```

---

## Critical Security Areas

### 1. Message Verification

**Attack Vectors:**
- Forged signatures
- Invalid merkle proofs
- Malformed message data

**Checklist:**
- [ ] Is signature verification correct for all edge cases?
- [ ] Are all required fields validated?
- [ ] Is the source chain verified?
- [ ] Is the source contract verified?
- [ ] Are merkle proofs validated correctly?

```solidity
// VULNERABLE: Incomplete verification
function processMessage(
    bytes32 messageHash,
    bytes[] calldata signatures
) external {
    uint256 validSigs;
    for (uint i; i < signatures.length; i++) {
        address signer = recoverSigner(messageHash, signatures[i]);
        if (isValidator[signer]) validSigs++;
    }
    require(validSigs >= threshold, "Not enough sigs");
    // Missing: Check for duplicate signers!
}

// SECURE: Track used signatures
function processMessage(
    bytes32 messageHash,
    bytes[] calldata signatures
) external {
    uint256 validSigs;
    address lastSigner;
    
    for (uint i; i < signatures.length; i++) {
        address signer = recoverSigner(messageHash, signatures[i]);
        require(signer > lastSigner, "Invalid sig order");  // Prevents duplicates
        if (isValidator[signer]) validSigs++;
        lastSigner = signer;
    }
    require(validSigs >= threshold, "Not enough sigs");
}
```

### 2. Replay Protection

**Attack Vectors:**
- Replay same message multiple times
- Replay across chains (chainId not included)
- Replay after upgrade

**Checklist:**
- [ ] Is each message marked as processed?
- [ ] Is chainId included in message hash?
- [ ] Is nonce/sequence number enforced?
- [ ] Is contract address included in hash?

```solidity
// VULNERABLE: No replay protection
function executeMessage(bytes calldata message, bytes calldata proof) external {
    require(verifyProof(message, proof), "Invalid proof");
    _execute(message);  // Can be called again with same message!
}

// SECURE: Mark as processed
mapping(bytes32 => bool) public processedMessages;

function executeMessage(bytes calldata message, bytes calldata proof) external {
    bytes32 messageHash = keccak256(message);
    require(!processedMessages[messageHash], "Already processed");
    require(verifyProof(message, proof), "Invalid proof");
    
    processedMessages[messageHash] = true;
    _execute(message);
}
```

### 3. Validator/Guardian Security

**Attack Vectors:**
- Compromised validator keys
- Collusion attack (threshold too low)
- Single point of failure

**Checklist:**
- [ ] Is validator set distributed (different orgs, geographies)?
- [ ] Is threshold sufficient (e.g., 5/9 minimum)?
- [ ] Is there key rotation mechanism?
- [ ] Are validators timelock-protected for removal?

### 4. Token Accounting

**Attack Vectors:**
- Mint more tokens than locked
- Unlock without corresponding lock
- Fee accounting errors

**Checklist:**
- [ ] Can bridge mint more than total locked?
- [ ] Is there 1:1 backing for wrapped tokens?
- [ ] Are fees handled correctly?
- [ ] Is there a way to pause minting?

```solidity
// Ideal invariant
assert(wrappedTokenSupply <= originalTokenLockedAmount);
```

### 5. Upgrade Security

**Attack Vectors:**
- Malicious upgrade bypassing governance
- Storage collision on upgrade
- Uninitialized implementation

**Checklist:**
- [ ] Is upgrade path protected by timelock?
- [ ] Is implementation initializer protected?
- [ ] Are storage slots carefully managed?
- [ ] Is there emergency pause?

---

## Real Exploits

### Ronin Bridge (Mar 2022) — $625M

**What happened:**
- Attackers compromised 5 of 9 validator keys
- Signed fraudulent withdrawal messages
- Drained ETH and USDC

**Root cause:** Insufficient validator distribution + social engineering

### Wormhole (Feb 2022) — $326M

**What happened:**
- Attacker exploited Solana signature verification bug
- Forged guardian signatures
- Minted 120k wETH without deposit

**Root cause:** Invalid signature verification on Solana side

### Nomad (Aug 2022) — $190M

**What happened:**
- Routine upgrade set trusted root to 0x00
- Zero was treated as "valid" proof
- Anyone could submit fake messages as proven

**Root cause:** Zero initialization treated as valid state

```solidity
// The Nomad bug pattern
mapping(bytes32 => uint256) public messages;

function process(bytes memory _message) public {
    bytes32 _messageHash = keccak256(_message);
    // messages[_messageHash] == 0 was treated as confirmed!
    require(acceptableRoot(messages[_messageHash]), "not accepted");
}
```

### Poly Network (Aug 2021) — $611M

**What happened:**
- Attacker exploited cross-chain contract call
- Changed keeper to attacker address
- Drained all chains

**Root cause:** Insufficient validation of cross-chain call targets

---

## Bridge Types & Specific Risks

### Lock & Mint
- Risk: Minting without lock
- Check: Mint events should have corresponding lock

### Burn & Unlock
- Risk: Unlocking without burn
- Check: Burn verification before unlock

### Liquidity Networks (Hop, Across)
- Risk: LP manipulation
- Check: Bonder collateral, fees

### Optimistic Bridges (Nomad-style)
- Risk: Challenge period bypass
- Check: Fraud proof implementation

---

## Testing Checklist

### Unit Tests
- [ ] Message encoding/decoding
- [ ] Signature verification
- [ ] Replay protection
- [ ] Access control on critical functions

### Integration Tests
- [ ] Full message flow (both directions)
- [ ] Multiple concurrent messages
- [ ] Fee handling

### Attack Tests
- [ ] Message replay attempt
- [ ] Forged signature
- [ ] Duplicate signer attack
- [ ] Cross-chain replay

### Invariant Tests
- [ ] Wrapped supply ≤ locked amount
- [ ] Each message processed exactly once
- [ ] Validator count ≥ threshold

---

## Secure Patterns

### Message Structure

```solidity
struct Message {
    uint256 srcChainId;
    uint256 dstChainId;
    address srcContract;
    address dstContract;
    uint256 nonce;
    bytes payload;
}

function hashMessage(Message memory m) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        m.srcChainId,
        m.dstChainId,
        m.srcContract,
        m.dstContract,
        m.nonce,
        keccak256(m.payload)
    ));
}
```

### Ordered Signatures (Prevents Duplicates)

```solidity
function verifySignatures(
    bytes32 hash,
    bytes[] calldata sigs
) internal view returns (bool) {
    address lastSigner = address(0);
    uint256 valid;
    
    for (uint i; i < sigs.length; i++) {
        address signer = ECDSA.recover(hash, sigs[i]);
        require(signer > lastSigner, "Signatures not ordered");
        
        if (guardians[signer]) valid++;
        lastSigner = signer;
    }
    
    return valid >= threshold;
}
```

---

## References

- [L2Beat Bridge Risk Framework](https://l2beat.com/bridges/risk)
- [Rekt Bridge Leaderboard](https://rekt.news/leaderboard/)
- [LayerZero Security Model](https://layerzero.gitbook.io/docs/faq/security)
- [Wormhole Post-Mortem](https://wormholecrypto.medium.com/wormhole-incident-report-02-02-22-ad9b8f21eec6)
- [Nomad Post-Mortem](https://medium.com/nomad-xyz-blog/nomad-bridge-hack-root-cause-analysis-875ad2e5aacd)
