---
name: cyfrin-defi-core
description: Cyfrin DeFi checklist covering attacker mindset and protocol-level DeFi primitives
---
<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->
<!-- Total items: 151 -->

# Cyfrin Audit Checklist — DeFi Security (Core)

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
