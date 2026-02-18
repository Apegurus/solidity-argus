---
name: cyfrin-defi
description: Cyfrin audit checklist — DeFi-specific security items including oracle, AMM, lending, flash loan, and token checks
---

<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->
<!-- Total items: 151 -->

# Cyfrin Audit Checklist — DeFi Security

DeFi-specific checklist items from [Cyfrin's audit checklist](https://github.com/Cyfrin/audit-checklist).

Covers: AMM/swap, flash loans, lending, liquid staking, oracles, staking, token standards (ERC20/721/1155), price manipulation, front-running, sandwich attacks, donation attacks, and protocol integrations (AAVE, Compound, Balancer, Chainlink, LayerZero, Uniswap, Gnosis Safe).

## Checklist Items

### Attacker's Mindset > Donation Attack

- [ ] **[SOL-AM-DA-1]** Does the protocol rely on `balance` or `balanceOf` instead of internal accounting?
  - Attackers can manipulate the accounting by donating tokens.
  - **Remediation:** Implement internal accounting instead of relying on `balanceOf` natively.
  - **References:**
    - https://solodit.xyz/issues/h-02-first-depositor-can-break-minting-of-shares-code4rena-prepo-prepo-contest-git

### Attacker's Mindset > Front-running Attack

- [ ] **[SOL-AM-FrA-1]** Are "get-or-create" patterns protected against front-running attacks?
  - Functions combining resource creation and interaction (like getOrCreateAndUse) are vulnerable to front-running attacks where attackers can create the resource with different parameters before the victim, potentially manipulating prices or conditions.
  - **Remediation:** Separate creation and interaction into distinct transactions or implement robust protections (parameter validation, relative references instead of absolute values) to ensure safe operation regardless of creation timing.
  - **References:**
    - https://solodit.cyfrin.io/issues/h-03-fillorder-executor-can-be-front-run-by-the-order-creator-by-changing-orders-limitprice_e36-the-executors-assets-can-be-stolen-code4rena-init-capital-init-capital-git
    - https://solodit.cyfrin.io/issues/m-01-routergetorcreatepoolandaddliquidity-can-be-frontrunned-which-leads-to-price-manipulation-code4rena-maverick-maverick-git

- [ ] **[SOL-AM-FrA-2]** Are two-transaction actions designed to be safe from frontrunning?
  - Actions that require two separate transactions may be at risk of frontrunning, where an attacker can intervene between the two calls.
  - **Remediation:** Ensure critical actions that are split across multiple transactions cannot be interfered with by attackers. This can involve checks or locks between the transactions.
  - **References:**
    - https://github.com/sherlock-audit/2022-11-isomorph-judging/issues/47

- [ ] **[SOL-AM-FrA-3]** Can users maliciously cause others' transactions to revert by preempting with dust?
  - Attackers may cause legitimate transactions to fail by front-running with transactions of negligible amounts.
  - **Remediation:** Implement checks to prevent transactions with non-material amounts from affecting the contract's state or execution flow.
  - **References:**
    - https://solodit.xyz/issues/m-12-attacker-can-grift-syndicate-staking-by-staking-a-small-amount-code4rena-stakehouse-protocol-lsd-network-stakehouse-contest-git

- [ ] **[SOL-AM-FrA-4]** Is the protocol using a properly user-bound commit-reveal scheme?
  - Sensitive on-chain actions can be exposed in the mempool, enabling frontrunning and information exploitation. Effective commit-reveal schemes must bind commitments to specific users and transactions.
  - **Remediation:** Implement a two-phase process where users first commit a hash containing their address and all transaction parameters, then reveal actual actions after the commitment phase ends, preventing frontrunning and information leakage.
  - **References:**
    - https://solodit.cyfrin.io/issues/h01-votes-can-be-duplicated-openzeppelin-uma-audit-phase-1-markdown
    - https://solodit.cyfrin.io/issues/ethregistrarcontrollerregister-is-vulnerable-to-front-running-fixed-consensys-ens-permanent-registrar-markdown

### Attacker's Mindset > Price Manipulation Attack

- [ ] **[SOL-AM-PMA-1]** Is the price calculated by the ratio of token balances?
  - Price can be manipulated via flash loans or donations if it is derived from the ratio of token balances.
  - **Remediation:** Use the Chainlink oracles for the asset prices.
  - **References:**
    - https://solodit.xyz/issues/h-05-flash-loan-price-manipulation-in-purchasepyroflan-code4rena-behodler-behodler-contest-git
    - https://solodit.xyz/issues/h-05-underlying-assets-stealing-in-autopxgmx-and-autopxglp-via-share-price-manipulation-code4rena-redacted-cartel-redacted-cartel-contest-git
    - https://solodit.xyz/issues/h-02-use-of-slot0-to-get-sqrtpricelimitx96-can-lead-to-price-manipulation-code4rena-maia-dao-ecosystem-maia-dao-ecosystem-git

- [ ] **[SOL-AM-PMA-2]** Is the price calculated from DEX liquidity pool spot prices?
  - Spot price readings derived directly from DEX liquidity pools are vulnerable to manipulation through flash loans that can temporarily drain the pools.
  - **Remediation:** Use TWAP (time-weighted average price) with appropriate time windows based on asset volatility and liquidity, or use reliable oracle solutions.
  - **References:**
    - https://solodit.cyfrin.io/issues/h-08-omooracle-getliquidityamounts-uses-spot-price-making-it-manipulatable-pashov-audit-group-none-omo_2025-01-25-markdown
    - https://solodit.cyfrin.io/issues/h-03-the-use-of-spot-price-by-coresaltyfeed-can-lead-to-price-manipulation-and-undesired-liquidations-code4rena-saltyio-saltyio-git

### Attacker's Mindset > Sandwich Attack

- [ ] **[SOL-AM-SandwichAttack-1]** Does the protocol have an explicit slippage protection on user interactions?
  - An attacker can monitor the mempool and puts two transactions before and after the user's transaction. For example, when an attacker spots a large trade, executes their own trade first to manipulate the price, and then profits by closing their position after the user's trade is executed.
  - **Remediation:** Allow users to specify the minimum output amount and revert the transaction if it is not satisfied.
  - **References:**
    - https://solodit.xyz/issues/h-12-sandwich-attack-to-accruepremiumandexpireprotections-sherlock-carapace-carapace-git
    - https://solodit.xyz/issues/h-1-adversary-can-sandwich-oracle-updates-to-exploit-vault-sherlock-olympus-olympus-update-git

### Defi > AMM/Swap

- [ ] **[SOL-Defi-AS-1]** Is hardcoded slippage used?
  - Using hardcoded slippage can lead to poor trades and freezing user funds during times of high volatility.
  - **Remediation:** Allow users to specify the slippage parameter in the actual asset amount which was calculated off-chain.
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-on-chain-slippage-calculation-can-be-manipulated

- [ ] **[SOL-Defi-AS-2]** Is there a deadline protection?
  - Without deadline protection, user transactions are vulnerable to sandwich attacks.
  - **Remediation:** Allow a user specify the deadline of the swap.
  - **References:**
    - https://defihacklabs.substack.com/p/solidity-security-lesson-6-defi-slippage?utm_source=profile&utm_medium=reader2

- [ ] **[SOL-Defi-AS-3]** Is there a validation check for protocol reserves?
  - Protocols may face risks if reserves are not validated and can be lent out, affecting the system's solvency.
  - **Remediation:** Ensure reserve validation logic is in place to safeguard the protocol's liquidity and overall health.
  - **References:**
    - https://github.com/sherlock-audit/2022-08-sentiment-judging/blob/main/122-M/1-report.md

- [ ] **[SOL-Defi-AS-4]** Does the AMM utilize forked code?
  - Using forked code, especially from known projects like Uniswap, can introduce known vulnerabilities if not updated or audited properly.
  - **Remediation:** Review the differences. Utilize tools such as contract-diff.xyz to compare and identify the origin of code snippets.

- [ ] **[SOL-Defi-AS-5]** Are there rounding issues in product constant formulas?
  - Rounding issues in the formulas can lead to inaccuracies or imbalances in token swaps and liquidity provisions.
  - **Remediation:** Review the mathematical operations in the AMM's formulas, ensuring they handle rounding appropriately without introducing vulnerabilities.

- [ ] **[SOL-Defi-AS-6]** Can arbitrary calls be made from user input?
  - Allowing arbitrary calls based on user input can expose the contract to various vulnerabilities.
  - **Remediation:** Validate and sanitize user inputs. Avoid executing arbitrary calls based solely on input data.

- [ ] **[SOL-Defi-AS-7]** Is there a mechanism in place to protect against excessive slippage?
  - Without slippage protection, traders might experience unexpected losses due to large price deviations during a trade.
  - **Remediation:** Incorporate a slippage parameter that users can set to limit their maximum acceptable slippage.

- [ ] **[SOL-Defi-AS-8]** Does the AMM properly handle tokens of varying decimal configurations and token types?
  - If the AMM doesn't support tokens with varying decimals or types, it might lead to incorrect calculations and potential losses.
  - **Remediation:** Ensure compatibility with tokens of varying decimal places and validate token types before processing them.

- [ ] **[SOL-Defi-AS-9]** Does the AMM support the fee-on-transfer tokens?
  - Fee-on-transfer tokens can cause problems because the sending amount and the received amount do not match.
  - **Remediation:** Ensure the fee-on-transfer tokens are handled correctly if they are supposed to be supported.

- [ ] **[SOL-Defi-AS-10]** Does the AMM support the rebasing tokens?
  - Rebasing tokens can change the actual balance.
  - **Remediation:** Ensure the rebasing tokens are handled correctly if they are supposed to be supported.

- [ ] **[SOL-Defi-AS-11]** Does the protocol calculate `minAmountOut` before a token swap?
  - Protocols integrating AMMs should determine the `minAmountOut` prior to swaps to avoid unfavorable rates. The source of the rates and potential for manipulation should also be considered.
  - **Remediation:** Ensure that the protocol calculates `minAmountOut` before executing swaps. If external oracles are used, validate their trustworthiness and consider potential vulnerabilities like sandwich attacks.
  - **References:**
    - https://blog.chain.link/guide-to-sandwich-attacks/

- [ ] **[SOL-Defi-AS-12]** Does the integrating contract verify the caller address in its callback functions?
  - Callback functions can be manipulated if they don't validate the calling contract's address. This is especially crucial for functions like `swap()` that involve tokens or assets.
  - **Remediation:** Implement checks in the callback functions to validate the address of the calling contract. Additionally, review the logic for any potential bypasses to this check.

- [ ] **[SOL-Defi-AS-13]** Is the slippage calculated on-chain?
  - ON-chain slippage calculation can be manipulated.
  - **Remediation:** Allow users to specify the slippage parameter in the actual asset amount which was calculated off-chain.
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-on-chain-slippage-calculation-can-be-manipulated

- [ ] **[SOL-Defi-AS-14]** Is the slippage parameter enforced at the last step before transferring funds to users?
  - Enforcing slippage parameters for intermediate swaps but not the final step can result in users receiving less tokens than their specified minimum
  - **Remediation:** Enforce slippage parameter as the last step before transferring funds to users
  - **References:**
    - https://dacian.me/defi-slippage-attacks#heading-mintokensout-for-intermediate-not-final-amount

### Defi > FlashLoan

- [ ] **[SOL-Defi-FlashLoan-1]** Is withdraw disabled in the same block to prevent flashloan attacks?
  - Allowing withdrawals within the same block as other interactions may enable attackers to exploit flashloan vulnerabilities.
  - **Remediation:** Implement a delay or disable withdrawals within the same block where a deposit or loan action took place to mitigate such risks.

- [ ] **[SOL-Defi-FlashLoan-2]** Can ERC4626 be manipulated through flashloans?
  - ERC4626, the tokenized vault standard, could be susceptible to flashloan attacks if the underlying mechanisms do not adequately account for such threats.
  - **Remediation:** Ensure that ERC4626-related operations have in-built protections against rapid, in-block actions that could be leveraged by flashloans.
  - **References:**
    - https://github.com/code-423n4/2022-01-behodler-findings/issues/304

### Defi > General

- [ ] **[SOL-Defi-General-1]** Can the protocol handle ERC20 tokens with decimals other than 18?
  - Not all ERC20 tokens use 18 decimals. Overlooking this can lead to computation errors.
  - **Remediation:** Always check and adjust for the decimal count of the ERC20 tokens being handled.

- [ ] **[SOL-Defi-General-2]** Are there unexpected rewards accruing for user deposited assets?
  - Some protocols or platforms may provide additional rewards for staked or deposited assets. If these rewards are not properly accounted for or managed, it could lead to discrepancies in the user's expected vs actual returns.
  - **Remediation:** The protocol should have mechanisms in place to track all potential rewards for user deposited assets. Users should be provided with clear interfaces or methods to claim any unexpected rewards to ensure fairness and transparency.

- [ ] **[SOL-Defi-General-3]** Could direct transfers of funds introduce vulnerabilities?
  - Direct transfers of assets without using the protocol's logic can lead to various problems in accounting especially if the accounting relies on `balanceOf` (or `address.balance`).
  - **Remediation:** Implement the internal accounting so that it is not be affected by direct transfers.

- [ ] **[SOL-Defi-General-4]** Could the initial deposit introduce any issues?
  - The first deposit can set certain parameters or conditions that subsequent deposits rely on.
  - **Remediation:** Test and ensure that the first deposit initializes and sets all necessary parameters correctly.

- [ ] **[SOL-Defi-General-5]** Are the protocol token pegged to any other asset?
  - The target tokens can be depegged.
  - **Remediation:** Ensure the protocol behave as expected during the depeg.

- [ ] **[SOL-Defi-General-6]** Does the protocol revert on maximum approval to prevent over-allowance?
  - Setting high allowances can make funds vulnerable to abuse; protocols sometimes set max to prevent this risk.
  - **Remediation:** Consider implementing a revert on approval functions when an unnecessarily high allowance is set.
  - **References:**
    - https://solodit.xyz/issues/m-3-universalapprovemax-will-not-work-for-some-tokens-that-dont-support-approve-typeuint256max-amount-sherlock-dodo-dodo-git

- [ ] **[SOL-Defi-General-7]** What would happen if only 1 wei remains in the pool?
  - Leaving residual amounts can lead to discrepancies in accounting or locked funds.
  - **Remediation:** Implement logic to handle minimal residual amounts in the pool.

- [ ] **[SOL-Defi-General-8]** Is it possible to withdraw in the same transaction of deposit?
  - Protocols often provide various benefits to the depositors based on the deposit amount. This can lead to flashloan-deposit-harvest-withdraw attack cycle.
  - **Remediation:** Ensure the withdrawal is protected for some blocks after deposit.

- [ ] **[SOL-Defi-General-9]** Does the protocol aim to support ALL kinds of ERC20 tokens?
  - Not all ERC20 tokens are compliant to the ERC20 standard and there are several weird ERC20 tokens (e.g. Fee-On-Transfer tokens, rebasing tokens, tokens with blacklisting).
  - **Remediation:** Clarify what kind of tokens are supported and whitelist the ERC20 tokens that the protocol would accept.
  - **References:**
    - https://github.com/d-xo/weird-erc20

### Defi > Lending

- [ ] **[SOL-Defi-Lending-1]** Will the liquidation process function effectively during rapid market downturns?
  - Failure to liquidate positions during sharp price drops can result in substantial platform losses.
  - **Remediation:** Ensure robustness during extreme market conditions.

- [ ] **[SOL-Defi-Lending-2]** Can a position be liquidated if the loan remains unpaid or if the collateral falls below the required threshold?
  - If positions cannot be liquidated under these circumstances, it poses a risk to lenders who might not recover their funds.
  - **Remediation:** Ensure a reliable mechanism for liquidating under-collateralized or defaulting loans to safeguard lenders.

- [ ] **[SOL-Defi-Lending-3]** Is it possible for a user to gain undue profit from self-liquidation?
  - Self-liquidation profit loopholes can lead to potential system abuse and unintended financial consequences.
  - **Remediation:** Audit and test self-liquidation mechanisms to prevent any exploitative behaviors.

- [ ] **[SOL-Defi-Lending-4]** If token transfers or collateral additions are temporarily paused, can a user still be liquidated, even if they intend to deposit more funds?
  - Unexpected pauses can place users at risk of unwarranted liquidations, despite their willingness to increase collateral.
  - **Remediation:** Implement safeguards that protect users from liquidation during operational pauses or interruptions.

- [ ] **[SOL-Defi-Lending-5]** If liquidations are temporarily suspended, what are the implications when they are resumed?
  - Pausing liquidations can increase the solvency risk and lead to unpredictable behaviors upon resumption.
  - **Remediation:** Outline clear protocols for pausing and resuming liquidations, ensuring solvency is maintained.

- [ ] **[SOL-Defi-Lending-6]** Is it possible for users to manipulate the system by front-running and slightly increasing their collateral to prevent liquidations?
  - Lenders must be prevented from griefing via front-running the liquidation.
  - **Remediation:** Ensure it is not possible to prevent liquidators by any means.

- [ ] **[SOL-Defi-Lending-7]** Are all positions, regardless of size, incentivized adequately for liquidation?
  - Without proper incentives, small positions might be overlooked, leading to inefficiencies.
  - **Remediation:** Ensure a balanced incentive structure that motivates liquidators to address positions of all sizes.

- [ ] **[SOL-Defi-Lending-8]** Is interest considered during Loan-to-Value (LTV) calculation?
  - Omitting interest in LTV calculations can result in inaccurate credit assessments.
  - **Remediation:** Include accrued interest in LTV calculations to maintain accurate and fair credit evaluations.
  - **References:**
    - https://solodit.xyz/issues/h-7-users-can-be-liquidated-prematurely-because-calculation-understates-value-of-underlying-position-sherlock-blueberry-blueberry-git

- [ ] **[SOL-Defi-Lending-9]** Can liquidation and repaying be enabled or disabled simultaneously?
  - Protocols might need to ensure that liquidation and repaying mechanisms are either both active or inactive to maintain consistency.
  - **Remediation:** Review protocol logic to allow or disallow liquidation and repaying functions collectively to avoid operational discrepancies.
  - **References:**
    - https://solodit.xyz/issues/m-2-liquidations-are-enabled-when-repayments-are-disabled-causing-borrowers-to-lose-funds-without-a-chance-to-repay-sherlock-blueberry-blueberry-git

- [ ] **[SOL-Defi-Lending-10]** Is it possible to lend and borrow the same token within a single transaction?
  - Protocols that allow the same token to be lent and borrowed in a single transaction may be vulnerable to attacks that exploit rapid price inflation or flash loans to manipulate the system.
  - **Remediation:** Protocols should implement constraints to prohibit the same token from being used in a lend and borrow action within the same block or transaction, reducing the risk of flash-loan attacks and other manipulative practices.

- [ ] **[SOL-Defi-Lending-11]** Is there a scenario where a liquidator might receive a lesser amount than anticipated?
  - Discrepancies in liquidation returns can discourage liquidators and impact system stability.
  - **Remediation:** Ensure a clear and consistent calculation mechanism for liquidation rewards.

- [ ] **[SOL-Defi-Lending-12]** Is it possible for a user to be in a condition where they cannot repay their loan?
  - Certain scenarios or conditions might prevent a user from repaying their loan, causing them to be perpetually in debt. This can be due to factors such as excessive collateralization, high fees, fluctuating token values, or other unforeseen events.
  - **Remediation:** Review the lending protocol's logic to ensure there are no conditions that could trap a user in perpetual debt. Implement safeguards to notify or protect users from taking actions that may lead to irrecoverable financial situations.

### Defi > Liquid Staking Derivatives

- [ ] **[SOL-Defi-LSD-1]** Can a malicious validator front-run setting withdrawal credentials?
  - A malicious Ethereum validator can betray a liquid staking protocol by front-running to first call `DepositContract::deposit` sending 1 ETH and passing their own withdrawal credentials; after the protocol's subsequent call succeeds the withdrawal credentials are not overwritten since only the "initial deposit" sets the withdrawals credentials while the second deposit is treated as a "top-up deposit".  The malicious validator now controls 33 ether with 32 ether belonging to the protocol's users and has set their own withdrawal credentials instead of the protocol's withdrawal credentials.
  - **Remediation:** The function which calls `DepositContract::deposit` should take as input `DepositContract.get_deposit_root` then check that the input deposit root matches the current one. This works as the current deposit root changes with every deposit.

- [ ] **[SOL-Defi-LSD-2]** Can the exchange rate repricing update be sandwich attacked to drain ETH from the protocol?
  - Liquid staking protocols typically have their own liquid ERC20 token that accrues value against ETH as the protocol receives staking rewards; in the normal course of operations the exchange rate should continually be increasing as the protocol accrues rewards such that the protocol's ERC20 token can be exchanged for increasing amounts of ETH. If the protocol allows instant withdrawals, an attacker can perform a risk-free sandwich attack to drain ETH from the protocol by 1) front-running the exchange rate txn to deposit a large amount of ETH, 2) back-running to withdraw at the increased rate.
  - **Remediation:** Don't allow instant withdrawals but use a withdrawal queue and run the repricing transaction through flashbots.

- [ ] **[SOL-Defi-LSD-3]** Can re-entrancy when ETH is sent during rewards/withdrawals or when NFTs are minted via `_safeMint` (to represent pending withdrawals) be used to drain the protocol's ETH?
  - Re-entrancy vulnerabilties can often exist in the reward or withdrawal code of LSD protocols.
  - **Remediation:** Always follow the Checks-Effects-Interactions pattern; sending ETH or minting NFTs via `_safeMint` should always happen after storage updates.

- [ ] **[SOL-Defi-LSD-4]** Can an arbitrary exchange rate be set when processing queued withdrawals?
  - If an arbitrary exchange rate can be set when processing queued withdrawals this creates a subtle rug-pull vector of user withdrawals.
  - **Remediation:** When withdrawals are processed the current exchange rate should be retrieved in the same way as when withdrawals are created.

- [ ] **[SOL-Defi-LSD-5]** Can paused states be bypassed to perform restricted actions even when they should be paused?
  - LSD protocols often implement pausing of different functionality. Auditors should check if there are any gaps where for example one function is missing a pause check that other related functions contain.
  - **Remediation:** All related functions should contain the same related pause checks.

- [ ] **[SOL-Defi-LSD-6]** Can inter-related storage be corrupted, especially storage related to operators and validators?
  - To reduce the gas cost of reading from storage, protocols may use multiple inter-related data structures to store complex information like operator and validator information. Auditors should examine whether functions which update these inter-related data structures can be used to corrupt them by over-writing records which contain indexes into to another storage location.
  - **Remediation:** Protocols can use invariant fuzz testing with invariants which validate that relationships between inter-related data structures can't be broken by functions which update them.

- [ ] **[SOL-Defi-LSD-7]** Does the protocol iterate over the entire set of operators or validators?
  - LSD protocols may need to iterate over the entire set of operators or validators which can become exorbitantly expensive or lead to out of gas if the operator or validator set becomes large. In permissionless systems where anyone can create operators or validators this creates a denial of service attack vector.
  - **Remediation:** Refactor to avoid needing to iterate over the entire operator/validator set. Alternatively only use a small and trusted set of operators/validators.

- [ ] **[SOL-Defi-LSD-8]** If using a Proof Of Reserves Oracle, does the protocol check for stale data?
  - LSD protocols may use an external Proof of Reserves Oracle to fetch off-chain data for their current ETH reserves. If the protocol doesn't check how long ago the data was last updated it can process stale data as if it were fresh.
  - **Remediation:** Check the time data was last updated against the Oracle's heartbeat and revert if the data is too old.

- [ ] **[SOL-Defi-LSD-9]** Does unnecessary precision loss occur in deposit, withdrawal or reward calculations?
  - Mathematical calculations have to be performed in LSD protocol deposit, withdrawal and reward functions. Auditors should check for precision loss issues such as division before multiplication, rounding down to zero etc.
  - **Remediation:** Don't perform division before multiplication, be aware of rounding down to zero, rounding direction, unsafe casting etc.

### Defi > Oracle

- [ ] **[SOL-Defi-Oracle-1]** Is the Oracle using deprecated Chainlink functions?
  - Usage of deprecated Chainlink functions like latestRoundData() might return stale or incorrect data, affecting the integrity of smart contracts.
  - **Remediation:** Replace deprecated functions with the current recommended methods to ensure accurate data retrieval from oracles.
  - **References:**
    - https://github.com/code-423n4/2022-04-backd-findings/issues/17

- [ ] **[SOL-Defi-Oracle-2]** Is the returned price validated to be non-zero?
  - Price feed might return zero and this must be handled as invalid.
  - **Remediation:** Ensure the returned price is not zero.

- [ ] **[SOL-Defi-Oracle-3]** Is the price update time validated?
  - Price feeds might not be supported in the future. To ensure accurate price usage, it's vital to regularly check the last update timestamp against a predefined delay.
  - **Remediation:** Implement a mechanism to check the heartbeat of the price feed and compare it against a predefined maximum delay (`MAX_DELAY`). Adjust the `MAX_DELAY` variable based on the observed heartbeat.

- [ ] **[SOL-Defi-Oracle-4]** Is there a validation to check if the rollup sequencer is running?
  - The rollup sequencer can become offline, which can lead to potential vulnerabilities due to stale price.
  - **Remediation:** Utilize the sequencer uptime feed to confirm the sequencers are up.
  - **References:**
    - https://docs.chain.link/data-feeds/l2-sequencer-feeds

- [ ] **[SOL-Defi-Oracle-5]** Is the Oracle's TWAP period appropriately set?
  - An inadequately set TWAP (Time-Weighted Average Price) period could be exploited to manipulate prices.
  - **Remediation:** Adjust the TWAP period to a duration that mitigates the risk of manipulation while providing timely price updates.
  - **References:**
    - https://github.com/code-423n4/2022-06-canto-v2-findings/issues/124

- [ ] **[SOL-Defi-Oracle-6]** Is the desired price feed pair supported across all deployed chains?
  - In multi-chain deployments, it's crucial to ensure the desired price feed pair is available and consistent across all chains.
  - **Remediation:** Review the supported price feed pairs on all chains and ensure they are consistent.

- [ ] **[SOL-Defi-Oracle-7]** Is the heartbeat of the price feed suitable for the use case?
  - A price feed heartbeat that's too slow might not be suitable for some use cases.
  - **Remediation:** Assess the requirements of the use case and ensure the price feed heartbeat aligns with them.

- [ ] **[SOL-Defi-Oracle-8]** Are there any inconsistencies with decimal precision when using different price feeds?
  - Different price feeds might have varying decimal precisions, which can lead to inaccuracies.
  - **Remediation:** Ensure that the contract handles potential variations in decimal precision across different price feeds.

- [ ] **[SOL-Defi-Oracle-9]** Is the price feed address hard-coded?
  - Hard-coded price feed addresses can be problematic, especially if they become deprecated or if they're not accurate in the first place.
  - **Remediation:** Review and verify the hardcoded price feed addresses. Consider mechanisms to update the address if required in the future.

- [ ] **[SOL-Defi-Oracle-10]** What happens if oracle price updates are front-run?
  - Oracle price updates can be front-run and cause various problems.
  - **Remediation:** Ensure the protocol is not affected in the case where oracle price updates are front-run.
  - **References:**
    - https://blog.angle.money/angle-research-series-part-1-oracles-and-front-running-d75184abc67

- [ ] **[SOL-Defi-Oracle-11]** How does the system handle potential oracle reverts?
  - Unanticipated oracle reverts can lead to Denial-Of-Service.
  - **Remediation:** Implement try/catch blocks around oracle calls and have alternative strategies ready.

- [ ] **[SOL-Defi-Oracle-12]** Are the price feeds appropriate for the underlying assets?
  - Using an ETH price feed for stETH or a BTC price feed for WBTC can introduce risks associated with the underlying assets deviating from their pegs.
  - **Remediation:** Ensure that the price feeds accurately represent the underlying assets to address potential depeg risks.

- [ ] **[SOL-Defi-Oracle-13]** Is the contract vulnerable to oracle manipulation, especially using spot prices from AMMs?
  - Reliance on AMM spot prices as oracles can be manipulated via flashloan.
  - **Remediation:** Choose reliable and tamper-resistant oracle sources. Avoid using spot prices from AMMs directly without additional checks.

- [ ] **[SOL-Defi-Oracle-14]** How does the system address potential inaccuracies during flash crashes?
  - During flash crashes, oracles might return inaccurate prices.
  - **Remediation:** Implement checks to ensure that the price returned by the oracle lies within an expected range to guard against potential flash crash vulnerabilities.

### Defi > Staking

- [ ] **[SOL-Defi-Staking-1]** Can a user amplify another user's time lock duration by stacking tokens on their behalf?
  - If users can amplify time locks for others by stacking tokens, it may lead to unintended lock durations and potentially be exploited.
  - **Remediation:** Implement strict checks and controls to prevent users from influencing the time locks of other users through token stacking.

- [ ] **[SOL-Defi-Staking-2]** Can the distribution of rewards be unduly delayed or prematurely claimed?
  - Manipulation in the timing of reward distribution can adversely affect users and the protocol's intended incentives.
  - **Remediation:** Implement time controls and constraints on reward distributions to maintain the protocol's intended behavior.

- [ ] **[SOL-Defi-Staking-3]** Are rewards up-to-date in all use-cases?
  - The staking protocol often has a function to update the rewards (e.g. `updateRewards`) and sometimes it is used as a modifier. This update function MUST be called before all relevant operations.
  - **Remediation:** Ensure the update reward function is called properly in all places where the reward is relevant.

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

