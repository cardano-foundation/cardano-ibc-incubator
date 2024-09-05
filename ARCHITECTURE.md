# Architecture Overview Document
This document summarizes the solution architecture of the Cardano IBC implementation.

## Table of Contents
1. Executive Summary
2. Solution Architecture Overview
3. Business Case
4. Requirements Summary
5. High-Level Solution Design
6. Detailed Solution Architecture
7. Integration Architecture
8. Data Architecture
9. Security Architecture
10. Infrastructure Requirements
11. Non-Functional Requirements
12. Transition and Implementation Strategy
13. Risks and Mitigations
14. Appendices
15. Glossary

## 1. Executive Summary

Whereas Cardano is in general interoperable with other decentralized protocols and has improved this over the course of the last two years, it still clearly lacks specific interoperability features limiting the ability to attract projects and [developers from other ecosystems](https://storage.googleapis.com/electric-capital-developer-report/report/2023/pdf/Electric_Capital_Developer_Report_2023.pdf) as well as the number of options to design composable architectures needed for sophisticated blockchain applications. There have been several attempts in the past to overcome this lack of an architectural building block but none of them resulted in a viable framework that projects could use to build application specific sidechains that settle on Cardano while still allowing them to leverage increased scalability, privacy and flexibility features. Furthermore, besides [Wanchain](https://www.wanchain.org/) and [Milkomeda](https://milkomeda.com/) there are no bridges with a significant transfer volume available that allow users to interact and transact with other blockchain ecosystems.

To overcome this situation Cardano Foundation has evaluated several cross chain message passing solutions that allow the implementation of cross blockchain network communication and by that enhancing the cross blockchain interoperability of Cardano. Whereas there have been several message passing protocols implemented in other networks like [XCM in Polkadot](https://wiki.polkadot.network/docs/learn-xcm-index), [Warp Messaging in Avalanche](https://docs.avax.network/cross-chain/avalanche-warp-messaging/overview) and [IBC in the Cosmos ecosystem](https://github.com/cosmos/ibc), we picked IBC because of it's straight forward approach, the loosely coupling of connected networks and transparent specification and documentation. There are also a number of other L1s that have adopted IBC recently like [NEAR](https://github.com/octopus-network/near-ibc) and [Solana](https://docs.picasso.network/technology/ibc/solana/), although those projects are like ours still under development.

Besides the addition of a message passing solution, implementing IBC directly enables builders to use the [Cosmos SDK](https://docs.cosmos.network/) to implement their application specific sidechain. This helps to bridge the time until a Ouroboros SDK or similar is available which might be provided by the ongoing effort of the [AMARU](https://github.com/pragma-org/amaru) project or [IOG's partnerchain framework](https://github.com/input-output-hk/partner-chains).

The solution described in this documents outlines how the necessary primitives to implement the IBC protocol on Cardano have been designed. As IBC was originally designed for blockchains that provide fast settlements or fast finality like e.g. BFT based blockchains, tradeoffs have to be made to overcome limitations of Cardano's current implementation with regards to that aspect. We list those choices and also outline future workstreams and technologies that will be introduced in the nearer future that might make certain design choices unnecessary and allow for an even more streamlined implementation of IBC on Cardano in the future.

## 2. Solution Architecture Overview
- Present a high-level overview of the architecture and its components.
List IBC basic overview. Explain Light Clients on both sides, the relayer, list components and frameworks used on a method level (threshold signature bla)

## 3. Business Case
- Outline the business problem or opportunity the project addresses.
Add sources from DefiLlama for the DeFi space. List GDPR etc. requirements, transaction throughput limitations and such and also refer to current available solutions. Do not forget to add EVM.

## 4. Requirements Summary
- Enumerate the business and technical requirements the solution must meet.
1. Implement IBC protocol
2. Feasible in terms of fee structure on the Cosmos and Cardano side
3. Secure, detail out what this means
4. Allow for decentralized and permissionless operation via Relayers
5. No changes to the Core layer required (use the state of the Art Plutus v3 etc.)
6. A mere simple tech stack
7. Good documentation
8. Lightweight setup for bridge/relayer operations

## 5. High-Level Solution Design
- Provide a conceptual or logical view of the proposed solution.
- Include simple diagrams or charts to illustrate the solution concept.
More details then before including smart validators, indexer framework used etc.
How are token mints, burns etc. used

## 6. Detailed Solution Architecture
- Describe the architecture in detail, including information on system modules and components.
- Include detailed architectural diagrams.

## 7. Integration Architecture
- Define how the solution will integrate with existing systems.
- Describe any APIs, services, or data flows.

## 8. Data Architecture
- Detail the data model and database design.
- Explain data migration, storage, and reporting strategies.

## 9. Security Architecture
- Outline security measures, compliance standards, and data protection mechanisms.

## 10. Infrastructure Requirements
- Specify the infrastructure needed, both hardware and software, including network and server architecture.

## 11. Non-Functional Requirements
- Describe the requirements for performance, scalability, reliability, and availability.

## 12. Transition and Implementation Strategy
- Detail the steps for transitioning from the current state to the new solution.
- Include a timeline with key milestones.

## 13. Risks and Mitigations
- Identify potential risks and propose mitigation strategies.

## 14. Appendices
- Include any additional supporting information.

## 15. Glossary
- Define terms and acronyms used in the document.