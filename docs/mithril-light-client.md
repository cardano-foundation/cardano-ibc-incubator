---
ics: 7
title: Cardano Ouroboros Light Client Based on Mithril
stage: draft
category: IBC/TAO
kind: instantiation
version compatibility: ibc-go v7.0.0
author: Chinh Nguyen Duc <chinhnd@smartosc.com>, Dat Le Trong <datlt@smartosc.com>
created: 2024-04-24
---

> **Caution (Julius Tranquilli, January 2026):** This document was created near the inception of the incubator as an initial prototype. I believe there to be issues with this interpretation of how Mithril works, notably the implementation uses `block_number` for height rather than `immutable_file_number` as described here. As I understand Mithril in January 2026, multiple Mithril certificates can exist on the same immutable file number, which would violate IBC's uniqueness requirement for heights. This document is preserved for other maintainers to review, but should not be treated as an accurate representation of how Mithril works or how this codebase implements it.

## Synopsis

This specification document describes a Ouroboros light client based on Mithril


### Motivation

Designing the Cardano Ouroboros IBC light client by leveraging the existing Mithril protocol implementation. The objective is to integrate Mithril's efficient state and consensus verification methods while ensuring compatibility and optimizing performance.


### Definitions

Functions & terms are as defined in ICS 2.


### Desired properties

This specification must satisfy the client interface defined in ICS 2.


## Technical specification

This specification depends on correct instantiation of the Ouroboros consensus algorithm and its light client algorithm.


### Client state

```typescript
interface ClientState {

  chainID: string

  latestHeight: MithrilHeight // immutable file number

  frozenHeight: MithrilHeight // immutable file number

  validAfter: uint64

  genesisTime: uint64

  genesisVerificationKey: ed25519PublicKey

  currentEpoch: uint64

  epochLength: uint64

  slotPerKesPeriod: uint64

  currentMithrilStakeDistribution: MithrilStakeDistribution

  trustingPeriod: uint64

  upgradePath: []string

  tokenConfigs: TokenConfigs

}

interface MithrilStakeDistribution {

  epoch: uint64

  signersWithStake: []SignerWithStake

  hash: string

  certificateHash: string

  createdAt: uint64

  protocolParameters: MithrilProtocolParameters

}
```


### Consensus state

A ConsensusState is the snapshot of the counterparty chain, that our IBC Ouroboros client uses to verify proofs

```typescript

interface ConsensusState {

  timestamp: uint64

  mithrilStakeDistributionCertificate: MithrilCertificate

  transactionSnapshotCertificate: MithrilCertificate

}
```


### Height

The height of a Ouroboros client based on Mithril is the immutable file number of a Cardano transaction snapshot

```typescript

type MithrilHeight = uint64
```

### Header

A Mithril header includes a mithril stake distribution (and its corresponding Mithril Certificate), a cardano transaction snapshot which has the same epoch with the mithril stake distribution (and its corresponding Mithril Certificate).

```typescript
interface MithrilHeader {

  mithrilStakeDistribution: MithrilStakeDistribution

  mithrilStakeDistributionCertificate: MithrilCertificate

  transactionSnapshot: CardanoTransactionSnapshot

  transactionSnapshotCertificate: MithrilCertificate

}

interface CardanoTransactionSnapshot {

  snapshotHash: string,

  merkleRoot: string,

  certificateHash: string,

  epoch: uint64,

  height: MithrilHeight, // immutable file number

}

interface CardanoTransaction {

  transactionHash: string,

  transactionProof: string,

  blockNo: uint64,

  slotNo: uint64,

  blockHash: string,
}
```

### Certificate

The Mithril certificate is a component that certifies the Mithril stake distribution used to create the multi-signature, and certifies the validation of a cardano transaction snapshot.

```typescript
interface MithrilCertificate {

  hash: string

  previousHash: string

  epoch: uint64

  signedEntityType: SignedEntityType

  metadata: CertificateMetadata

  protocolMessage: ProtocolMessage

  signedMessage: string

  aggregateVerificationKey: string

  signature: CertificateSignature

}

interface CertificateMetadata {

  protocolVersion: string  

  protocolParameters: ProtocolParameters

  initiatedAt: time

  sealedAt: time

  signers: []SignerWithStake

}

enum SignedEntityType {

  MithrilStakeDistribution

  CardanoTransactions

}

enum CertificateSignature {

  GenesisSignature

  MultiSignature

}
```

### Misbehaviour

The Misbehaviour type is used for detecting misbehaviour and freezing the client - to prevent further packet flow - if applicable. Ouroboros client Misbehaviour consists of two Mithril headers at the same height both of which the light client would have considered valid.

```typescript
interface Misbehaviour {

  identifier: string

  h1: MithrilHeader

  h2: MithrilHeader

}
```

Misbehaviour implements ClientMessage interface.


### Client initialisation

Ouroboros client based on Mithril initialisation requires a (subjectively chosen) latest consensus state and corresponding client state with the latest Mithril stake distribution. 

```typescript
function initialise(

  identifier: Identifier, 

  clientState: ClientState, 

  consensusState: ConsensusState

) {

  provableStore.set("clients/{identifier}/clientState", clientState)

  provableStore.set("clients/{identifier}/consensusStates/{height}", consensusState)

  provableStore.set(“clientMSD/{epochNo}”, clientState.currentMithrilStakeDistribution)

}

The Ouroboros client latestClientHeight function returns the latest stored height, which is updated every time a new (more recent) header is validated.

function latestClientHeight(clientState: ClientState): Height {

  return clientState.latestHeight

}
```

### Validity predicate

Ouroboros client based on Mithril validity checking uses the bisection algorithm. If the provided header is valid, the client state is updated & the newly verified commitment written to the store.

```typescript
function verifyClientMessage(clientMsg: ClientMessage) {

  switch typeof(clientMsg) {

    case MithrilHeader:

      verifyMithrilHeader(clientMsg)

    case Misbehaviour:

      verifyMithrilHeader(clientMsg.h1)

      verifyMithrilHeader(clientMsg.h2)

  }

}
```

Verify validity of regular update to the Ouroboros client

```typescript
function verifyMithrilHeader(header: MithrilHeader) {

  clientState = provableStore.get("clients/{header.identifier}/clientState")

  // assert trusting period has not yet passed

  assert(currentTimestamp() - clientState.latestTimestamp &lt; clientState.trustingPeriod)

  // assert header timestamp is less than trust period in the future. This should be resolved with an intermediate header.

  assert(header.timestamp - clientState.latestTimestamp &lt; clientState.trustingPeriod)

  // fetch the consensus state at the lastest height

  consensusState = provableStore.get("clients/{header.identifier}/consensusStates/{header.latestHeight}")

  // assert that the consensus state Mithril Stake Distribution Certificate is the previous of the header Mithril Stake Distribution Certificate

  assert(header.mithrilStakeDistributionCertificate.previousHash == consensusState.mithrilStakeDistributionCertificate.hash)

  // assert that the consensus state Transaction Snapshot Certificate is the previous of the header Transaction Snapshot Certificate  

  assert(header.transactionSnapshotCertificate.previousHash == consensusState.transactionSnapshotCertificate.hash)

// verify that the Mithril Stake Distribution certificate, Transaction Snapshot certificate of the provided header is valid

  assert(verifyCertificate(header.mithrilStakeDistributionCertificate, consensusState.mithrilStakeDistributionCertificate))

  assert(verifyCertificate(header.transactionSnapshotCertificate, consensusState.transactionSnapshotCertificate))

}

function verifyCertificate(currentCertificate, previousCertificate: MithrilCertificate): boolean {

  switch typeof(currentCertificate.signature) {

    case MultiSignature:

      verifyStandardCertificate(currentCertificate, previousCertificate)

    case GenesisSignature:

      verifyGenesisCertificate(currentCertificate)

  }

}

function verifyStandardCertificate(currentCertificate, previousCertificate: MithrilCertificate) {

  assert(verifyMultiSignature(certificate.signedMessage, certificate.signature, certificate.aggregateVerificationKey, certificate.metadata.protocolParameters)

 assert(previousCertificate.protocolMessage.getMessagePart() == currentCertificate.aggregateVerificationKey && previousCertificate.epoch &lt; currentCertificate.epoch)

}

function verifyGenesisCertificate(genesisCertificate: MithrilCertificate) {

  // fetch the client state

  clientState = provableStore.get("clients/{clientMsg.identifier}/clientState”)

  assert(verifyGenesisSignature(clientState.genesisVerificationKey, genesisCertificate.signedMessage, genesisCertificate.signature))

}
```

### Misbehavior predicate

Function checkForMisbehaviour will check if an update contains evidence of Misbehaviour. 

If the ClientMessage is a Mithril header we check for implicit evidence of misbehaviour by checking if there already exists a conflicting consensus state in the store or if the header breaks time monotonicity.

```typescript
function checkForMisbehaviour(clientMsg: clientMessage): boolean {

  clientState = provableStore.get("clients/{clientMsg.identifier}/clientState")

  switch typeof(clientMsg) {

    case MithrilHeader:

      // fetch consensus state at header height if it exists

      consensusState = provableStore.get("clients/{clientMsg.identifier}/consensusStates/{header.GetHeight()}")

      // if consensus state exists and conflicts with the Mithril header

      // then the Mithril header is evidence of misbehavior

      if consensusState != nil && 

          !(

          consensusState.timestamp == header.GetTimestamp() &&

          consensusState.mithrilStakeDistributionCertificate == header.mithrilStakeDistributionCertificate &&

          consensusState.transactionSnapshotCertificate == header.transactionSnapshotCertificate

          ) {

        return true

      }

      // check for time monotonicity misbehaviour

      // if Mithril header is not monotonically increasing with respect to neighboring consensus states

      // then return true

      // NOTE: implementation must have ability to iterate ascending/descending by height

      prevConsState = getPreviousConsensusState(header.GetHeight())

      nextConsState = getNextConsensusState(header.GetHeight())

      if prevConsState.timestamp >= header.GetTimestamp() {

        return true

      }

      if nextConsState != nil && nextConsState.timestamp &lt;= header.GetTimestamp() {

        return true

      }

    case Misbehaviour:

      if (misbehaviour.h1.GetHeight() &lt; misbehaviour.h2.GetHeight()) {

        return false

      }

      // if heights are equal check that this is valid misbehaviour of a fork

      if (misbehaviour.h1.GetHeight() === misbehaviour.h2.GetHeight() && misbehaviour.h1.transactionSnapshotCertificate !== misbehaviour.h2.transactionSnapshotCertificate) {

        return true

      }

      // otherwise if heights are unequal check that this is valid misbehavior of time violation

      if (misbehaviour.h1.GetTimestamp() &lt;= misbehaviour.h2.GetTimestamp()) {

        return true

      }

      return false

  }

}
```

### Update state

Function updateState will perform a regular update for the Ouroboros client. It will add a consensus state to the client store.

```typescript
function updateState(clientMsg: clientMessage) {

  clientState = provableStore.get("clients/{clientMsg.identifier}/clientState")

  header = MithrilHeader(clientMessage)

  // only update the clientstate if the header height is higher

  // than clientState latest height or the client state current epoch is less than the MithrilHeader       

  // epoch

  if clientState.height &lt; header.GetHeight() {

    // update latest height

    clientState.latestHeight = header.GetHeight()

  }

  if clientState.currentEpoch &lt; header.mithrilStakeDistribution.epoch {

    // update current epoch

    clientState.currentEpoch = header.mithrilStakeDistribution.epoch

  }

  // save the client

  provableStore.set("clients/{clientMsg.identifier}/clientState", clientState)

  // create recorded consensus state, save it

  consensusState = ConsensusState{header.GetTimestamp(), header.mithrilStakeDistributionCertificate, header.transactionSnapshotCertificate}

  provableStore.set("clients/{clientMsg.identifier}/consensusStates/{header.GetHeight()}", consensusState)

  // these may be stored as private metadata within the client in order to verify

  // that the delay period has passed in proof verification

  provableStore.set("clients/{clientMsg.identifier}/processedTimes/{header.GetHeight()}", currentTimestamp())

  provableStore.set("clients/{clientMsg.identifier}/processedHeights/{header.GetHeight()}", currentHeight())

}
```

### Update state on misbehaviour

Function updateStateOnMisbehaviour will set the frozen height to a non-zero sentinel height to freeze the entire client.

```typescript
function updateStateOnMisbehaviour(clientMsg: clientMessage) {

  clientState = provableStore.get("clients/{clientMsg.identifier}/clientState")

  // Frozen height is same for all misbehaviour

  clientState.frozenHeight = 1

  provableStore.set("clients/{clientMsg.identifier}/clientState", clientState)

}
```

### Upgrades

To be defined


### State verification functions

Ouroboros light client based on Mithril state verification functions check a proof against a previously validated commitment root.

Since Cardano doesn't exposed and have built-in proofs like Cosmos, we will do proof using path point to correct KVStore path key belong to each Client Store (provableStore).

```typescript
function verifyMembership(

  clientState: ClientState,

  height: MithrilHeight,

  delayTimePeriod: uint64,

  delayBlockPeriod: uint64,

  proof: CommitmentProof,

  path: CommitmentPath,

  value: []byte

): Error {

  // check that the client is at a sufficient height

  assert(clientState.latestHeight >= height)

  // check that the client is unfrozen or frozen at a higher height

  assert(clientState.frozenHeight === null || clientState.frozenHeight > height)

  // assert that enough time has elapsed

  assert(currentTimestamp() >= processedTime + delayPeriodTime)

  // assert that enough blocks have elapsed

  assert(currentHeight() >= processedHeight + delayPeriodBlocks)

  // fetch the previously verified commitment root & verify membership

  consensusState = provableStore.get("clients/{clientIdentifier}/consensusStates/{height}")

  // verify that &lt;path, value> has been stored

  if !verifyProof(proof, path, value) {

    return error

  }

  return nil

}

function verifyNonMembership(

  clientState: ClientState,

  height: MithrilHeight,

  delayTimePeriod: uint64,

  delayBlockPeriod: uint64,

  proof: CommitmentProof,

  path: CommitmentPath

): Error {

  // check that the client is at a sufficient height

  assert(clientState.latestHeight >= height)

  // check that the client is unfrozen or frozen at a higher height

  assert(clientState.frozenHeight === null || clientState.frozenHeight > height)

  // assert that enough time has elapsed

  assert(currentTimestamp() >= processedTime + delayPeriodTime)

  // assert that enough blocks have elapsed

  assert(currentHeight() >= processedHeight + delayPeriodBlocks)

  // fetch the previously verified commitment root & verify membership

  consensusState = provableStore.get("clients/{clientIdentifier}/consensusStates/{height}")

  // verify that nothing has been stored at path

  if !verifyNonMembershipProof(proof, path) {

    return error

  }

  return nil

}
```

### Properties & Invariants

Correctness guarantees as provided by the Ouroboros light client based on Mithril algorithm.


## Backwards Compatibility

Not applicable.


## Forwards Compatibility

Not applicable. Alterations to the client verification algorithm will require a new client standard.


## Example Implementations

None yet.


## History

April 24th, 2024 - Initial version


## Copyright

All content herein is licensed under Apache 2.0


