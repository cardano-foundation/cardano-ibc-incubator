import {
  Constr,
  credentialToAddress,
  Data,
  type LucidEvolution,
  type UTxO,
} from "@lucid-evolution/lucid";
import type { Emulator } from "@lucid-evolution/provider";
import { plutusAddress, Registry } from "../../types/plutus/Migration.ts";
import {
  deploymentHeartbeatSchedule,
  heartbeatScheduleData,
} from "../heartbeat-schedule.ts";
import { readValidator } from "../utils.ts";

/** Seed the authenticated registry for an isolated governed HostState fixture. */
export function governedHostFixture(
  lucid: LucidEvolution,
  emulator: Emulator,
  hostPolicy: string,
  clients: Data,
  connectionHash: string,
  channelHash: string,
  clientPolicy: string,
  connectionPolicy: string,
  channelPolicy: string,
) {
  const registryPolicy = "ee".repeat(28);
  const [, authorityHash] = readValidator(
    "governance_authority.governance_authority.withdraw",
    lucid,
    [registryPolicy],
  );
  const host = readValidator("upgradeable/host_state.host_state.spend", lucid, [
    registryPolicy,
    1n,
    heartbeatScheduleData(deploymentHeartbeatSchedule(lucid)),
    authorityHash,
    hostPolicy,
  ]);
  const clientHash = typeof clients === "string"
    ? clients
    : (clients as Constr<Data>[]).find((r) => r.fields[2] === clientPolicy)!
      .fields[3] as string;
  const address = (hash: string) =>
    credentialToAddress(lucid.config().network!, { type: "Script", hash });
  const registry: Registry = {
    token: {
      policy_id: registryPolicy,
      name: "6962635f696d706c656d656e746174696f6e5f7265676973747279",
    },
    host_policy: hostPolicy,
    identity: {
      client_policy: clientPolicy,
      connection_policy: connectionPolicy,
      channel_policy: channelPolicy,
      escrow_policy: authorityHash,
      reference_holder: plutusAddress(address(authorityHash)),
    },
    governance: {
      signers: ["dd".repeat(28)],
      quorum: 1n,
      delay_ms: 86_400_000n,
    },
    nonce: 0n,
    current: {
      generation: 1n,
      addresses: [
        host[2],
        address(clientHash),
        address(connectionHash),
        address(channelHash),
        address(authorityHash),
      ].map(plutusAddress),
      compatibility: "00".repeat(32),
    },
    phase: "Ready",
    emergency: {
      authority: { signers: ["cc".repeat(28)], quorum: 1n },
      epoch: 0n,
      mask: 0n,
      restoration: null,
    },
    approval_authority: authorityHash,
  };
  const reference: UTxO = {
    txHash: "ee".repeat(32),
    outputIndex: 0,
    address: address(registryPolicy),
    assets: {
      lovelace: 10_000_000n,
      [registry.token.policy_id + registry.token.name]: 1n,
    },
    datum: Data.to(registry, Registry),
  };
  emulator.ledger[reference.txHash + reference.outputIndex] = {
    utxo: reference,
    spent: false,
  };
  const newTx = lucid.newTx.bind(lucid);
  lucid.newTx = () => newTx().readFrom([reference]);
  return host;
}
