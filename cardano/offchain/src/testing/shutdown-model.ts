import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CML,
  Constr,
  Data,
  fromText,
  Lucid,
  PROTOCOL_PARAMETERS_DEFAULT,
  toText,
  type UTxO,
  walletFromSeed,
} from "@lucid-evolution/lucid";
import { Emulator } from "@lucid-evolution/provider";
import { createDeployment, DeploymentIbcTree } from "../deployment.ts";
import { EMULATOR_ENV } from "../constants.ts";
import {
  HostStateDatum,
  ModuleRegistrationSchema,
} from "../../types/plutus/HostState.ts";

import { HostStateRedeemer } from "../../types/plutus/HostStateRedeemer.ts";
import {
  buildFinalizeShutdownTx,
  buildReclaimRecoveryStakeTx,
  enterShutdown,
  partitionShutdownReferences,
} from "../../scripts/shutdown-deployment.ts";
import { buildReclaimStateTx, scanDeploymentState } from "../shutdown.ts";
import { membershipProof } from "./channel-fixture.ts";
import { generateTokenName, readValidator } from "../utils.ts";
const record = (...fields: Data[]) => new Constr(0, fields);
const encode = (data: Data) => Data.to(data);

/** Structurally valid client state; callers supply trusted consensus roots. */
export function clientStateWithHistory(
  heights: number[],
  now: number,
  root: string,
) {
  const h = record(1n, BigInt(heights.at(-1)!));
  const leaf = record(1n, 0n, 1n, 1n, "00");
  const specs = [
    record(
      leaf,
      record([0n, 1n], 33n, 4n, 12n, "", 1n),
      0n,
      0n,
      record(),
    ),
    record(leaf, record([0n, 1n], 32n, 1n, 1n, "", 1n), 0n, 0n, record()),
  ];
  const client = record(
    fromText("testchain-1"),
    record(1n, 3n),
    1_209_600_000_000_000n,
    1_814_400_000_000_000n,
    10_000_000_000n,
    record(0n, 0n),
    h,
    specs,
  );
  const consensus = record(
    BigInt(now) * 1_000_000n,
    "00".repeat(32),
    record(root),
  );
  const processed = BigInt(now + 60_000) * 1_000_000n;
  const entries = heights.map((height) =>
    [
      record(1n, BigInt(height)),
      record(
        BigInt(now - (heights.at(-1)! - height) * 1000) * 1_000_000n,
        "00".repeat(32),
        record(root),
      ),
    ] as const
  );
  return {
    client,
    consensus,
    state: record(
      client,
      new Map(entries),
      new Map(entries.map(([h]) => [h, processed])),
      new Map(entries.map(([h]) => [h, processed / 4_000_000_000n])),
    ),
  };
}

/** A real deployment funded only at genesis; every subsequent output is submitted. */
export async function deploymentScenario() {
  const seedPhrase = "abandon ".repeat(11) + "about";
  const address = walletFromSeed(seedPhrase, { network: "Custom" }).address;
  const initialLovelace = 10_000_000_000n;
  const emulator = new Emulator([
    {
      seedPhrase,
      privateKey: "",
      address,
      assets: { lovelace: initialLovelace },
    },
  ], { ...PROTOCOL_PARAMETERS_DEFAULT, maxTxSize: 16384 });
  emulator.time = 1_700_000_000_000;
  const lucid = await Lucid(emulator, "Custom");
  lucid.selectWallet.fromSeed(seedPhrase);
  let fees = 0n;
  const submitTx = emulator.submitTx.bind(emulator);
  emulator.submitTx = async (cbor) => {
    const tx = CML.Transaction.from_cbor_hex(cbor);
    assert(cbor.length / 2 <= 16384, "Signed transaction exceeds ledger size");
    const redeemers = tx.witness_set().redeemers();
    if (redeemers) {
      const units = CML.compute_total_ex_units(redeemers);
      const limits = lucid.config().protocolParameters!;
      assert(
        units.mem() <= limits.maxTxExMem,
        "Transaction exceeds memory limit",
      );
      assert(
        units.steps() <= limits.maxTxExSteps,
        "Transaction exceeds CPU limit",
      );
    }
    const selectable = new Set(
      (await lucid.wallet().getUtxos()).map((u) => u.txHash + u.outputIndex),
    );
    const hash = await submitTx(cbor);
    fees += tx.body().fee();
    emulator.awaitBlock();
    // Preserve deployment nonce reservations while refreshing confirmed change.
    lucid.overrideUTxOs(
      (await emulator.getUtxos(address)).filter((u) =>
        selectable.has(u.txHash + u.outputIndex) || u.txHash === hash
      ),
    );
    return hash;
  };
  // The emulator provider echoes budgets. Force actual UPLC evaluation, including
  // production builders that normally delegate evaluation to Ogmios.
  const newTx = lucid.newTx.bind(lucid);
  lucid.newTx = () => {
    const tx = newTx();
    const complete = tx.complete.bind(tx);
    const chain = tx.chain.bind(tx);
    tx.complete = (options) => complete({ ...options, localUPLCEval: true });
    tx.chain = (options) => chain({ ...options, localUPLCEval: true });
    return tx;
  };
  const realNow = Date.now;
  Date.now = () => emulator.now();
  try {
    const deployment = await createDeployment(lucid, EMULATOR_ENV);
    lucid.overrideUTxOs(await emulator.getUtxos(address));
    const tree = new DeploymentIbcTree();
    const hostUnit = deployment.hostStateNFT!.policyId +
      deployment.hostStateNFT!.name;
    const host = () => lucid.utxoByUnit(hostUnit);
    const hostDatum = () =>
      host().then((u) => Data.from(u.datum!, HostStateDatum));
    for (
      const [port, registration] of (await hostDatum()).control.port_registry
    ) {
      tree.set(
        `ports/${toText(port)}`,
        Data.to(registration as never, ModuleRegistrationSchema as never),
      );
    }
    assertEquals(
      await tree.getRoot(),
      (await hostDatum()).state.ibc_state_root,
      "rebuild deployment root",
    );
    const hostTx = (
      input: UTxO,
      datum: HostStateDatum,
      redeemer: HostStateRedeemer,
      topUp = 0n,
    ) =>
      lucid.newTx()
        .readFrom([deployment.validators.hostStateStt.refUtxo])
        .collectFrom([input], Data.to(redeemer, HostStateRedeemer))
        .pay.ToContract(input.address, {
          kind: "inline",
          value: Data.to(datum, HostStateDatum, { canonical: true }),
        }, { ...input.assets, lovelace: input.assets.lovelace + topUp })
        .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
    const token = async (prefix: string, sequence: bigint, policy: string) => ({
      policy_id: policy,
      name: await generateTokenName(
        {
          policy_id: deployment.hostStateNFT!.policyId,
          name: deployment.hostStateNFT!.name,
        },
        fromText(prefix),
        sequence,
      ),
    });
    const successor = async (datum: HostStateDatum) => ({
      ...datum,
      state: {
        ...datum.state,
        version: datum.state.version + 1n,
        last_update_time: BigInt(emulator.now()),
        ibc_state_root: await tree.getRoot(),
      },
    });
    const api = {
      host,
      hostDatum,
      async createClient(height: number, root = "11".repeat(32)) {
        const input = await host();
        const old = await hostDatum();
        const sequence = old.state.next_client_sequence;
        const nft = await token(
          "ibc_client",
          sequence,
          deployment.validators.mintClientStt.scriptHash,
        );
        const { client, consensus, state } = clientStateWithHistory(
          [height],
          emulator.now(),
          root,
        );
        const datum = record(
          state,
          record(nft.policy_id, nft.name),
          "00".repeat(32),
        );
        const clientKey = `clients/07-tendermint-${sequence}/clientState`;
        const consensusKey =
          `clients/07-tendermint-${sequence}/consensusStates/${height}`;
        const client_state_siblings = await tree.getSiblings(clientKey);
        tree.set(clientKey, encode(client));
        const consensus_state_siblings = await tree.getSiblings(consensusKey);
        tree.set(consensusKey, encode(consensus));
        const next = await successor(old);
        next.state.next_client_sequence++;
        await api.submit(
          hostTx(input, next, {
            CreateClient: { client_state_siblings, consensus_state_siblings },
          })
            .attach.MintingPolicy({
              type: "PlutusV3",
              script: deployment.validators.mintClientStt.script,
            })
            .mintAssets({ [nft.policy_id + nft.name]: 1n }, Data.void())
            .pay.ToContract(deployment.validators.spendClient.address, {
              kind: "inline",
              value: encode(datum),
            }, { [nft.policy_id + nft.name]: 1n }),
          "create client",
        );
        return sequence;
      },
      async createConnection(clientSequence: bigint) {
        const input = await host();
        const old = await hostDatum();
        const sequence = old.state.next_connection_sequence;
        const nft = await token(
          "connection",
          sequence,
          deployment.validators.mintConnectionStt.scriptHash,
        );
        const clientNft = await token(
          "ibc_client",
          clientSequence,
          deployment.validators.mintClientStt.scriptHash,
        );
        const client = await lucid.utxoByUnit(
          clientNft.policy_id + clientNft.name,
        );
        const state = record(
          fromText(`07-tendermint-${clientSequence}`),
          [record(fromText("1"), [
            fromText("ORDER_ORDERED"),
            fromText("ORDER_UNORDERED"),
          ])],
          new Constr(1, []),
          record(fromText("07-tendermint-1"), "", record(fromText("ibc"))),
          0n,
        );
        const key = `connections/connection-${sequence}`;
        const connection_siblings = await tree.getSiblings(key);
        tree.set(key, encode(state));
        const next = await successor(old);
        next.state.next_connection_sequence++;
        await api.submit(
          hostTx(input, next, { CreateConnection: { connection_siblings } })
            .readFrom([
              client,
              deployment.validators.mintConnectionStt.refUtxo,
            ])
            .mintAssets({ [nft.policy_id + nft.name]: 1n }, Data.void())
            .pay.ToContract(deployment.validators.spendConnection.address, {
              kind: "inline",
              value: encode(record(state, record(nft.policy_id, nft.name))),
            }, { [nft.policy_id + nft.name]: 1n }),
          "create connection",
        );
      },
      async createChannel(height: number, ordered: boolean) {
        // Bootstrap a real client with a valid proof of the counterparty's TryOpen
        // connection, then complete the local connection handshake on the ledger.
        const before = await hostDatum();
        const clientId = `07-tendermint-${before.state.next_client_sequence}`;
        const connectionId =
          `connection-${before.state.next_connection_sequence}`;
        const varint = (value: number): string =>
          value < 128
            ? value.toString(16).padStart(2, "0")
            : ((value & 127) | 128).toString(16) +
              varint(Math.floor(value / 128));
        const field = (tag: number, hex: string) =>
          varint(tag * 8 + 2) + varint(hex.length / 2) + hex;
        const text = (tag: number, value: string) =>
          field(tag, fromText(value));
        const remote = text(1, "07-tendermint-1") +
          field(
            2,
            text(1, "1") + text(2, "ORDER_ORDERED") +
              text(2, "ORDER_UNORDERED"),
          ) + "1802" +
          field(
            4,
            text(1, clientId) + text(2, connectionId) +
              field(3, text(1, "ibc")),
          );
        const membership = await membershipProof(
          fromText("connections/connection-0"),
          remote,
        );
        const clientSequence = await api.createClient(height, membership.root);
        await api.createConnection(clientSequence);
        emulator.awaitSlot(61);
        const clientNft = await token(
          "ibc_client",
          clientSequence,
          deployment.validators.mintClientStt.scriptHash,
        );
        const client = await lucid.utxoByUnit(
          clientNft.policy_id + clientNft.name,
        );
        const clientFields = (Data.from(client.datum!) as Constr<Data>)
          .fields[0] as Constr<Data>;
        const h = record(1n, BigInt(height));
        const consensus =
          [...(clientFields.fields[1] as Map<Data, Data>).values()][0];
        const processed =
          [...(clientFields.fields[2] as Map<Data, Data>).values()][0];
        const processedHeight =
          [...(clientFields.fields[3] as Map<Data, Data>).values()][0];
        const connectionNft = await token(
          "connection",
          before.state.next_connection_sequence,
          deployment.validators.mintConnectionStt.scriptHash,
        );
        const connectionUnit = connectionNft.policy_id + connectionNft.name;
        const connection = await lucid.utxoByUnit(connectionUnit);
        const connectionDatum = Data.from(connection.datum!) as Constr<Data>;
        const state = connectionDatum.fields[0] as Constr<Data>;
        state.fields[2] = new Constr(3, []);
        (state.fields[3] as Constr<Data>).fields[1] = fromText("connection-0");
        const connection_siblings = await tree.getSiblings(
          `connections/${connectionId}`,
        );
        tree.set(`connections/${connectionId}`, encode(state));
        const verify = deployment.validators.verifyProof;
        await api.submit(
          hostTx(await host(), await successor(await hostDatum()), {
            UpdateConnection: { connection_siblings },
          })
            .readFrom([
              client,
              deployment.validators.spendConnection.refUtxo,
              verify.refUtxo,
            ])
            .collectFrom([connection], Data.void())
            .mintAssets(
              { [verify.scriptHash]: 1n },
              encode(
                record(
                  record(
                    clientFields.fields[0],
                    consensus,
                    h,
                    processed,
                    processedHeight,
                    0n,
                    0n,
                    membership.proof,
                    record([
                      fromText("ibc"),
                      fromText("connections/connection-0"),
                    ]),
                    remote,
                  ),
                  new Constr(1, []),
                ),
              ),
            )
            .pay.ToContract(connection.address, {
              kind: "inline",
              value: encode(connectionDatum),
            }, connection.assets),
          "open connection",
        );
        const old = await hostDatum();
        const channelId = `channel-${old.state.next_channel_sequence}`;
        const channelNft = await token(
          "channel",
          old.state.next_channel_sequence,
          deployment.validators.mintChannelStt.scriptHash,
        );
        const end = record(
          new Constr(1, []),
          new Constr(ordered ? 2 : 1, []),
          record(fromText("remote"), ""),
          [fromText(connectionId)],
          fromText("ics20-1"),
        );
        const key = `channelEnds/ports/mock/channels/${channelId}`;
        const channel_siblings = await tree.getSiblings(key);
        tree.set(key, encode(end));
        const witnesses = [];
        for (
          const prefix of [
            "nextSequenceSend",
            "nextSequenceRecv",
            "nextSequenceAck",
          ]
        ) {
          const key = `${prefix}/ports/mock/channels/${channelId}`;
          witnesses.push(await tree.getSiblings(key));
          tree.set(key, encode(1n));
        }
        const next = await successor(old);
        next.state.next_channel_sequence++;
        const module = await lucid.utxoByUnit(
          deployment.modules.mock.identifier,
        );
        const datum = record(
          record(
            end,
            1n,
            1n,
            1n,
            new Map(),
            new Map(),
            new Map(),
            record(0n, 0n),
            record(0n, 0n),
          ),
          fromText("mock"),
          record(channelNft.policy_id, channelNft.name),
        );
        await api.submit(
          hostTx(await host(), next, {
            CreateChannel: {
              channel_siblings,
              next_sequence_send_siblings: witnesses[0],
              next_sequence_recv_siblings: witnesses[1],
              next_sequence_ack_siblings: witnesses[2],
            },
          })
            .readFrom([
              client,
              await lucid.utxoByUnit(connectionUnit),
              deployment.validators.spendMockModule!.refUtxo,
              deployment.validators.mintChannelStt.refUtxo,
            ])
            .collectFrom([module], encode(record(record(fromText(channelId)))))
            .mintAssets(
              { [channelNft.policy_id + channelNft.name]: 1n },
              Data.void(),
            )
            .pay.ToAddress(module.address, module.assets)
            .pay.ToContract(deployment.validators.spendChannel.address, {
              kind: "inline",
              value: encode(datum),
            }, { [channelNft.policy_id + channelNft.name]: 1n }),
          "create channel",
        );
      },
      async topUp(lovelace: bigint) {
        const input = await host();
        await api.submit(
          hostTx(
            input,
            await successor(await hostDatum()),
            "Heartbeat",
            lovelace,
          ).addSignerKey((await hostDatum()).deployer),
          "top up HostState",
        );
      },
      async rejectPrematureCleanup(secondsBeforeEnd?: number) {
        const datum = await hostDatum();
        if (secondsBeforeEnd !== undefined) {
          assert(datum.control.shutdown !== "Active");
          const target =
            Number(datum.control.shutdown.ShuttingDown.grace_period_end) -
            secondsBeforeEnd * 1000;
          emulator.awaitSlot(
            Math.max(0, Math.floor((target - emulator.now()) / 1000)),
          );
        }
        const reference = deployment.validators.hostStateStt.refUtxo;
        const [script] = readValidator(
          "reference_validator.refer_only.else",
          lucid,
          [deployment.hostStateNFT!.policyId],
        );
        const tx = lucid.newTx().readFrom([await host()]).attach
          .SpendingValidator(script)
          .collectFrom([reference], Data.void()).addSignerKey(datum.deployer)
          .validFrom(emulator.now()).validTo(emulator.now() + 60_000);
        await assertRejects(
          () => tx.complete({ localUPLCEval: true }),
          Error,
          "failed script execution",
        );
      },
      inventory() {
        const validators = deployment.validators;
        const addresses = {
          client: validators.spendClient.address,
          connection: validators.spendConnection.address,
          channel: validators.spendChannel.address,
          transfer: validators.spendTransferModule.address,
          module: validators.spendMockModule!.address,
          trace: validators.spendTraceRegistry!.address,
        };
        return Object.fromEntries(
          Object.entries(addresses).map((
            [kind, address],
          ) => [
            kind,
            Object.values(emulator.ledger).filter(({ spent, utxo }) =>
              !spent && utxo.address === address
            ).length,
          ]),
        );
      },
      async enter(days: number) {
        await enterShutdown(lucid, deployment, {
          gracePeriodMs: days * 86_400_000,
        });
      },
      async waitForGrace() {
        const datum = await hostDatum();
        assert(datum.control.shutdown !== "Active");
        emulator.awaitSlot(
          Math.max(
            0,
            Math.ceil(
              (Number(datum.control.shutdown.ShuttingDown.grace_period_end) -
                emulator.now()) / 1000,
            ) + 1,
          ),
        );
      },
      async cleanup(index: number) {
        let groups = (await scanDeploymentState(lucid, deployment)).filter((
          g,
        ) => g.utxos.length);
        if (!groups.length) return false;
        const dependenciesRemain = groups.some((group) =>
          group.kind === "channel" || group.kind === "client" ||
          group.kind === "connection" || group.kind === "trace" ||
          group.kind === "metadata"
        );
        if (dependenciesRemain) {
          groups = groups.filter((group) => group.kind !== "transfer");
        }
        const group = groups[index % groups.length];
        const transferRoot = group.kind === "channel" ||
            group.kind === "client" || group.kind === "connection" ||
            group.kind === "trace" || group.kind === "metadata"
          ? await lucid.utxoByUnit(deployment.modules.transfer.identifier)
          : undefined;
        await api.submit(
          buildReclaimStateTx(
            lucid,
            deployment,
            await host(),
            { ...group, utxos: [group.utxos[0]] },
            address,
            emulator.now(),
            transferRoot,
          ),
          `reclaim ${group.kind}`,
        );
        return group.kind;
      },
      async finish(userRefundAddress = address) {
        while (
          await api.cleanup(0)
        ) { /* Re-query after each submitted transaction. */ }
        const datum = await hostDatum();
        const body = await api.submit(
          buildReclaimRecoveryStakeTx(
            lucid,
            deployment,
            await host(),
            datum.deployer,
            emulator.now(),
          ),
          "recovery deposit",
        );
        assertEquals(
          body.certs()!.get(0).as_unreg_cert()!.deposit(),
          lucid.config().protocolParameters!.keyDeposit,
        );
        const allRefs = Object.values(emulator.ledger).filter(({ spent }) =>
          !spent
        ).map(({ utxo }) => utxo)
          .filter((u) => u.scriptRef);
        const { terminalReference, reclaimableReferences } =
          partitionShutdownReferences(deployment, allRefs);
        const [referenceValidator] = readValidator(
          "reference_validator.refer_only.else",
          lucid,
          [deployment.hostStateNFT!.policyId],
        );
        for (const ref of reclaimableReferences) {
          await api.submit(
            lucid.newTx().readFrom([await host()])
              .attach.SpendingValidator(referenceValidator).collectFrom(
                [ref],
                Data.void(),
              ).addSignerKey(datum.deployer)
              .validFrom(emulator.now()).validTo(emulator.now() + 60_000),
            "reference",
          );
        }
        await api.submit(
          buildFinalizeShutdownTx(
            lucid,
            deployment,
            await host(),
            terminalReference,
            address,
            datum.deployer,
            emulator.now(),
          ),
          "final burn",
        );
        api.assertAllAdaReturned(userRefundAddress);
      },
      lucid,
      emulator,
      deployment,
      address,
      async submit(tx: ReturnType<typeof lucid.newTx>, label = "transaction") {
        try {
          const signed = await (await tx.complete()).sign.withWallet()
            .complete();
          await signed.submit();
          return signed.toTransaction().body();
        } catch (cause) {
          throw new Error(`${label} failed`, { cause });
        }
      },
      assertAllAdaReturned(payout: string) {
        const walletAddresses = new Set([address, payout]);
        // Inspect the entire ledger independently of the shutdown scanner.
        const remaining = Object.values(emulator.ledger).filter(({ spent }) =>
          !spent
        ).map(({ utxo }) => utxo);
        assertEquals(
          remaining.filter((utxo) => !walletAddresses.has(utxo.address)),
          [],
        );
        assertEquals(
          remaining.reduce((sum, utxo) => sum + utxo.assets.lovelace, 0n),
          initialLovelace - fees,
          "Genesis ADA equals returned ADA plus all deployment and shutdown fees",
        );
      },
      dispose() {
        Date.now = realNow;
      },
    };
    return api;
  } catch (error) {
    Date.now = realNow;
    throw error;
  }
}
