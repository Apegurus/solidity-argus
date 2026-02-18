---
name: cyfrin-general
description: Cyfrin audit checklist — general security patterns including attack vectors, access control, and core vulnerability classes
---

<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->
<!-- Total items: 102 -->

# Cyfrin Audit Checklist — General Security

Structured checklist items for general Solidity security auditing, sourced from [Cyfrin's audit checklist](https://github.com/Cyfrin/audit-checklist) (auto-synced from Solodit).

Covers: attack vectors (DOS, reentrancy, replay, griefing, sybil, rug pull, miner attacks), access control, arrays/loops, math, functions, inheritance, external calls, signatures, low-level operations, and centralization risks.

## Checklist Items

### Attacker's Mindset > Denial-Of-Service(DOS) Attack

- [ ] **[SOL-AM-DOSA-1]** Is the withdrawal pattern followed to prevent denial of service?
  - To prevent denial of service attacks during withdrawals, it's critical to follow the withdrawal pattern best practices - pull based approach.
  - **Remediation:** Implement withdrawal pattern best practices to ensure that contract behavior remains predictable and robust against denial of service attacks.
  - **References:**
    - https://solodit.xyz/issues/m-06-denial-of-service-contract-owner-could-block-users-from-withdrawing-their-strike-code4rena-putty-putty-contest-git

- [ ] **[SOL-AM-DOSA-2]** Is there a minimum transaction amount enforced?
  - Enforcing a minimum transaction amount can prevent attackers from clogging the network with zero amount or dust transactions.
  - **Remediation:** Disallow transactions below a certain threshold to maintain efficiency and prevent denial of service through dust spamming.
  - **References:**
    - https://solodit.xyz/issues/h-02-denial-of-service-code4rena-hubble-hubble-contest-git
    - https://solodit.cyfrin.io/issues/m-16-users-can-be-griefed-due-to-lack-of-minimum-size-within-the-loan-and-offer-sherlock-debita-finance-v3-git

- [ ] **[SOL-AM-DOSA-3]** How does the protocol handle tokens with blacklisting functionality?
  - Tokens with blacklisting capabilities, such as USDC, can pose unique risks and challenges to protocols.
  - **Remediation:** Account for the possibility of blacklisting within token protocols to ensure continued functionality even if certain addresses are blacklisted.
  - **References:**
    - https://solodit.cyfrin.io/issues/m-4-blacklisted-creditor-can-block-all-repayment-besides-emergency-closure-sherlock-real-wagmi-2-git

- [ ] **[SOL-AM-DOSA-4]** Can forcing the protocol to process a queue lead to DOS?
  - Forcing protocols to process queues, like a queue of dust withdrawals, can be exploited to cause a denial of service.
  - **Remediation:** Design queue processing in a manner that is resilient to spam and cannot be exploited to cause denial of service.
  - **References:**
    - https://solodit.cyfrin.io/?b=false&f=&fc=gte&ff=&fn=1&i=HIGH%2CMEDIUM&p=1&pc=&r=all&s=gas+griefing&t=
    - https://solodit.cyfrin.io/issues/denial-of-slashing-ottersec-none-ethos-evm-pdf

- [ ] **[SOL-AM-DOSA-5]** What happens with low decimal tokens that might cause DOS?
  - Tokens with low decimals can present issues where the transaction process fails due to rounding to zero amounts.
  - **Remediation:** Implement logic to handle low decimal tokens in a way that prevents the transaction process from breaking due to insufficient token amounts.
  - **References:**
    - https://solodit.xyz/issues/potential-funds-locked-due-low-token-decimal-and-long-stream-duration-spearbit-locke-pdf

- [ ] **[SOL-AM-DOSA-6]** Does the protocol handle external contract interactions safely?
  - Protocols must handle interactions with external contracts in a way that does not compromise their functionality if external dependencies fail.
  - **Remediation:** Ensure robust handling of external contract interactions to maintain protocol integrity regardless of external contract performance.
  - **References:**
    - https://solodit.xyz/issues/m-09-unhandled-chainlink-revert-would-lock-all-price-oracle-access-code4rena-juicebox-juicebox-v2-contest-git

### Attacker's Mindset > Griefing Attack

- [ ] **[SOL-AM-GA-1]** Is there an external function that relies on states that can be changed by others?
  - Malicious actors can prevent regular user transactions by making a slight change to the on-chain states.
  - **Remediation:** Ensure normal user actions especially important actions like withdrawal and repayment are not disturbed by other actors.
  - **References:**
    - https://solodit.xyz/issues/m-10-griefing-attack-to-block-withdraws-code4rena-mochi-mochi-contest-git
    - https://solodit.cyfrin.io/issues/griefing-attack-in-group-ip-management-via-license-token-minting-halborn-story-proof-of-creativity-protocol-markdown
    - https://solodit.cyfrin.io/issues/h-6-loss-of-rewards-due-to-continuous-griefing-attacks-on-l2-environment-sherlock-notional-leveraged-vaults-pendle-pt-and-vault-incentives-git

- [ ] **[SOL-AM-GA-2]** Can the contract operations be manipulated with precise gas limit specifications?
  - Attackers can supply carefully calculated gas amounts to force specific execution paths in the contract, manipulating its behavior in unexpected ways.
  - **Remediation:** Implement explicit gas checks before critical operations.
  - **References:**
    - https://solodit.cyfrin.io/issues/19573
    - https://solodit.cyfrin.io/issues/2786
    - https://scsfg.io/hackers/griefing/

### Attacker's Mindset > Miner Attack

- [ ] **[SOL-AM-MA-1]** Is block.timestamp used for time-sensitive operations?
  - Miners can manipulate block.timestamp by several seconds, potentially affecting time-dependent contract logic.
  - **Remediation:** Use block.number instead of timestamps for critical timing operations or ensure manipulation tolerance is acceptable.

- [ ] **[SOL-AM-MA-2]** Is the contract using block properties like timestamp or difficulty for randomness generation?
  - Block properties (timestamp, difficulty) and other predictable values should not be used for randomness as they can be influenced or predicted by miners.
  - **Remediation:** Use a secure randomness source like Chainlink VRF, commit-reveal schemes, or a provably fair randomization mechanism instead.
  - **References:**
    - https://solodit.cyfrin.io/issues/m-01-randomindex-is-not-truly-random-possibility-of-predictably-minting-a-specific-token-id-code4rena-larvalabs-meebits-larvalabs-meebits-contest-git

- [ ] **[SOL-AM-MA-3]** Is contract logic sensitive to transaction ordering?
  - Miners control transaction ordering and can exploit this for front-running, back-running, or sandwich attacks.
  - **Remediation:** Implement protection by allowing users to specify acceptable results that revert transactions when breached.
  - **References:**
    - https://solodit.cyfrin.io/issues/20754

### Attacker's Mindset > Reentrancy Attack

- [ ] **[SOL-AM-ReentrancyAttack-1]** Is there a view function that can return a stale value during interactions?
  - Read-only reentrancy. The read-only reentrancy is a reentrancy scenario where a view function is reentered, which in most cases is unguarded as it does not modify the contract's state. However, if the state is inconsistent, wrong values could be reported. Other protocols relying on a return value can be tricked into reading the wrong state to perform unwanted actions.
  - **Remediation:** Extend the reentrancy guard to the view functions as well.
  - **References:**
    - https://medium.com/@zokyo.io/read-only-reentrancy-attacks-understanding-the-threat-to-your-smart-contracts-99444c0a7334
    - https://solodit.xyz/issues/m-03-read-only-reentrancy-is-possible-code4rena-angle-protocol-angle-protocol-invitational-git
    - https://solodit.xyz/issues/h-13-balancerpairoracle-can-be-manipulated-using-read-only-reentrancy-sherlock-none-blueberry-update-git

- [ ] **[SOL-AM-ReentrancyAttack-2]** Is there any state change after interaction to an external contract?
  - Untrusted external contract calls could callback leading to unexpected results such as multiple withdrawals or out-of-order events.
  - **Remediation:** Use check-effects-interactions pattern or reentrancy guards.
  - **References:**
    - https://www.geeksforgeeks.org/reentrancy-attack-in-smart-contracts/
    - https://solodit.xyz/issues/m-09-malicious-royalty-recipient-can-steal-excess-eth-from-buy-orders-code4rena-caviar-caviar-private-pools-git
    - https://solodit.xyz/issues/h-01-re-entrancy-in-settleauction-allow-stealing-all-funds-code4rena-kuiper-kuiper-contest-git

### Attacker's Mindset > Replay Attack

- [ ] **[SOL-AM-ReplayAttack-1]** Are there protections against replay attacks for failed transactions?
  - Failed transactions can be susceptible to replay attacks if not properly protected.
  - **Remediation:** Implement nonce-based or other mechanisms to ensure that each transaction can only be executed once, preventing replay attacks.
  - **References:**
    - https://github.com/code-423n4/2022-03-rolla-findings/issues/45

- [ ] **[SOL-AM-ReplayAttack-2]** Is there protection against replaying signatures on different chains?
  - Signatures valid on one chain may be replayed on another, leading to potential security breaches.
  - **Remediation:** Use chain-specific parameters or domain separators to ensure signatures are only valid on the intended chain.
  - **References:**
    - https://github.com/sherlock-audit/2022-09-harpie-judging/blob/main/004-M/004-m.md

### Attacker's Mindset > Rug Pull

- [ ] **[SOL-AM-RP-1]** Can the admin of the protocol pull assets from the protocol?
  - Some protocols grant an admin with a privilege of pulling assets directly from the protocol. In general, if there is an actor that can affect the user funds directly it must be reported.
  - **Remediation:** Allow access to only the relevant parts of protocol funds, e.g. by tracking fees internally. Forcing a timelock on the admin actions can be another mitigation.
  - **References:**
    - https://solodit.xyz/issues/m-06-centralisation-risk-admin-role-of-tokenmanagereth-can-rug-pull-all-eth-from-the-bridge-code4rena-skale-skale-contest-git

### Attacker's Mindset > Sybil Attack

- [ ] **[SOL-AM-SybilAttack-1]** Is there a mechanism depending on the number of users?
  - It is very easy to trigger actions using a lot of alternative addresses on blockchain. Any quorum mechanism or utilization based rewarding system can be vulnerable to sybil attacks.
  - **Remediation:** Do not rely on the number of users in quorum design.
  - **References:**
    - https://solodit.xyz/issues/h-7-sybil-on-withdrawal-requests-can-allow-leverage-factor-manipulation-with-flashloans-sherlock-carapace-carapace-git
    - https://solodit.xyz/issues/routers-can-sybil-attack-the-sponsor-vault-to-drain-funds-spearbit-connext-pdf
    - https://solodit.xyz/issues/h-5-staker-rewards-can-be-gathered-with-maximal-multiplier-no-matter-how-borrowers-are-overdue-sherlock-union-finance-union-finance-git

### Basics > Access Control

- [ ] **[SOL-Basics-AC-1]** Did you clarify all the actors and their allowed interactions in the protocol?
  - This is a general check item. Having a clear understanding of all relevant actors and interactions in the protocol is critical for security.
  - **Remediation:** List down all the actors and interactions and draw a diagram.

- [ ] **[SOL-Basics-AC-2]** Are there functions lacking proper access controls?
  - Access controls determine who can use certain functions of a contract. If these are missing or improperly implemented, it can expose the contract to unauthorized changes or withdrawals.
  - **Remediation:** Implement and rigorously test access controls like `onlyOwner` or role-based permissions to ensure only authorized users can access certain functions.

- [ ] **[SOL-Basics-AC-3]** Do certain addresses require whitelisting?
  - Whitelisting allows only a specific set of addresses to interact with the contract, offering an additional layer of security against malicious actors.
  - **Remediation:** Establish a whitelisting mechanism and ensure that only trusted addresses can execute sensitive or restricted operations.

- [ ] **[SOL-Basics-AC-4]** Does the protocol allow transfer of privileges?
  - Transfer of critical privileges must be done in two-step process. A two-step transfer process, usually involving a request followed by a confirmation, adds an extra layer of security against unintentional or malicious owner changes.
  - **Remediation:** Implement a two-step transfer mechanism that requires the new actor to accept the transfer, ensuring better security and intentional ownership changes.

- [ ] **[SOL-Basics-AC-5]** What happens during the transfer of privileges?
  - The protocol needs to work consistently and reasonably even during the transfer of privileges.
  - **Remediation:** Double check how the protocol works during the transfer of privileges.

- [ ] **[SOL-Basics-AC-6]** Does the contract inherit others?
  - If you do not override a parent contract's function explicitly, the parent's one will be exposed with its visibility and probably a wrong accessibiliy.
  - **Remediation:** Make sure you check the accessibility to the parent's external/public functions.

- [ ] **[SOL-Basics-AC-7]** Does the contract use `tx.origin` in validation?
  - Use of `tx.origin` for authorization may be abused by a malicious contract forwarding calls from the legitimate user. Use `msg.sender` instead. `require( tx.origin == msg.sender)` is a useful check to ensure that the `msg.sender` is an EOA(externally owned account).
  - **Remediation:** Make sure you know the difference of `tx.origin` and `msg.sender` and use properly.
  - **References:**
    - https://swcregistry.io/docs/SWC-115

### Basics > Array / Loop

- [ ] **[SOL-Basics-AL-1]** What happens on the first and the last cycle of the iteration?
  - Sometimes the first and last cycles have a different logic from others and there can be problems.
  - **Remediation:** Ensure the logic is correct for the first and the last cycles.

- [ ] **[SOL-Basics-AL-4]** How does the protocol remove an item from an array?
  - `delete` does not rearrange the array but just resets the element.
  - **Remediation:** Copy the last element to the index of the element to be removed and decrease the length of an array.

- [ ] **[SOL-Basics-AL-5]** Does any function get an index of an array as an argument?
  - If an array is supposed to be updated (removal in the middle), the indexes will change.
  - **Remediation:** Do not use an index of an array that is supposed to be updated as a parameter of a function.

- [ ] **[SOL-Basics-AL-6]** Is the summing of variables done accurately compared to separate calculations?
  - Direct calculation against a sum may yield different results than the sum of individual calculations, leading to precision issues.
  - **Remediation:** Ensure that summation logic is thoroughly tested and verified, especially when dealing with financial calculations to maintain accuracy.
  - **References:**
    - https://github.com/sherlock-audit/2022-11-isomorph-judging/issues/174

- [ ] **[SOL-Basics-AL-7]** Is it fine to have duplicate items in the array?
  - In most cases, an array (especially an input array by users) is supposed to be unique.
  - **Remediation:** Add a validation to check the array is unique.
  - **References:**
    - https://solodit.cyfrin.io/issues/duplicate-interactions-mixbytes-none-liquorice-markdown

- [ ] **[SOL-Basics-AL-8]** Is there any issue with the first and the last iteration?
  - The first and the last iteration in loops can sometimes have edge cases that differ from other iterations, possibly leading to vulnerabilities.
  - **Remediation:** Always test the initial and the last iteration separately and ensure consistent behavior throughout all iterations.

- [ ] **[SOL-Basics-AL-9]** Is there possibility of iteration of a huge array?
  - Due to the block gas limit, there is a clear limitation in the amount of operation that can be handled in a transaction.
  - **Remediation:** Ensure the number of iterations is properly bounded.
  - **References:**
    - https://solodit.cyfrin.io/issues/m-5-users-buying-too-many-tickets-will-dos-them-and-the-protocol-if-they-are-the-winner-due-to-oog-sherlock-winnables-raffles-git

- [ ] **[SOL-Basics-AL-10]** Is there a potential for a Denial-of-Service (DoS) attack in the loop?
  - Loops that contain external calls or are dependent on user-controlled input can be exploited to halt the contract's functions. (e.g. sending ETH to multiple users)
  - **Remediation:** Ensure a failure of a single iteration does not revert the whole operation.

- [ ] **[SOL-Basics-AL-11]** Is `msg.value` used within a loop?
  - `msg.value` is consistent for the whole transaction. If it is used in the for loop, it is likely there is a mistake in accounting.
  - **Remediation:** Avoid using `msg.value` inside loops. Refer to multi-call vulnerability.

- [ ] **[SOL-Basics-AL-12]** Is there a loop to handle batch fund transfer?
  - If there is a mechanism to transfer funds out based on some kind of shares, it is likely that there is a problem of 'dust' funds not handled correctly.
  - **Remediation:** Make sure the last transfer handles all residual.

- [ ] **[SOL-Basics-AL-13]** Is there a break or continue inside a loop?
  - Sometimes developers overlook the edge cases that can happened due to the break or continue in the middle of the loop.
  - **Remediation:** Make sure the break or continue inside a loop does not lead to unexpected behaviors.

### Basics > Event

- [ ] **[SOL-Basics-Event-1]** Does the protocol emit events on important state changes?
  - Emitting events properly is important especially if the change is critical.
  - **Remediation:** Ensure to emit events in all important functions.

### Basics > Function

- [ ] **[SOL-Basics-Function-1]** Are the inputs validated?
  - Inputs to functions should be validated to prevent unexpected behavior.
  - **Remediation:** Ensure thorough validation. E.g. min/max for numeric values, start/end for dates, ownership of positions.
  - **References:**
    - https://solodit.xyz/issues/missing-owner-check-on-from-when-transferring-tokens-spearbit-clober-pdf
    - https://solodit.xyz/issues/m-13-bondbasesdasetdefaults-doesnt-validate-inputs-sherlock-bond-bond-protocol-git
    - https://solodit.xyz/issues/h-16-user-supplied-amm-pools-and-no-input-validation-allows-stealing-of-steth-protocol-fees-sherlock-swivel-illuminate-git

- [ ] **[SOL-Basics-Function-2]** Are the outputs validated?
  - Outputs of functions should be validated to prevent unexpected behavior.
  - **Remediation:** Ensure the outputs are valid.

- [ ] **[SOL-Basics-Function-3]** Can the function be front-run?
  - Front-running can allow attackers to prioritize their transactions over others.
  - **Remediation:** Make sure there is no unexpected risk even if attackers front-run.
  - **References:**
    - https://solodit.xyz/issues/m-08-borrower-can-cause-a-dos-by-frontrunning-a-liquidation-and-repaying-as-low-as-1-wei-of-the-current-debt-code4rena-venus-protocol-venus-protocol-isolated-pools-git
    - https://solodit.xyz/issues/m-01-new-proposals-can-be-dosd-by-frontrunning-zachobront-none-optimismgovernormd-markdown_
    - https://solodit.xyz/issues/h-01-challenges-can-be-frontrun-with-de-leveraging-to-cause-lossses-for-challengers-code4rena-frankencoin-frankencoin-git

- [ ] **[SOL-Basics-Function-4]** Are the code comments coherent with the implementation?
  - Misleading or outdated comments can result in misunderstood function behaviors.
  - **Remediation:** Keep comments updated and ensure they accurately describe the function logic.
  - **References:**
    - https://solodit.xyz/issues/m-08-wrong-comment-in-getfee-code4rena-yeti-finance-yeti-finance-contest-git
    - https://solodit.xyz/issues/m-8-wrong-change_collateral_delay-in-collateralbook-sherlock-isomorph-isomorph-git

- [ ] **[SOL-Basics-Function-5]** Can edge case inputs (0, max) result in unexpected behavior?
  - Edge input values can lead to unexpected behavior.
  - **Remediation:** Make sure the function works as expected for the edge values.
  - **References:**
    - https://solodit.xyz/issues/lack-of-validation-openzeppelin-bancor-compounding-rewards-audit-markdown
    - https://solodit.xyz/issues/p1-m07-lack-of-input-validation-openzeppelin-eco-contracts-audit-markdown

- [ ] **[SOL-Basics-Function-6]** Does the function allow arbitrary user input?
  - Implementing a function that accepts arbitrary user input and makes low-level calls based on this data introduces a significant security risk. Low-level calls in Solidity, such as call(), are powerful and can lead to unintended contract behavior if not used cautiously. With the ability for users to supply arbitrary data, they can potentially trigger unexpected paths in the contract logic, exploit reentrancy vulnerabilities, or even interact with other contracts in a malicious manner.
  - **Remediation:** Restrict the usage of low-level calls, especially when combined with arbitrary user input. Ensure that any data used in these calls is thoroughly validated and sanitized.

- [ ] **[SOL-Basics-Function-7]** Should it be `external`/`public`?
  - Ensure the visibility modifier is appropriate for the function's use, preventing unnecessary exposure.
  - **Remediation:** Limit function visibility to the strictest level possible (`private` or `internal`).

- [ ] **[SOL-Basics-Function-8]** Does this function need to be called by only EOA or only contracts?
  - There are several edge cases regarding the caller checking mechanism, both for EOA and contracts.
  - **Remediation:** Ensure the correct access control is implemented according to the protocol's context. (read all the references)
  - **References:**
    - https://solodit.xyz/issues/m-15-onlyeoaex-modifier-that-ensures-call-is-from-eoa-might-not-hold-true-in-the-future-sherlock-blueberry-blueberry-git
    - https://solodit.xyz/issues/m-17-addressiscontract-is-not-a-reliable-way-of-checking-if-the-input-is-an-eoa-code4rena-stakehouse-protocol-lsd-network-stakehouse-contest-git

- [ ] **[SOL-Basics-Function-9]** Does this function need to be restricted for specific callers?
  - Ensure that functions modifying contract state or accessing sensitive operations are access-controlled.
  - **Remediation:** Implement access control mechanisms like `onlyOwner` or custom modifiers.
  - **References:**
    - https://solodit.xyz/issues/h-8-lack-of-access-control-for-mintrebalancer-and-burnrebalancer-sherlock-none-ussd-autonomous-secure-dollar-git
    - https://solodit.xyz/issues/h-02-anyone-can-change-approvaldisapproval-threshold-for-any-action-using-llamarelativequorum-strategy-code4rena-llama-llama-git
    - https://solodit.xyz/issues/anyone-can-take-a-loan-out-on-behalf-of-any-collateral-holder-at-any-terms-spearbit-astaria-pdf

### Basics > Inheritance

- [ ] **[SOL-Basics-Inheritance-1]** Is it necessary to limit visibility of parent contract's public functions?
  - External/Public functions of all parent contracts will be exposed with the same visibility as long as they are not overridden.
  - **Remediation:** Make sure to expose only relevant functions from parent contracts.

- [ ] **[SOL-Basics-Inheritance-2]** Were all necessary functions implemented to fulfill inheritance purpose?
  - Parent contracts often assume the inheriting contracts to implement public functions to utilize the parent's functionality. Sometimes developers miss implementing them and it makes the inheritance useless.
  - **Remediation:** Make sure to expose relevant functions from parent contracts.
  - **References:**
    - https://solodit.xyz/issues/m-02-pauseunpause-functionalities-not-implemented-in-many-pausable-contracts-code4rena-stader-labs-stader-labs-git
    - https://twitter.com/bytes032/status/1736065591536935366

- [ ] **[SOL-Basics-Inheritance-3]** Has the contract implemented an interface?
  - Interfaces are used by other protocols to interact with the protocol. Missing implementation will lead to unexpected cases.
  - **Remediation:** Make sure to implement all functions specified in the interface.

- [ ] **[SOL-Basics-Inheritance-4]** Does the inheritance order matter?
  - Inheriting contracts in the wrong order can lead to unexpected behavior, e.g. storage allocation.
  - **Remediation:** Verify the inheritance chain is ordered from 'most base-like' to 'most derived' to prevent issues like incorrect variable initialization.

### Basics > Initialization

- [ ] **[SOL-Basics-Initialization-1]** Are important state variables initialized properly?
  - Overlooking explicit initialization of state variables can lead to critical issues.
  - **Remediation:** Make sure to initialize all state variables correctly.
  - **References:**
    - https://solodit.xyz/issues/h-01-mintersolstartinflation-can-be-bypassed-code4rena-backd-backd-tokenomics-contest-git

- [ ] **[SOL-Basics-Initialization-2]** Has the contract inherited OpenZeppelin's Initializable?
  - If the contract is supposed to be inherited by other contracts, `onlyInitializing` modifier MUST be used instead of `initializer`.
  - **Remediation:** Make sure to use the correct modifier for the initializer function.
  - **References:**
    - https://solodit.xyz/issues/h-03-wrong-implementation-of-eip712metatransaction-code4rena-rolla-rolla-contest-git

- [ ] **[SOL-Basics-Initialization-3]** Does the contract have a separate initializer function other than a constructor?
  - Initializer function can be front-run right after the deployment. The impact is critical if the initializer sets the access controls.
  - **Remediation:** Use the factory pattern to allow only the factory to call the initializer or ensure it is not front-runnable in the deploy script.
  - **References:**
    - https://solodit.xyz/issues/initialization-functions-can-be-front-run-trailofbits-advanced-blockchain-pdf

### Basics > Map

- [ ] **[SOL-Basics-Map-1]** Is there need to delete the existing item from a map?
  - If a variable of nested structure is deleted, only the top-level fields are reset by default values (zero) and the nested level fields are not reset.
  - **Remediation:** Always ensure that inner fields are deleted before the outer fields of the structure.

### Basics > Math

- [ ] **[SOL-Basics-Math-1]** Is the mathematical calculation accurate?
  - Ensure that the logic behind any mathematical operation is correctly implemented.
  - **Remediation:** Verify calculations against established mathematical rules in the document or the comments.

- [ ] **[SOL-Basics-Math-2]** Is there any loss of precision in time calculations?
  - Loss of precision can lead to significant errors over time or frequent calculations.
  - **Remediation:** Use appropriate data types and ensure rounding methods are correctly applied.

- [ ] **[SOL-Basics-Math-3]** Are you aware that expressions like `1 day` are cast to `uint24`, potentially causing overflows?
  - Operations with certain expressions might lead to unintended data type conversions.
  - **Remediation:** Always be explicit with data types and avoid relying on implicit type conversions.

- [ ] **[SOL-Basics-Math-4]** Is there any case where dividing is done before multiplication?
  - Multiplying before division is generally better to keep the precision.
  - **Remediation:** To avoid loss of precision, always multiply first and then divide.

- [ ] **[SOL-Basics-Math-5]** Does the rounding direction matter?
  - Rounding direction often matters when the accounting relies on user's shares.
  - **Remediation:** Use the proper rounding direction in favor of the protocol

- [ ] **[SOL-Basics-Math-6]** Is there a possibility of division by zero?
  - Division by zero will revert the transaction.
  - **Remediation:** Always check denominators before division.

- [ ] **[SOL-Basics-Math-7]** Even in versions like `>0.8.0`, have you ensured variables won't underflow or overflow leading to reverts?
  - Variables can sometimes exceed their bounds, causing reverts.
  - **Remediation:** Use checks to prevent variable underflows and overflows.

- [ ] **[SOL-Basics-Math-8]** Are you aware that assigning a negative value to an unsigned integer causes a revert?
  - Unsigned integers cannot hold negative values.
  - **Remediation:** Always ensure that only non-negative values are assigned to unsigned integers.

- [ ] **[SOL-Basics-Math-9]** Have you properly reviewed all usages of `unchecked{}`?
  - Arithmetics do not overflow inside the `unchecked{}` block.
  - **Remediation:** Use `unchecked{}` only when it is strictly guaranteed that no overflow/underflow happens.

- [ ] **[SOL-Basics-Math-10]** In comparisons using < or >, should you instead be using ≤ or ≥?
  - Usage of incorrect inequality can cause unexpected behavior for the edge values.
  - **Remediation:** Review the logic and ensure the appropriate comparison operators are used.

- [ ] **[SOL-Basics-Math-11]** Have you taken into consideration mathematical operations in inline assembly?
  - Inline assembly can behave differently than high-level language constructs. (division by zero, overflow/underflow do not revert!)
  - **Remediation:** Ensure mathematical operations in inline assembly are properly tested and verified.

- [ ] **[SOL-Basics-Math-12]** What happens for the minimum/maximum values included in the calculation?
  - If the calculation includes numerous terms, you need to confirm all edge cases where each term has the possible min/max values.
  - **Remediation:** Ensure the edge cases do not lead to unexpected outcome.

### Basics > Payment

- [ ] **[SOL-Basics-Payment-1]** Is it possible for the receiver to revert?
  - There are cases where a receiver contract can deny the transaction. For example, a malicious receiver can have a fallback to revert. If a caller tried to send funds using `transfer` or `send`, the whole transaction will revert. (Meanwhile, `call()` does not revert but returns a boolean)
  - **Remediation:** Make sure that the receiver can not deny the payment or add a backup handler with a try-catch.

- [ ] **[SOL-Basics-Payment-2]** Does the function gets the payment amount as a parameter?
  - For ETH deposits, `msg.value` must be checked if it is not less than the amount specified.
  - **Remediation:** Require `msg.value==amount`.

- [ ] **[SOL-Basics-Payment-3]** Are there vulnerabilities related to force-feeding?
  - Certain actions like self-destruct, deterministic address feeding, and coinbase transactions can be used to force-feed contracts.
  - **Remediation:** Ensure the contract behaves as expected when receiving unexpected funds.
  - **References:**
    - https://scsfg.io/hackers/unexpected-ether/

- [ ] **[SOL-Basics-Payment-4]** What is the minimum deposit/withdrawal amount?
  - Dust deposit/withdrawal often can lead to various vulnerabilities, e.g. rounding issue in accounting or Denial-Of-Service.
  - **Remediation:** Add a threshold for the deposit/withdrawal amount.

- [ ] **[SOL-Basics-Payment-5]** How is the withdrawal handled?
  - The best practice in withdrawal process is to implement pull-based approach. Track the accounting and let users pull the payments instead of sending funds proactively.
  - **Remediation:** Implement pull-based approach in withdrawals.

- [ ] **[SOL-Basics-Payment-7]** Is it possible for native ETH to be locked in the contract?
  - If a `payable` function does not transfer all ETH passed in `msg.value` and the contract does not have a withdraw method, ETH will be locked in the contract
  - **Remediation:** Make sure either no ETH remains in the contract at the end of `payable` functions or make sure there is a `withdraw` function.
  - **References:**
    - https://solodit.xyz/issues/m-09-bathbuddy-locks-up-ether-it-receives-code4rena-rubicon-rubicon-contest-git
    - https://solodit.xyz/issues/m-22-eth-sent-when-calling-executeassmartwallet-function-can-be-lost-code4rena-stakehouse-protocol-lsd-network-stakehouse-contest-git

### Basics > Type

- [ ] **[SOL-Basics-Type-1]** Is there a forced type casting?
  - Explicit type casting does not revert on overflow/underflow.
  - **Remediation:** Avoid a forced type casting as much as possible and ensure values are in the range of type limit.
  - **References:**
    - https://solodit.xyz/issues/risk-of-token-theft-due-to-unchecked-type-conversion-trailofbits-none-primitive-hyper-pdf

- [ ] **[SOL-Basics-Type-2]** Does the protocol use time units like `days`?
  - The time units are of `uint8` type and this can lead to unintended overflow.
  - **Remediation:** Double check the calculations including time units and ensure there is no overflow for reasonable values.
  - **References:**
    - https://solodit.xyz/issues/m-05-expiration-calculation-overflows-if-call-option-duration-195-days-code4rena-cally-cally-contest-git

### Centralization Risk

- [ ] **[SOL-CR-1]** What happens to the user accounting in special conditions?
  - Users must be allowed to manage their existing positions in all protocol status. For example, users must be able to repay the debt even when the protocol is paused or the protocol should not accrue debts when it is paused.
  - **Remediation:** Ensure user positions are protected in special/emergent protocol situations.

- [ ] **[SOL-CR-2]** Is there a pause mechanism?
  - Some functionalities must work even when the whole protocol is paused. For example, users must be able to withdraw (or repay) assets even while the protocol is paused.
  - **Remediation:** Review the pause mechanism thoroughly to ensure that it only affects intended functions and can't be abused by a malicious operator.

- [ ] **[SOL-CR-3]** Is there a functionality for the admin to withdraw from the protocol?
  - Some protocols are written to allow admin pull any amount of assets from the pool. This is a red flag and MUST be disallowed. The best practice is to track the protocol fee and only allow access to that amount.
  - **Remediation:** Ensure the admin can not steal user funds. Track the protocol earning separately.

- [ ] **[SOL-CR-4]** Can the admin change critical protocol property immediately?
  - Changes in the critical protocol properties MUST go through a cooling period to allow users react on the changes.
  - **Remediation:** Implement a timelock for the critical property changes and emit proper events.

- [ ] **[SOL-CR-5]** Is there any admin setter function missing events?
  - Events are often used to monitor the protocol status. Without emission of events, users might be affected due to ignorance of the changes.
  - **Remediation:** Emit proper events on critical configuration changes.

- [ ] **[SOL-CR-6]** How is the ownership/privilege transferred??
  - Critical privileges MUST be transferred via a two-step process and the protocol MUST behave as expected before/during/after transfer.
  - **Remediation:** Use two-step process for transferring critical privileges and ensure the protocol works properly before/during/after the transfer.

- [ ] **[SOL-CR-7]** Is there a proper validation in privileged setter functions?
  - The validation on the protocol configuration values is often overlooked assuming the admin is trusted. But it is always recommended clarifying the range of each configuration value and validate in setter functions. (e.g. protocol fee should be limited)
  - **Remediation:** Ensure the protocol level properties are properly validated in the documented range.

### External Call

- [ ] **[SOL-EC-1]** What are the implications if the call reenters a different function?
  - Reentrant calls to different functions can unpredictably alter contract states. Note that view functions should be checked as well to prevent the Readonly Reentrancy.
  - **Remediation:** Ensure the contract state is maintained reasonably during the external interactions.
  - **References:**
    - https://medium.com/@zokyo.io/read-only-reentrancy-attacks-understanding-the-threat-to-your-smart-contracts-99444c0a7334
    - https://solodit.xyz/issues/m-03-read-only-reentrancy-is-possible-code4rena-angle-protocol-angle-protocol-invitational-git

- [ ] **[SOL-EC-2]** Is there a multi-call?
  - Mismanagement of `msg.value` across multiple calls can lead to vulnerabilities.
  - **Remediation:** Do not use ETH in multicall.
  - **References:**
    - https://solodit.xyz/issues/m-08-passing-multiple-eth-deposits-in-orders-array-will-use-the-same-msgvalue-many-times-code4rena-nested-finance-nested-finance-contest-git

- [ ] **[SOL-EC-3]** What are the risks associated with using delegatecall in smart contracts?
  - A delegatecall is a low-level function call that delegates the execution of a function in another contract while maintaining the original contract's context. It can lead to critical vulnerabilities if the destination address is not secure or can be altered by an unauthorized party.
  - **Remediation:** Use delegatecall only with trusted contracts, and ensure that the address to be delegated to is not changeable by unauthorized users. Implement strong access controls and audit the code for potential security issues before deployment.

- [ ] **[SOL-EC-4]** Is the external contract call necessary?
  - Unnecessary external calls can introduce vulnerabilities.
  - **Remediation:** Evaluate and eliminate non-essential external contract calls.

- [ ] **[SOL-EC-5]** Has the called address been whitelisted?
  - Calling untrusted addresses can lead to malicious actions.
  - **Remediation:** Ensure that only whitelisted or trusted contract addresses are called.
  - **References:**
    - https://solodit.xyz/issues/too-generic-calls-in-genericbridgefacet-allow-stealing-of-tokens-spearbit-lifi-pdf
    - https://solodit.xyz/issues/hardcode-or-whitelist-the-axelar-destinationaddress-spearbit-lifi-pdf

- [ ] **[SOL-EC-6]** Is there suspicion when a fixed gas amount is specified?
  - Specifying fixed gas amounts can lead to out-of-gas vulnerabilities.
  - **Remediation:** Use dynamic gas estimation or ensure sufficient gas is available before the call.
  - **References:**
    - https://solodit.xyz/issues/m-02-fixed-amount-of-gas-sent-in-call-may-be-insufficient-code4rena-joyn-joyn-contest-git
    - https://solodit.xyz/issues/a-malicious-fee-receiver-can-cause-a-denial-of-service-trailofbits-nftx-protocol-v2-pdf

- [ ] **[SOL-EC-8]** Is the contract passing large data to an unknown address?
  - Large data passed to untrusted addresses may be exploited for griefing.
  - **Remediation:** Limit data passed or employ inline assembly to manage data transfer.
  - **References:**
    - https://solodit.xyz/issues/h-2-malicious-user-can-use-an-excessively-large-_toaddress-in-oftcoresendfrom-to-break-layerzero-communication-sherlock-uxd-uxd-protocol-git

- [ ] **[SOL-EC-10]** Are there any delegate calls to non-library contracts?
  - Non-library delegate calls can alter the state of the calling contract.
  - **Remediation:** Thoroughly review and verify such delegate calls so that the delegate calls do not change the caller's state unexpectedly.

- [ ] **[SOL-EC-11]** Is there a strict policy against delegate calls to untrusted contracts?
  - Delegate calls grant the called contract the context of the caller, risking state alterations.
  - **Remediation:** Restrict delegate calls to only trusted, reviewed, and audited contracts.
  - **References:**
    - https://solodit.xyz/issues/m-01-delegate-call-in-vault_execute-can-alter-vaults-ownership-code4rena-fractional-fractional-v2-contest-git

- [ ] **[SOL-EC-12]** Is the address's existence verified?
  - Calling non-existent addresses can lead to unintended behaviors. Low level calls (call, delegate call and static call) return success if the called contract doesn't exist (not deployed or destructed)
  - **Remediation:** Verify the existence of an address before making a call.
  - **References:**
    - https://solodit.xyz/issues/h-02-non-existing-revenue-contract-can-be-passed-to-claimrevenue-to-send-all-tokens-to-treasury-code4rena-debt-dao-debt-dao-contest-git
    - https://solodit.xyz/issues/m-10-call-to-non-existing-contracts-returns-success-code4rena-biconomy-biconomy-hyphen-20-contest-git
    - https://solodit.xyz/issues/lack-of-contract-existence-check-on-delegatecall-will-result-in-unexpected-behavior-trailofbits-degate-pdf
    - https://solodit.xyz/issues/m-02-solmates-erc20-does-not-check-for-token-contracts-existence-which-opens-up-possibility-for-a-honeypot-attack-code4rena-size-size-contest-git
    - https://solodit.xyz/issues/m-25-vault-can-be-created-for-not-yet-existing-erc20-tokens-which-allows-attackers-to-set-traps-to-steal-nfts-from-borrowers-code4rena-astaria-astaria-git
    - https://solodit.xyz/issues/calls-made-to-non-existentremoved-routes-or-controllers-will-not-result-in-failure-consensys-socket-markdown

- [ ] **[SOL-EC-13]** Is the check-effect-interaction pattern being utilized?
  - The check-effect-interaction pattern prevents reentrancy attacks.
  - **Remediation:** Adhere to the CEI pattern and use `reentrancyGuard` judiciously.
  - **References:**
    - https://www.geeksforgeeks.org/reentrancy-attack-in-smart-contracts/
    - https://solodit.xyz/issues/m-09-malicious-royalty-recipient-can-steal-excess-eth-from-buy-orders-code4rena-caviar-caviar-private-pools-git
    - https://solodit.xyz/issues/h-01-re-entrancy-in-settleauction-allow-stealing-all-funds-code4rena-kuiper-kuiper-contest-git

- [ ] **[SOL-EC-14]** How is the msg.sender handled?
  - On interacting with external contracts, the caller becomes a new `msg.sender` instead of the original caller.
  - **Remediation:** Ensure the validation is in place to check the actor is handled correctly.
  - **References:**
    - https://solodit.xyz/issues/swapinternal-shouldnt-use-msgsender-spearbit-connext-pdf
    - https://solodit.xyz/issues/m-01-onlycentrifugechainorigin-cant-require-msgsender-equal-axelargateway-code4rena-centrifuge-centrifuge-git

### Low Level

- [ ] **[SOL-LL-1]** Is there validation on the size of the input data?
  - In low-level, data size is not checked by default and it can affect the unintended memory locations.
  - **Remediation:** Validate that inputs do not exceed the size of it's expected type and either revert or clean the unused bits depending on your use case before using that value.
  - **References:**
    - https://github.com/AmadiMichael/LowLevelVulnerabilities?tab=readme-ov-file#validate-all-input-bit-size

- [ ] **[SOL-LL-2]** What happens if there is no matching function signature?
  - It is expected to revert if there is no matching function signature in the contract. Overlooking this can let the execution continue into other parts of the unintended bytecode.
  - **Remediation:** Ensure that the code reverts after comparing all supported function signatures, fallback etc and not matching any.
  - **References:**
    - https://github.com/AmadiMichael/LowLevelVulnerabilities?tab=readme-ov-file#end-execution-after-function-dispatching

- [ ] **[SOL-LL-3]** Is it checked if the target address of a call has the code?
  - Calling an address without code is always successful.
  - **Remediation:** Ensure that addresses being called, static-called or delegate-called have code deployed.
  - **References:**
    - https://github.com/AmadiMichael/LowLevelVulnerabilities?tab=readme-ov-file#ensure-that-addresses-being-called-static-called-or-delegate-called-have-code-deployed-to-them

- [ ] **[SOL-LL-4]** Is there a check on the return data size when calling precompiled code?
  - When calling precompiled code, the call is still successful on error or ”failure”. A failed precompile call simply has a return data size of 0.
  - **Remediation:** Check the return data size not the success of the call to determine if it failed.
  - **References:**
    - https://github.com/AmadiMichael/LowLevelVulnerabilities?tab=readme-ov-file#when-calling-precompiles-check-the-returndatasize-not-the-success-of-the-call-to-determine-if-it-failed

- [ ] **[SOL-LL-5]** Is there a non-zero check for the denominator?
  - At the evm level and in yul/inline assembly, when dividing or modulo'ing by 0, It does not revert with Panic(18) as solidity would do, its result 0. If this behavior is not desired it should be checked. Basically, x / 0 = 0 and x % 0 = 0.
  - **Remediation:** Check if the denominator is zero before division.
  - **References:**
    - https://github.com/AmadiMichael/LowLevelVulnerabilities?tab=readme-ov-file#when-dividing-or-moduloin-check-that-the-denominator-is-not-0

### Signature

- [ ] **[SOL-Signature-1]** Are signatures guarded against replay attacks?
  - Lacking protection mechanisms like `nonce` and `block.chainid` can make signatures vulnerable to replay attacks. Also, EIP-712 provides a standard for creating typed and structured data to be signed, ensuring better security and user experience.
  - **Remediation:** Implement a `nonce` system and incorporate `block.chainid` in your signature scheme. Ensure adherence to EIP-712 for all signatures.

- [ ] **[SOL-Signature-2]** Are signatures protected against malleability issues?
  - Signature malleability can be exploited by attackers to produce valid signatures without the private key. Using outdated versions of libraries can introduce known vulnerabilities.
  - **Remediation:** Avoid using `ecrecover()` for signature verification. Instead, utilize the OpenZeppelin's latest version of ECDSA to ensure signatures are safe from malleability issues.

- [ ] **[SOL-Signature-3]** Does the returned public key from the signature verification match the expected public key?
  - Mismatched public keys can indicate an incorrect or malicious signer, potentially leading to unauthorized actions.
  - **Remediation:** Implement rigorous checks to ensure the public key derived from a signature matches the expected signer's public key.

- [ ] **[SOL-Signature-4]** Is the signature originating from the appropriate entity?
  - If signatures aren't properly checked, malicious actors might exploit them, leading to unauthorized transactions or actions.
  - **Remediation:** Ensure strict verification mechanisms are in place to confirm that signatures originate from the expected entities.

- [ ] **[SOL-Signature-5]** If the signature has a deadline, is it still valid?
  - Signatures with expiration dates that aren't checked can be reused maliciously after they should no longer be valid.
  - **Remediation:** Always check the expiration date of signatures and ensure they're not accepted past their valid period.

