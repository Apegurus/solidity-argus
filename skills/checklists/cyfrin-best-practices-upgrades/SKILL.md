---
name: cyfrin-best-practices-upgrades
description: Cyfrin best-practice checklist focused on proxy, upgradeability, and versioning concerns
---
<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->
<!-- Total items: 112 -->

# Cyfrin Audit Checklist — Best Practices (Upgrades & Versioning)

Best practice checklist items from [Cyfrin's audit checklist](https://github.com/Cyfrin/audit-checklist).

Covers: proxy/upgradable patterns, Solidity version issues, OpenZeppelin version issues, EIP adoption, multi-chain/cross-chain considerations, timelocks, Merkle tree validation, block reorganization, and general heuristics for code quality.

## Checklist Items

### Basics > Block Reorganization

- [ ] **[SOL-Basics-BR-1]** Does the protocol implement a factory pattern using the CREATE opcode?
  - Contracts created with the CREATE opcode will be eliminated if a block reorg happens.
  - **Remediation:** Use CREATE2 instead of CREATE.
  - **References:**
    - https://solodit.xyz/issues/m-08-factorycreate-is-vulnerable-to-reorg-attacks-code4rena-abracadabra-money-abracadabra-money-git
    - https://solodit.xyz/issues/m-02-reorg-attack-on-users-vault-deployment-and-deposit-may-lead-to-theft-of-funds-code4rena-amphora-protocol-amphora-protocol-git
    - https://solodit.xyz/issues/m-4-loss-of-bond-amounts-on-re-org-attacks-sherlock-optimism-fault-proofs-git
    - https://solodit.xyz/issues/m-01-questfactory-is-suspicious-of-the-reorg-attack-code4rena-rabbithole-rabbithole-quest-protocol-contest-git
    - https://solodit.xyz/issues/m-14-re-org-attack-in-factory-code4rena-frankencoin-frankencoin-git

### Basics > Proxy/Upgradable

- [ ] **[SOL-Basics-PU-1]** Is there a constructor in the proxied contract?
  - Proxied contract can't have a constructor and it's common to move constructor logic to an external initializer function, usually called initialize
  - **Remediation:** Use initializer functions for initialization of proxied contracts.

- [ ] **[SOL-Basics-PU-2]** Is the `initializer` modifier applied to the `initialization()` function?
  - Without the `initializer` modifier, there is a risk that the initialization function can be called multiple times.
  - **Remediation:** Always use the `initializer` modifier for initialization functions in proxied contracts and ensure they're called once during deployment.

- [ ] **[SOL-Basics-PU-3]** Is the upgradable version used for initialization?
  - Upgradable contracts must use the upgradable versions of parent initializer functions. (e.g. Pausable vs PausableUpgradable)
  - **Remediation:** Use upgradable versions of parent initializer functions.

- [ ] **[SOL-Basics-PU-4]** Is the `authorizeUpgrade()` function properly secured in a UUPS setup?
  - Inadequate security on the `authorizeUpgrade()` function can allow unauthorized upgrades.
  - **Remediation:** Ensure proper access controls and checks are in place for the `authorizeUpgrade()` function.

- [ ] **[SOL-Basics-PU-5]** Is the contract initialized?
  - An uninitialized contract can be taken over by an attacker. This applies to both a proxy and its implementation contract, which may impact the proxy.
  - **Remediation:** To prevent the implementation contract from being used, invoke the `_disableInitializers` function in the constructor to automatically lock it when it is deployed.
  - **References:**
    - https://docs.openzeppelin.com/contracts/4.x/api/proxy#Initializable

- [ ] **[SOL-Basics-PU-6]** Are `selfdestruct` and `delegatecall` used within the implementation contracts?
  - Using `selfdestruct` and `delegatecall` in implementation contracts can introduce vulnerabilities and unexpected behavior in a proxy setup.
  - **Remediation:** Avoid using `selfdestruct` and `delegatecall` in implementation contracts to ensure contract stability and security.

- [ ] **[SOL-Basics-PU-7]** Are values in immutable variables preserved between upgrades?
  - Immutable variables are stored in the bytecode, not in the proxy storage. So using immutable variable is not recommended in proxy setup. If used, make sure all immutables stay consistent across implementations during upgrades.
  - **Remediation:** Avoid using immutable variables in upgradable contracts.

- [ ] **[SOL-Basics-PU-8]** Has the contract inherited the correct branch of OpenZeppelin library?
  - Sometimes developers overlook and use an incorrect branch of OZ library, e.g. use Ownable instead of OwnableUpgradeable.
  - **Remediation:** Make sure inherit the correct branch of OZ library according to the contract's upgradeability design.
  - **References:**
    - https://solodit.xyz/issues/h-01-usage-of-an-incorrect-version-of-ownbale-library-can-potentially-malfunction-all-onlyowner-functions-code4rena-covalent-covalent-contest-git

- [ ] **[SOL-Basics-PU-9]** Could an upgrade of the contract result in storage collision?
  - Storage collisions can occur when storage layouts between contract versions conflict, leading to data corruption and unpredictable behavior.
  - **Remediation:** Maintain a consistent storage layout between upgrades, and when using inheritance, set storage gaps to avoid potential collisions.

- [ ] **[SOL-Basics-PU-10]** Are the order and types of storage variables consistent between upgrades?
  - Changing the order or type of storage variables between upgrades can lead to storage collisions.
  - **Remediation:** Maintain a consistent order and type for storage variables across contract versions to avoid storage collisions.

### Basics > Version Issues > EIP Adoption Issues

- [ ] **[SOL-Basics-VI-EAI-1]** EIP-4758: Does the contract use `selfdestruct()`?
  - `selfdestruct` will not be available after EIP-4758. This EIP will rename the SELFDESTRUCT opcode and replace its functionality.
  - **Remediation:** Do not use `selfdestruct` to ensure the contract works in the future.
  - **References:**
    - https://eips.ethereum.org/EIPS/eip-4758
    - https://solodit.xyz/issues/m-09-selfdestruct-will-not-be-available-after-eip-4758-code4rena-escher-escher-contest-git
    - https://solodit.xyz/issues/m-03-system-will-not-work-anymore-after-eip-4758-code4rena-axelar-network-axelar-network-git

### Basics > Version Issues > OpenZeppelin Version Issues

- [ ] **[SOL-Basics-VI-OVI-1]** Does the contract use `ERC2771Context`? (version >=4.0.0 <4.9.3)
  - `ERC2771Context._msgData()` reverts if `msg.data.length < 20`. The correct behavior is not specified in ERC-2771, but based on the specified behavior of `_msgSender` we assume the full `msg.data` should be returned in this case.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-2]** Does the contract use OpenZeppelin's GovernorCompatibilityBravo? (version >=4.3.0 <4.8.3)
  - GovernorCompatibilityBravo may trim proposal calldata. The proposal creation entrypoint (propose) in GovernorCompatibilityBravo allows the creation of proposals with a signatures array shorter than the calldatas array. This causes the additional elements of the latter to be ignored, and if the proposal succeeds the corresponding actions would eventually execute without any calldata. The ProposalCreated event correctly represents what will eventually execute, but the proposal parameters as queried through getActions appear to respect the original intended calldata.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-3]** Does the contract use OpenZeppelin's ECDSA.recover or ECDSA.tryRecover? (version <4.7.3)
  - ECDSA signature malleability. The functions ECDSA.recover and ECDSA.tryRecover are vulnerable to a kind of signature malleability due to accepting EIP-2098 compact signatures in addition to the traditional 65 byte signature format. This is only an issue for the functions that take a single bytes argument, and not the functions that take r, v, s or r, vs as separate arguments. The potentially affected contracts are those that implement signature reuse or replay protection by marking the signature itself as used rather than the signed message or a nonce included in it. A user may take a signature that has already been submitted, submit it again in a different form, and bypass this protection.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-4]** Does the contract use OpenZeppelin's ERC777? (version <3.4.0-rc.0)
  - Extending this contract with a custom _beforeTokenTransfer function could allow a reentrancy attack to happen. More specifically, when burning tokens, _beforeTokenTransfer is invoked before the send hook is externally called on the sender while token balances are adjusted afterwards. At the moment of the call to the sender, which can result in reentrancy, state managed by _beforeTokenTransfer may not correspond to the actual token balances or total supply.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-5]** Does the contract use OpenZeppelin's `MerkleProof`? (version >=4.7.0 <4.9.2)
  - When the `verifyMultiProof`, `verifyMultiProofCalldata`, `processMultiProof`, or `processMultiProofCalldata` functions are in use, it is possible to construct merkle trees that allow forging a valid multiproof for an arbitrary set of leaves.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-6]** Does the contract use OpenZeppelin's Governor or GovernorCompatibilityBravo? (version >=4.3.0 <4.9.1)
  - Governor proposal creation may be blocked by frontrunning. By frontrunning the creation of a proposal, an attacker can become the proposer and gain the ability to cancel it. The attacker can do this repeatedly to try to prevent a proposal from being proposed at all. This impacts the Governor contract in v4.9.0 only, and the GovernorCompatibilityBravo contract since v4.3.0.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-7]** Does the contract use OpenZeppelin's TransparentUpgradeableProxy? (version >=3.2.0 <4.8.3)
  - Transparency is broken in case of selector clash with non-decodable calldata. The TransparentUpgradeableProxy uses the ifAdmin modifier to achieve transparency. If a non-admin address calls the proxy the call should be frowarded transparently. This works well in most cases, but the forwarding of some functions can fail if there is a selector conflict and decoding issue.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-8]** Does the contract use OpenZeppelin's ERC721Consecutive?(version >=4.8.0 <4.8.2)
  - The ERC721Consecutive contract designed for minting NFTs in batches does not update balances when a batch has size 1 and consists of a single token. Subsequent transfers from the receiver of that token may overflow the balance as reported by balanceOf. The issue exclusively presents with batches of size 1.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-9]** Does the contract use OpenZeppelin's ERC165Checker or ERC165CheckerUpgradeable? (version >=2.3.0 <4.7.2)
  - Denial of Service (DoS) in the `supportsERC165InterfaceUnchecked()` function in `ERC165Checker.sol` and `ERC165CheckerUpgradeable.sol`, which can consume excessive resources when processing a large amount of data via an EIP-165 supportsInterface query.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-10]** Does the contract use OpenZeppelin's LibArbitrumL2 or CrossChainEnabledArbitrumL2? (version >=4.6.0 <4.7.2)
  - Incorrect resource transfer between spheres via contracts using the cross-chain utilities for Arbitrum L2: `CrossChainEnabledArbitrumL2` or `LibArbitrumL2`. Calls from EOAs would be classified as cross-chain calls. The vulnerability will classify direct interactions of externally owned accounts (EOAs) as cross-chain calls, even though they are not started on L1.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-11]** Does the contract use OpenZeppelin's GovernorVotesQuorumFraction? (version >=4.3.0 <4.7.2)
  - Checkpointing quorum was missing and past proposals that failed due to lack of quorum could pass later. It is necessary to avoid quorum changes making old, failed because of quorum, proposals suddenly successful.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-12]** Does the contract use OpenZeppelin's SignatureChecker? (version >=4.1.0 <4.7.1)
  - Since 0.8.0, abi.decode reverts if the bytes raw data overflow the target type. SignatureChecker.isValidSignatureNow is not expected to revert. However, an incorrect assumption about Solidity 0.8's abi.decode allows some cases to revert, given a target contract that doesn't implement EIP-1271 as expected. The contracts that may be affected are those that use SignatureChecker to check the validity of a signature and handle invalid signatures in a way other than reverting.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-13]** Does the contract use OpenZeppelin's ERC165Checker? (version >=4.0.0 <4.7.1)
  - Since 0.8.0, abi.decode reverts if the bytes raw data overflow the target type. ERC165Checker.supportsInterface is designed to always successfully return a boolean, and under no circumstance revert. However, an incorrect assumption about Solidity 0.8's abi.decode allows some cases to revert, given a target contract that doesn't implement EIP-165 as expected, specifically if it returns a value other than 0 or 1. The contracts that may be affected are those that use ERC165Checker to check for support for an interface and then handle the lack of support in a way other than reverting.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-14]** Does the contract use OpenZeppelin's GovernorCompatibilityBravo? (version >=4.3.0 <4.4.2)
  - GovernorCompatibilityBravo incorrect ABI encoding may lead to unexpected behavior
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-15]** Does the contract use OpenZeppelin's Initializable? (version >=3.2.0 <4.4.1)
  - It is possible for `initializer()`-protected functions to be executed twice, if this happens in the same transaction. For this to happen, either one call has to be a subcall the other, or both call have to be subcalls of a common initializer()-protected function. This can particularly be dangerous is the initialization is not part of the proxy construction, and reentrancy is possible by executing an external call to an untrusted address.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-16]** Does the contract use OpenZeppelin's ERC1155? (version >=4.2.0 <4.3.3)
  - Possible inconsistency in the value returned by totalSupply DURING a mint. If you mint a token, the receiver is a smart contract, and the receiver implements onERC1155Receive, then this receiver is called with the balance already updated, but with the totalsupply not yet updated.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-17]** Does the contract use OpenZeppelin's UUPSUpgradeable? (version >=4.1.0 <4.3.2)
  - Upgradeable contracts using UUPSUpgradeable may be vulnerable to an attack affecting uninitialized implementation contracts.
  - **Remediation:** Use the latest stable OpenZeppelin version

- [ ] **[SOL-Basics-VI-OVI-18]** Does the contract use OpenZeppelin's TimelockController? (version >=4.0.0-beta.0 <4.3.1\\n<3.4.2)
  - A vulnerability in TimelockController allowed an actor with the executor role to take immediate control of the timelock, by resetting the delay to 0 and escalating privileges, thus gaining unrestricted access to assets held in the contract. Instances with the executor role set to 'open' allow anyone to use the executor role, thus leaving the timelock at risk of being taken over by an attacker.
  - **Remediation:** Use the latest stable OpenZeppelin version
