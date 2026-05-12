---
name: cyfrin-gas
description: Cyfrin audit checklist — gas optimization and efficiency items for Solidity smart contracts
category: checklist
---
<!-- Source: Cyfrin/audit-checklist -->
<!-- Auto-generated from https://github.com/Cyfrin/audit-checklist -->
<!-- Total items: 5 -->

# Cyfrin Audit Checklist — Gas Optimization

Gas-related checklist items extracted from [Cyfrin's audit checklist](https://github.com/Cyfrin/audit-checklist).

## Checklist Items

### External Call

- [ ] **[SOL-EC-9]** What happens if the call returns vast data?
  - External calls returning vast data can deplete available gas.
  - **Remediation:** Limit or verify data size returned from external sources.
  - **References:**
    - https://solodit.cyfrin.io/?b=false&f=&fc=gte&ff=&fn=1&i=HIGH%2CMEDIUM&p=1&pc=&r=all&s=gas+griefing&t=

- [ ] **[SOL-EC-7]** What happens if the call consumes all provided gas?
  - Calls that consume all available gas can halt subsequent actions.
  - **Remediation:** Ensure enough gas is reserved for post-call tasks or use dynamic gas estimation.
  - **References:**
    - https://solodit.xyz/issues/a-malicious-fee-receiver-can-cause-a-denial-of-service-trailofbits-nftx-protocol-v2-pdf
    - https://solodit.xyz/issues/poison-order-that-consumes-gas-can-block-market-trades-wont-fix-consensys-0x-v3-exchange-markdown

### Basics > Payment

- [ ] **[SOL-Basics-Payment-6]** Is `transfer()` or `send()` used for sending ETH?
  - The transfer() and send() functions forward a fixed amount of 2300 gas. Historically, it has often been recommended to use these functions for value transfers to guard against reentrancy attacks. However, the gas cost of EVM instructions may change significantly during hard forks which may break already deployed contract systems that make fixed assumptions about gas costs. For example. EIP 1884 broke several existing smart contracts due to a cost increase of the SLOAD instruction.
  - **Remediation:** Use `call()` to prevent potential gas issues.
  - **References:**
    - https://solodit.xyz/issues/use-call-instead-of-transfer-cyfrin-none-woosh-deposit-vault-markdown
    - https://solodit.xyz/issues/m-5-call-should-be-used-instead-of-transfer-on-an-address-payable-sherlock-dodo-dodo-git
    - https://solodit.xyz/issues/m-10-addresscallvaluex-should-be-used-instead-of-payabletransfer-code4rena-debt-dao-debt-dao-contest-git

### Multi-chain/Cross-chain

- [ ] **[SOL-McCc-5]** Is there any possibility of exploiting low gas fees to execute many transactions?
  - Some attacks become viable with low gas costs or when a large number of transactions can be processed.
  - **Remediation:** Evaluate and mitigate potential attack vectors associated with gas fees.
  - **References:**
    - https://github.com/0xJuancito/multichain-auditor#gas-fees

### Heuristics

- [ ] **[SOL-Heuristics-5]** Does the `try/catch` block account for potential gas shortages?
  - A `try/catch` block without adequate gas can fail, leading to unexpected behaviors.
  - **Remediation:** Ensure sufficient gas is supplied when using the `try/catch` block.
  - **References:**
    - https://forum.openzeppelin.com/t/a-brief-analysis-of-the-new-try-catch-functionality-in-solidity-0-6/2564

