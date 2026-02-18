---
name: cyfrin-defi-integrations
description: Cyfrin DeFi checklist covering integrations, token standards, and ecosystem-specific risks
---
<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->

# Cyfrin Audit Checklist — DeFi Security (Integrations & Tokens)

### Integrations > AAVE / Compound

- [ ] **[SOL-Integrations-AC-1]** Does the protocol use cETH token?
  - The absence of the `underlying()` function in the cETH token contract can cause integration issues.
  - **Remediation:** Double check the protocol works as expected when integrating cETH token.

- [ ] **[SOL-Integrations-AC-2]** What happens if the utilization rate is too high, and collateral cannot be retrieved?
  - A high utilization rate can potentially mean that there aren't enough assets in the pool to allow users to withdraw their collateral.
  - **Remediation:** Ensure that there are mechanisms to handle user withdrawal when the utilization rate is high.

- [ ] **[SOL-Integrations-AC-3]** What happens if the protocol is paused?
  - If the AAVE protocol is paused, the protocol can not interact with it.
  - **Remediation:** Ensure the protocol behaves as expected when the AAVE protocol is paused.

- [ ] **[SOL-Integrations-AC-4]** What happens if the pool becomes deprecated?
  - Pools can be deprecated.
  - **Remediation:** Ensure the protocol behaves as expected when the Pools are paused.

- [ ] **[SOL-Integrations-AC-5]** What happens if assets you lend/borrow are within the same eMode category?
  - Lending and borrowing assets within the same eMode category might have rules or limitations.
  - **Remediation:** Ensure the protocol behaves as expected when interacting with assets in the same eMode category.

- [ ] **[SOL-Integrations-AC-6]** Do flash loans on Aave inflate the pool index?
  - Flash loans can influence the pool index (a maximum of 180 flashloans can be performed within a block).
  - **Remediation:** Implement mechanisms to manage the effects of flash loans on the pool index.

- [ ] **[SOL-Integrations-AC-7]** Does the protocol properly implement AAVE/COMP reward claims?
  - Misimplementation of reward claims can lead to users not receiving their correct rewards.
  - **Remediation:** Ensure a proper and tested implementation of AAVE/COMP reward claims.

- [ ] **[SOL-Integrations-AC-8]** On AAVE, what happens if a user reaches the maximum debt on an isolated asset?
  - Reaching the maximum debt on an isolated asset can result in denial-of-service or other limitations on user actions.
  - **Remediation:** Ensure that the protocol works as expected when a user reaches the maximum debt.

- [ ] **[SOL-Integrations-AC-9]** Does borrowing an AAVE siloed asset restrict borrowing other assets?
  - Borrowing a siloed asset on Aave will prohibit users from borrowing other assets.
  - **Remediation:** Make use of `getSiloedBorrowing(address asset)` to prevent unexpected problems.
  - **References:**
    - https://docs.aave.com/developers/whats-new/siloed-borrowing

### Integrations > Balancer

- [ ] **[SOL-Integrations-Balancer-1]** Does the protocol use the Balancer's flashloan?
  - Balancer vault does not charge any fees for flash loans at the moment. However, it is possible Balancer implements fees for flash loans in the future.
  - **Remediation:** Ensure the protocol repays the fee together with the original debt on repayment in the `receiveFlashLoan` function.
  - **References:**
    - https://solodit.xyz/issues/receiveflashloan-does-not-account-for-fees-trailofbits-none-lindy-labs-sandclock-pdf

- [ ] **[SOL-Integrations-Balancer-2]** Does the protocol use Balancer's Oracle? (getTimeWeightedAverage)
  - The price will only be updated whenever a transaction (e.g. swap) within the Balancer pool is triggered. Due to the lack of updates, the price provided by Balancer Oracle will not reflect the true value of the assets.
  - **Remediation:** Do not use the Balancer's oracle for any pricing.
  - **References:**
    - https://solodit.xyz/issues/m-13-rely-on-balancer-oracle-which-is-not-updated-frequently-sherlock-notional-notional-git

- [ ] **[SOL-Integrations-Balancer-3]** Does the protocol use Balancer's Boosted Pool?
  - Balancer's Boosted Pool uses Phantom BPT where all pool tokens are minted at the time of pool creation and are held by the pool itself. Therefore, virtualSupply should be used instead of totalSupply to determine the amount of BPT supply in circulation.
  - **Remediation:** Ensure the protocol uses the correct function to get the total BPT supply in circulation.
  - **References:**
    - https://solodit.xyz/issues/h-7-totalbptsupply-will-be-excessively-inflated-sherlock-notional-notional-update-git

- [ ] **[SOL-Integrations-Balancer-4]** Does the protocol use Balancer vault pool liquidity status for any pricing?
  - Balancer vault does not charge any fees for flash loans at the moment. However, it is possible Balancer implements fees for flash loans in the future.
  - **Remediation:** Balancer pools are susceptible to manipulation of their external queries, and all integrations must now take an extra step of precaution when consuming data. Via readonly reentrancy, an attacker can force token balances and BPT supply to be out of sync, creating very inaccurate BPT prices.
  - **References:**
    - https://solodit.xyz/issues/h-13-balancerpairoracle-can-be-manipulated-using-read-only-reentrancy-sherlock-none-blueberry-update-git

### Integrations > Chainlink > CCIP

- [ ] **[SOL-Integrations-Chainlink-CCIP-1]** Does the receiver contract's `_ccipReceive` function properly validate the `sourceChainSelector` and `sender` address against an allowlist?
  - Receiver contracts might process messages from unintended source chains or senders if they don't validate the origin.
  - **Remediation:** Implement checks within `_ccipReceive` to verify the `any2EvmMessage.sourceChainSelector` and decoded `any2EvmMessage.sender` against administratively controlled allowlists.

- [ ] **[SOL-Integrations-Chainlink-CCIP-2]** Does the sender contract validate the `destinationChainSelector` against an allowlist before calling `ccipSend`?
  - Sender contracts might accidentally send messages and tokens to unintended or unsupported destination chains.
  - **Remediation:** Implement checks in the sending function to ensure the `destinationChainSelector` corresponds to an explicitly allowlisted chain.

- [ ] **[SOL-Integrations-Chainlink-CCIP-3]** Does the receiver contract properly decode data (`any2EvmMessage.data`) ?
  - The encoding on the source chain and decoding on the destination chain must maintain precise structural consistency. 
  - **Remediation:** Standardize both contracts to use identical ABI encoding/decoding patterns with explicit type declarations and thorough parameter validation to ensure cross-chain message integrity.

- [ ] **[SOL-Integrations-Chainlink-CCIP-4]** Does the application logic account for the potential latency introduced by waiting for source chain finality as defined by CCIP?
  - Applications assuming immediate cross-chain execution might behave unexpectedly due to varying finality times across blockchains which CCIP respects.
  - **Remediation:** Design application logic to be aware of and tolerant to CCIP execution latencies, which depend on the source chain's finality mechanism (finality tag or block depth).
  - **References:**
    - https://docs.chain.link/ccip/concepts/ccip-execution-latency#finality-by-blockchain

- [ ] **[SOL-Integrations-Chainlink-CCIP-5]** Are the correct types of token pools (e.g., `BurnMintTokenPool`, `LockReleaseTokenPool`) deployed on the source and destination chains consistent with the desired token handling mechanism?
  - Deploying mismatched pool types (e.g., expecting Lock & Mint but deploying Burn & Mint on the destination) will lead to failed transfers or incorrect token handling.
  - **Remediation:** Verify that the deployed token pool contracts on each chain match the intended cross-chain mechanism (Burn & Mint requires BurnMint pools; Lock & Mint requires LockRelease on source, BurnMint on destination, etc.).
  - **References:**
    - https://docs.chain.link/ccip/concepts/cross-chain-tokens#token-handling-mechanisms-and-token-pool-deployment

- [ ] **[SOL-Integrations-Chainlink-CCIP-6]** Is proper router address verification implemented in the ccipReceive method?
  - Without proper router validation, any address can spoof messages, potentially compromising contract security and asset integrity.
  - **Remediation:** Implement a router address verification check that validates msg.sender against a trusted router address.
  - **References:**
    - https://docs.chain.link/ccip/best-practices#verify-router-addresses

- [ ] **[SOL-Integrations-Chainlink-CCIP-7]** Are extraArgs parameters hardcoded instead of mutable in cross-chain message configurations?
  - Hardcoded extraArgs parameters prevent adaptation to future CCIP protocol upgrades and gas requirement changes, potentially causing cross-chain transactions to fail or become incompatible with network upgrades.
  - **Remediation:** Implement extraArgs as mutable parameters that can be configured off-chain or via updateable contract variables rather than hardcoding them directly in the contract logic.
  - **References:**
    - https://docs.chain.link/ccip/best-practices#using-extraargs

- [ ] **[SOL-Integrations-Chainlink-CCIP-8]** Is there a proper failure handling mechanism for CCIP messages to prevent blocking after Smart Execution window expiration?
  - When a CCIP message fails and the Smart Execution time window (8 hours) expires, all subsequent messages from the same sender will be blocked until the failed message succeeds, potentially causing permanent denial of service if the message cannot be fixed.
  - **Remediation:** Implement robust error handling in CCIPReceiver implementation with try/catch blocks and recovery mechanisms to ensure messages can be successfully processed even under unexpected conditions.
  - **References:**
    - https://solodit.cyfrin.io/issues/m-04-price-updating-mechanism-can-break-code4rena-renzo-renzo-git

### Integrations > Chainlink > VRF

- [ ] **[SOL-Integrations-Chainlink-VRF-1]** Are all parameters properly verified when Chainlink VRF is called?
  - If the parameters are not thoroughly verified when Chainlink VRF is called, the `fullfillRandomWord` function will not revert but return an incorrect value.
  - **Remediation:** Ensure that all parameters passed to Chainlink VRF are verified to ensure the correct operation of `fullfillRandomWord`.

- [ ] **[SOL-Integrations-Chainlink-VRF-2]** Is it guaranteed that the operator holds sufficient LINK in the subscription?
  - Chainlink VRF can go into a pending state if there's insufficient LINK in the subscription. Once the subscription is refilled, the transaction can potentially be frontrun, introducing vulnerabilities.
  - **Remediation:** Ensure the pending subscription does not affect the protocol's functionality.

- [ ] **[SOL-Integrations-Chainlink-VRF-3]** Is a sufficiently high request confirmation number chosen considering chain re-orgs?
  - Not choosing a high enough request confirmation number can pose risks, especially in the context of chain re-orgs.
  - **Remediation:** Evaluate the chain's vulnerability to re-orgs and adjust the request confirmation number accordingly.
  - **References:**
    - https://github.com/pashov/audits/blob/master/solo/NFTLoots-security-review.md#c-01-polygon-chain-reorgs-will-often-change-game-results

- [ ] **[SOL-Integrations-Chainlink-VRF-4]** Are measures in place to prevent VRF calls from being frontrun?
  - VRF calls can be frontrun and it's crucial to ensure that the user interactions are closed before the VRF call to prevent this.
  - **Remediation:** Ensure the implementation closes the user interaction phase before initiating the VRF call.

### Integrations > Gnosis Safe

- [ ] **[SOL-Integrations-GS-1]** Do your modules execute the Guard's hooks?
  - Failing to execute the Guard's hooks  (`checkTransaction()`, `checkAfterExecution()`) can bypass critical security checks implemented in those hooks.
  - **Remediation:** Ensure that all modules correctly execute the Guard's hooks as intended.

- [ ] **[SOL-Integrations-GS-2]** Does the `execTransactionFromModule()` function increment the nonce?
  - If the nonce is not incremented in `execTransactionFromModule()`, it can cause issues when relying on it for signatures.
  - **Remediation:** Ensure increase nonce inside the function `execTransactionFromModule()`.

### Integrations > LayerZero

- [ ] **[SOL-Integrations-LayerZero-1]** Does the `_debitFrom` function in ONFT properly validate token ownership and transfer permissions?
  - It's crucial that the `_debitFrom` function verifies whether the specified owner is the actual owner of the tokenId and if the sender has the correct permissions to transfer the token.
  - **Remediation:** Ensure thorough checks and validations are performed in the `_debitFrom` function to maintain token security.
  - **References:**
    - https://composable-security.com/blog/secure-integration-with-layer-zero/

- [ ] **[SOL-Integrations-LayerZero-2]** Which type of mechanism are utilized? Blocking or non-blocking?
  - Using blocking mechanism can potentially lead to a Denial-of-Service (DoS) attack.
  - **Remediation:** Consider using non-blocking mechanism to prevent potential DoS attacks.
  - **References:**
    - https://solodit.xyz/issues/h-06-attacker-can-block-layerzero-channel-code4rena-velodrome-finance-velodrome-finance-contest-git

- [ ] **[SOL-Integrations-LayerZero-3]** Is gas estimated accurately for cross-chain messages?
  - Inaccurate gas estimation can result in cross-chain message failures.
  - **Remediation:** Implement mechanisms to estimate gas accurately.

- [ ] **[SOL-Integrations-LayerZero-4]** Is the `_lzSend` function correctly utilized when inheriting LzApp?
  - When inheriting LzApp, direct calls to `lzEndpoint.send` can introduce vulnerabilities. Using `_lzSend` is the recommended approach.
  - **Remediation:** Ensure that the `_lzSend` function is used instead of making direct calls to `lzEndpoint.send`.

- [ ] **[SOL-Integrations-LayerZero-5]** Is the `ILayerZeroUserApplicationConfig` interface correctly implemented?
  - The User Application should include the `forceResumeReceive` function to handle unexpected scenarios and unblock the message queue when needed.
  - **Remediation:** Implement the `ILayerZeroUserApplicationConfig` interface and ensure that the `forceResumeReceive` function is present and functional.

- [ ] **[SOL-Integrations-LayerZero-6]** Are default contracts used?
  - Default configuration contracts are upgradeable by the LayerZero team.
  - **Remediation:** Configure the applications uniquely and avoid using default settings.

- [ ] **[SOL-Integrations-LayerZero-7]** Is the correct number of confirmations chosen for the chain?
  - Choosing an inappropriate number of confirmations can introduce risks, especially considering past reorg events on the chain.
  - **Remediation:** Evaluate the chain's history and potential vulnerabilities to determine the optimal number of confirmations.

### Integrations > LSD > cbETH

- [ ] **[SOL-Integrations-LSD-cbETH-1]** How is the control over the `cbETH`/`ETH` rate determined? Are there specific addresses with this capability due to the `onlyOracle` modifier?
  - The rate between `cbETH` and `ETH` being controllable by a few addresses can introduce centralization risks and potential manipulations.
  - **Remediation:** Any address with `onlyOracle` permissions should be scrutinized and their actions should be transparent to the community.

- [ ] **[SOL-Integrations-LSD-cbETH-2]** How does the system handle potential decreases in the `cbETH`/`ETH` rate?
  - The rate of `cbETH` to `ETH` can decrease, which can impact users who hold or interact with `cbETH`.
  - **Remediation:** Implement mechanisms to inform users about the current `cbETH`/`ETH` rate. Consider providing alerts or notifications for significant rate changes. Ensure there's a mechanism to handle or rectify situations where the rate decreases dramatically.

### Integrations > LSD > rETH

- [ ] **[SOL-Integrations-LSD-rETH-1]** Does the application account for potential penalties or slashes?
  - Validators on the Ethereum 2.0 Beacon Chain can be penalized or slashed for misbehavior. This can affect the value of `rETH`.
  - **Remediation:** Implement mechanisms to account for potential penalties or slashes that can impact the value of `rETH`.

- [ ] **[SOL-Integrations-LSD-rETH-2]** How does the system manage rewards accrued from staking?
  - Staking on the Ethereum 2.0 Beacon Chain accrues rewards. The system should account for these rewards when dealing with `rETH`.
  - **Remediation:** Ensure proper distribution or accumulation of rewards in the system's `rETH` management.

- [ ] **[SOL-Integrations-LSD-rETH-3]** Does the application handle potential reverts in the `burn()` function when there's insufficient ether in the `RocketDepositPool`?
  - If there's not enough ether in the `RocketDepositPool` contract, the `burn()` function can fail. It's important for the system to handle these failures gracefully.
  - **Remediation:** Ensure there's a mechanism to either prevent calls to `burn()` when there's insufficient ether or handle the revert gracefully, informing the user appropriately.

- [ ] **[SOL-Integrations-LSD-rETH-4]** What measures are in place to counteract potential consensus attacks on RPL nodes?
  - There's a risk of consensus attacks on RPL nodes where malicious nodes may submit incorrect exchange rate data, leading to discrepancies.
  - **Remediation:** Implement a system in place to quickly rectify incorrect data submissions by nodes.

- [ ] **[SOL-Integrations-LSD-rETH-5]** How does the system handle the conversion between `ETH` and `rETH`?
  - The conversion rate between `ETH` and `rETH` might change over time based on the rewards accrued from staking. Ensure this dynamic is properly captured.
  - **Remediation:** Integrate accurate conversion mechanisms that consider the ever-changing staking rewards when converting between `ETH` and `rETH`.

### Integrations > LSD > sfrxETH

- [ ] **[SOL-Integrations-LSD-sfrxETH-1]** How does the system handle potential detachment of `sfrxETH` from `frxETH` during reward transfers?
  - If `sfrxETH` detaches from `frxETH` during reward transfers, it could cause discrepancies in expected and actual values, especially if these transfers are controlled by a centralized entity like the Frax team's multi-sig contract.
  - **Remediation:** Ensure there's transparency around the actions of the Frax team's multi-sig contract. Consider mechanisms to alert users or stakeholders about discrepancies between `sfrxETH` and `frxETH`.

- [ ] **[SOL-Integrations-LSD-sfrxETH-2]** Is the stability of the `sfrxETH`/`ETH` rate guaranteed or can it decrease in the future?
  - While the `sfrxETH`/`ETH` rate might be stable now, changes in the future could impact users and stakeholders, especially if they're not forewarned.
  - **Remediation:** Provide clear documentation and alerts about potential changes to the `sfrxETH`/`ETH` rate. Ensure users are informed well in advance about any planned changes that could affect the rate.

### Integrations > LSD > stETH

- [ ] **[SOL-Integrations-LSD-stETH-1]** Is the application aware that `stETH` is a rebasing token?
  - `stETH` rebases, which can introduce complexities when integrated with DeFi platforms. Using `wstETH` can simplify integrations as it is non-rebasing.
  - **Remediation:** Consider using `wstETH` for simpler DeFi integrations and to avoid complexities associated with rebasing tokens.

- [ ] **[SOL-Integrations-LSD-stETH-2]** Are you aware of the overhead when withdrawing `stETH`/`wstETH`?
  - Withdrawing `stETH` or `wstETH` can introduce overheads, due to various problems like queue time, receipt of an NFT, and withdrawal amount limits.
  - **Remediation:** Ensure account for these overheads and constraints in the protocol logic.

- [ ] **[SOL-Integrations-LSD-stETH-3]** Does the application handle conversions between `stETH` and `wstETH` correctly?
  - Converting between `stETH` and `wstETH` can be tricky due to the rebasing nature of `stETH`. It's crucial to handle these conversions correctly to avoid potential issues.
  - **Remediation:** Ensure that the rebasing characteristics of `stETH` are properly managed when converting between `stETH` and `wstETH`.

### Integrations > Uniswap

- [ ] **[SOL-Integrations-Uniswap-1]** Is the slippage calculated on-chain?
  - ON-chain slippage calculation can be manipulated.
  - **Remediation:** Allow users to specify the slippage parameter in the actual asset amount which was calculated off-chain.
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-on-chain-slippage-calculation-can-be-manipulated

- [ ] **[SOL-Integrations-Uniswap-2]** Are there refunds after swaps?
  - In case of failed or partially filled orders, the protocol must issue refunds to the users.
  - **Remediation:** Implement a refund mechanism to handle failed or partially filled swaps.

- [ ] **[SOL-Integrations-Uniswap-3]** Is the order of `token0` and `token1` consistent across chains?
  - The order of `token0` and `token1` in AMM pools may vary depending on the chain, which can lead to inconsistencies.
  - **Remediation:** Always verify the order of tokens when interacting with different chains to avoid potential issues.

- [ ] **[SOL-Integrations-Uniswap-4]** Are the pools that are being interacted with whitelisted?
  - Missing verification on the interacting pools can introduce risks.
  - **Remediation:** Ensure pools are whitelisted or verify the pool's factory address before any interactions.

- [ ] **[SOL-Integrations-Uniswap-5]** Is there a reliance on pool reserves?
  - Relying on pool reserves can be risky, as they can be manipulated, especially using a flashloan.
  - **Remediation:** Implement alternative methods or checks without relying solely on pool reserves.

- [ ] **[SOL-Integrations-Uniswap-6]** Is `pool.swap()` directly used?
  - Directly using `pool.swap()` can bypass certain security mechanisms.
  - **Remediation:** Always use the Router contract to handle swaps, providing an added layer of security and standardization.

- [ ] **[SOL-Integrations-Uniswap-7]** Is `unchecked` used properly with Uniswap's math libraries?
  - Uniswap's TickMath and FullMath libraries require careful usage of `unchecked` due to solidity version specifics.
  - **Remediation:** Review and test the use of `unchecked` in contracts utilizing Uniswap's math libraries to ensure safety and correctness.
  - **References:**
    - https://solodit.xyz/issues/use-unchecked-intickmathsol-andfullmathsol-spearbit-overlay-pdf

- [ ] **[SOL-Integrations-Uniswap-8]** Is the slippage parameter enforced at the last step before transferring funds to users?
  - Enforcing slippage parameters for intermediate swaps but not the final step can result in users receiving less tokens than their specified minimum
  - **Remediation:** Enforce slippage parameter as the last step before transferring funds to users
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-mintokensout-for-intermediate-not-final-amount

- [ ] **[SOL-Integrations-Uniswap-9]** Is `pool.slot0` being used to calculate sensitive information like current price and exchange rates?
  - `pool.slot0` can be easily manipulated via flash loans to sandwich attack users.
  - **Remediation:** Use UniswapV3 TWAP or Chainlink Price Oracle.
  - **References:**
    - https://solodit.xyz/issues/h-4-no-slippage-protection-during-repayment-due-to-dynamic-slippage-params-and-easily-influenced-slot0-sherlock-real-wagmi-2-git
    - https://solodit.xyz/issues/h-02-use-of-slot0-to-get-sqrtpricelimitx96-can-lead-to-price-manipulation-code4rena-maia-dao-ecosystem-maia-dao-ecosystem-git
    - https://docs.uniswap.org/concepts/protocol/oracle

- [ ] **[SOL-Integrations-Uniswap-10]** Is a hard-coded fee tier parameter being used?
  - In UniswapV3 liquidity can be spread across multiple fee tiers. If a function which initiates a uni v3 swap hard-codes the fee tier parameter, this can have several negative effects.
  - **Remediation:** Functions allowing users to perform uni v3 swaps should allow users to pass in the fee tier parameter.
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-hard-coded-fee-tier-in-uniswapv3-swap

### Token > Fungible : ERC20

- [ ] **[SOL-Token-FE-1]** Are safe transfer functions used throughout the contract?
  - Not all ERC20 tokens are compliant to the EIP20 standard. Some do not return boolean flag, some do not revert on failure.
  - **Remediation:** Use OpenZeppelin's SafeERC20 where the safeTransfer and safeTransferFrom functions handle the return value check as well as non-standard-compliant tokens.

- [ ] **[SOL-Token-FE-2]** Is there potential for a race condition for approvals?
  - Race condition for approvals can cause an unexpected loss of funds to the signer.
  - **Remediation:** Use OpenZeppelin's safeIncreaseAllowance and safeDecreaseAllowance functions.
  - **References:**
    - https://solodit.xyz/issues/m01-approval-process-can-be-front-run-openzeppelin-notional-governance-contracts-v2-audit-markdown

- [ ] **[SOL-Token-FE-3]** Could a difference in decimals between ERC20 tokens cause issues?
  - Different decimals in ERC20 tokens can cause incorrect calculations or interpretations.
  - **Remediation:** Always check and handle the decimals of ERC20 tokens to prevent potential issues.

- [ ] **[SOL-Token-FE-4]** Does the token implement any form of address whitelisting, blacklisting, or checks?
  - Tokens that have address checks can lead to various problems.
  - **Remediation:** Ensure the token's own blacklisting mechanism does not affect the protocol's functionality.

- [ ] **[SOL-Token-FE-5]** Could the use of multiple addresses for a single token lead to complications?
  - Some tokens have multiple addresses and this can introduce vulnerabilities.
  - **Remediation:** Do not rely on the token address in the accounting.

- [ ] **[SOL-Token-FE-6]** Does the token charge fee on transfer?
  - Some tokens charge fee on transfer and the receiver gets less amount than specified.
  - **Remediation:** If the protocol intends to support this kind of token, ensure the accounting logic is correct.

- [ ] **[SOL-Token-FE-7]** Can the token be ERC777?
  - ERC777 tokens have hooks that execute code before and after transfers, which might lead to reentrancy.
  - **Remediation:** Be cautious when integrating with ERC777 and be aware of the hook implications.

- [ ] **[SOL-Token-FE-8]** Does the protocol use Solmate's `ERC20.safeTransferLib`?
  - Solmate `ERC20.safeTransferLib` do not check the contract existence and this opens up a possibility for a honeypot attack.
  - **Remediation:** Use OpenZeppelin's SafeERC20.
  - **References:**
    - https://solodit.xyz/issues/m-02-solmates-erc20-does-not-check-for-token-contracts-existence-which-opens-up-possibility-for-a-honeypot-attack-code4rena-size-size-contest-git

- [ ] **[SOL-Token-FE-9]** Is there a flash-mint functionality?
  - Flash mints can drastically increase token supply temporarily, leading to potential abuse.
  - **Remediation:** Implement strict controls and checks around any flash mint functionality.

- [ ] **[SOL-Token-FE-10]** What happens on zero amount transfer?
  - Some tokens revert on transfer of zero amount and can cause issues in certain integrations and operations.
  - **Remediation:** Transfer only when the amount is positive.

- [ ] **[SOL-Token-FE-11]** Is the token an ERC2612 implementation?
  - Missing `DOMAIN_SEPARATOR()` can lead to vulnerabilities in the ERC2612 permit functionality.
  - **Remediation:** Ensure complete and correct implementation of ERC2612, including the `DOMAIN_SEPARATOR()` function.

- [ ] **[SOL-Token-FE-12]** Can the token be sent to any address?
  - Certain addresses might be blocked or restricted to receive tokens (e.g. LUSD).
  - **Remediation:** Ensure the receiver blacklisting does not affect the protocol's functionality.

- [ ] **[SOL-Token-FE-13]** Is there a direct approval to a non-zero value?
  - Some ERC20 tokens do not work when changing the allowance from an existing non-zero allowance value. For example Tether (USDT)'s approve() function will revert if the current approval is not zero, to protect against front-running changes of approvals.
  - **Remediation:** Set the allowance to zero before increasing the allowance and use safeApprove/safeIncreaseAllowance.
  - **References:**
    - https://solodit.xyz/issues/m-17-did-not-approve-to-zero-first-sherlock-notional-notional-git

- [ ] **[SOL-Token-FE-14]** Is there a max approval used?
  - Some tokens don't support approve `type(uint256).max` amount and revert.
  - **Remediation:** Avoid approval of `type(uint256).max`.
  - **References:**
    - https://solodit.xyz/issues/m-3-universalapprovemax-will-not-work-for-some-tokens-that-dont-support-approve-typeuint256max-amount-sherlock-dodo-dodo-git

- [ ] **[SOL-Token-FE-15]** Can the token be paused?
  - Some ERC20 tokens can be paused by the contract owner.
  - **Remediation:** Ensure the protocol is not affected when the token is paused.

- [ ] **[SOL-Token-FE-16]** Is the decrease allowance feature of transferFrom() handled correctly when the sender is the caller?
  - Allowance should not be decreased in a transferFrom() call if the sender is the same as the caller, to prevent incorrect balance and allowance tracking.
  - **Remediation:** Ensure that the smart contract logic maintains correct allowance levels when transferFrom() involves the token owner themselves.
  - **References:**
    - https://solodit.xyz/issues/m-2-transferfrom-uses-allowance-even-if-spender-from-sherlock-surge-surge-git

### Token > Non-fungible : ERC721/1155

- [ ] **[SOL-Token-NfE1-1]** How are the minting and transfer implemented?
  - According to the ERC721 standard, a wallet/broker/auction application MUST implement the wallet interface if it will accept safe transfers. Use safe version of mint and transfer functions to prevent NFT being lost. (the similar applies to ERC1155)
  - **Remediation:** Use OpenZeppelin's safe mint/transfer functions for ERC721/1155.

- [ ] **[SOL-Token-NfE1-2]** Is the contract safe from reentrancy attack?
  - By standard, the token receiver contracts implement onERC721Received and onERC1155Received and this can potentially be a source of reentrancy attacks if not correctly handled.
  - **Remediation:** Double check the potential reentrancy attack.

- [ ] **[SOL-Token-NfE1-3]** Is the OpenZeppelin implementation of ERC721 and ERC1155 safeguarded against reentrancy attacks, especially in the `safeTransferFrom` functions?
  - The `safeTransferFrom` functions in OpenZeppelin's ERC721 and ERC1155 can expose the contract to reentrancy attacks due to external calls to user addresses.
  - **Remediation:** Use the checks-effects-interactions pattern and implement reentrancy guards to prevent potential reentrancy attacks when making external calls.

- [ ] **[SOL-Token-NfE1-4]** Is it possible to steal NFT abusing his approval?
  - Most of the time the `from` parameter of `transferFrom()` should be `msg.sender`. Otherwise an attacker can take advantage of other user's approvals and steal.
  - **Remediation:** Ensure that the contract verifies the `msg.sender` is actually the owner.

- [ ] **[SOL-Token-NfE1-5]** Does the ERC721/1155 contract correctly implement supportsInterface?
  - Contracts must properly implement the supportsInterface function to ensure they comply with ERC721/1155 standards and interoperate with other contracts correctly.
  - **Remediation:** Implement the supportsInterface function to return true for ERC721 and ERC1155 token types, ensuring accurate reporting of supported features.
  - **References:**
    - https://solodit.xyz/issues/m-04-the-ferc1155sol-dont-respect-the-eip2981-code4rena-fractional-fractional-v2-contest-git

- [ ] **[SOL-Token-NfE1-6]** Can the contract support both ERC721 and ERC1155 standards?
  - To facilitate broader compatibility and usage in various applications, contracts may need to support both ERC721 and ERC1155 token standards.
  - **Remediation:** Use the supportsInterface method to check for and support interfaces of both ERC1155 and ERC721 within the same contract.
  - **References:**
    - https://solodit.xyz/issues/h-06-some-real-world-nft-tokens-may-support-both-erc721-and-erc1155-standards-which-may-break-infinityexchange_transfernfts-code4rena-infinity-nft-marketplace-infinity-nft-marketplace-contest-git

- [ ] **[SOL-Token-NfE1-7]** What happens to the airdrops that are engaged to specific NFT?
  - For many NFT collections, a kind of privilege is provided in various ways, e.g. airdrop. The NFT owner must be able to claim the benefits while they lock in protocols.
  - **Remediation:** Ensure the NFT holders can claim all benefits.
  - **References:**
    - https://solodit.xyz/issues/m-04-its-possible-to-swap-nft-token-ids-without-fee-and-also-attacker-can-wrap-unwrap-all-the-nft-token-balance-of-the-pair-contract-and-steal-their-air-drops-for-those-token-ids-code4rena-caviar-caviar-contest-git

- [ ] **[SOL-Token-NfE1-8]** How is the approval/transfer handled for CryptoPunks collection?
  - CryptoPunks collections that do not support the `transferFrom()` function can present risks. The `offerPunkForSaleToAddress()` function in particular can be susceptible to front-running attacks, which can compromise the ownership and security of the token.
  - **Remediation:** Ensure validation is done properly to prevent malicious actors claiming the ownership.
  - **References:**
    - https://solodit.xyz/issues/h-3-cryptopunks-nfts-may-be-stolen-via-deposit-frontrunning-sherlock-ajna-ajna-git
    - https://solodit.xyz/issues/h-02-anyone-can-steal-cryptopunk-during-the-deposit-flow-to-wpunkgateway-code4rena-paraspace-paraspace-contest-git

