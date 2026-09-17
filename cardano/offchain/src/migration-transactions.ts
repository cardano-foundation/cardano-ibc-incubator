import { assertEmergencyAuthority } from "../types/plutus/Migration.ts";
import {
  Constr,
  Data,
  fromHex,
  fromText,
  type LucidEvolution,
  slotToUnixTime,
  toHex,
  type UTxO,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { blake2b } from "@noble/hashes/blake2b";
import {
  HostStateDatum,
  ModuleRegistration,
} from "../types/plutus/HostState.ts";
import {
  bech32Address,
  type Counts,
  Registry,
  RegistryRedeemer,
} from "../types/plutus/Migration.ts";
import { TransferModuleDatum } from "../types/plutus/TransferModuleDatum.ts";
import { generateTokenName } from "./utils.ts";
import { computeIbcTreeWitnessRoot } from "./incremental_ibc_tree.ts";

export const MIGRATION_SPEND = Data.to(new Constr(100, []));
const EMPTY_ROOT = "00".repeat(32);
const HOST_NAME = fromText("ibc_host_state");
const EscrowSchema = Data.Object({
  channel_id: Data.Bytes(),
  denom: Data.Bytes(),
  escrowed_amount: Data.Integer(),
});
type Escrow = Data.Static<typeof EscrowSchema>;
const Escrow = EscrowSchema as unknown as Escrow;

export type MigrationInputs = {
  registry: UTxO;
  registryReference: UTxO;
  object?: UTxO;
  objectReference?: UTxO;
  transferRoot?: UTxO;
  successorReferences?: UTxO[];
  preparationHost?: UTxO;
  validFrom: number;
  validTo: number;
  signers?: string[];
};

export function readRegistry(utxo: UTxO, expectedUnit: string): Registry {
  if (!utxo.datum || utxo.assets[expectedUnit] !== 1n) {
    throw new Error("Missing authenticated registry NFT or inline datum");
  }
  const registry = Data.from(utxo.datum, Registry);
  if (registry.token.policy_id + registry.token.name !== expectedUnit) {
    throw new Error("Registry datum identifies a different deployment");
  }
  return registry;
}

const tokenUnit = (token: { policy_id: string; name: string }) =>
  token.policy_id + token.name;
function requireToken(utxo: UTxO, unit: string): void {
  if (utxo.assets[unit] !== 1n || !utxo.datum) {
    throw new Error(`Missing authenticated object ${unit}`);
  }
}
function counts(host: HostStateDatum): Counts {
  return {
    clients: host.state.next_client_sequence,
    connections: host.state.next_connection_sequence,
    channels: host.state.next_channel_sequence,
  };
}
export function escrowShardName(channel: string, denom: string): string {
  const fields = [fromHex(channel), fromHex(denom)];
  const domain = new TextEncoder().encode(
    "cardano-ibc/transfer-escrow-shard/v1\0",
  );
  const input = new Uint8Array(
    domain.length + 8 + fields[0].length + fields[1].length,
  );
  input.set(domain);
  let offset = domain.length;
  for (const field of fields) {
    new DataView(input.buffer).setUint32(offset, field.length);
    offset += 4;
    input.set(field, offset);
    offset += field.length;
  }
  return toHex(blake2b(input, { dkLen: 28 }));
}
function updateRoot(
  root: string,
  key: string,
  oldValue: string,
  newValue: string,
  siblings: string[],
): string {
  if (computeIbcTreeWitnessRoot(key, oldValue, siblings) !== root) {
    throw new Error(`Unauthenticated migration witness for ${key}`);
  }
  return computeIbcTreeWitnessRoot(key, newValue, siblings);
}

/** Build one bounded step from a canonical registry snapshot. Never submit here. */
export async function buildMigrationTransaction(
  lucid: LucidEvolution,
  unit: string,
  inputs: MigrationInputs,
  action: RegistryRedeemer,
) {
  const old = readRegistry(inputs.registry, unit);
  const next: Registry = structuredClone(old);
  if (
    !Number.isSafeInteger(inputs.validFrom) ||
    !Number.isSafeInteger(inputs.validTo) || inputs.validFrom > inputs.validTo
  ) {
    throw new Error(
      "Migration requires a finite, ordered millisecond validity interval",
    );
  }
  const network = lucid.config().network || "Custom";
  // The ledger carries slots. Bind the output datum to the exact millisecond
  // bounds validators receive, including networks whose slot origin is nonzero.
  inputs = {
    ...inputs,
    validFrom: slotToUnixTime(network, lucid.unixTimeToSlot(inputs.validFrom)),
    validTo: slotToUnixTime(network, lucid.unixTimeToSlot(inputs.validTo)),
  };
  const roleAddress = (implementation: Registry["current"], role: number) =>
    bech32Address(network, implementation.addresses[role]);
  const from = BigInt(inputs.validFrom), to = BigInt(inputs.validTo);
  let destination: string | undefined;
  let objectDatum: string | undefined = inputs.object?.datum ?? undefined;
  let references = [inputs.registryReference];
  const requireObject = (
    role: number,
    token: string,
    implementation = old.current,
  ) => {
    if (!inputs.object || !inputs.objectReference) {
      throw new Error(
        "Migration step requires the authenticated object and its reference script",
      );
    }
    requireToken(inputs.object, token);
    if (inputs.object.address !== roleAddress(implementation, role)) {
      throw new Error(
        "Object is at the wrong implementation or stake credential",
      );
    }
    references.push(inputs.objectReference);
    return inputs.object;
  };
  const ready = () => {
    if (typeof old.phase !== "object" || !("Proposed" in old.phase)) {
      throw new Error("No approved plan");
    }
    if (
      from < old.phase.Proposed.ready_at || to > old.phase.Proposed.expires_at
    ) throw new Error("Approval is delayed or expired");
    return old.phase.Proposed;
  };
  const moving = () => {
    if (typeof old.phase !== "object" || !("Moving" in old.phase)) {
      throw new Error("Deployment is not migrating");
    }
    return old.phase.Moving;
  };
  const authority = () => {
    const signers = new Set(inputs.signers ?? []);
    if (
      BigInt(old.governance.signers.filter((key) => signers.has(key)).length) <
        old.governance.quorum
    ) throw new Error("Explicit governance quorum is required");
  };
  const permitted = (bit: bigint) => old.emergency.mask / bit % 2n === 0n;
  const validMask = (mask: bigint) => mask >= 0n && mask <= 15n;
  const handover = typeof action === "string"
    ? ["Begin", "MoveTransferRoot"].includes(action)
    : "MoveCore" in action || "MoveEscrow" in action || "Activate" in action;
  if (handover && !permitted(8n)) {
    throw new Error(
      "Emergency handover hold is active; delayed governance restoration is required",
    );
  }
  if (typeof action === "object" && "Restrict" in action) {
    const { mask } = action.Restrict;
    if (
      !validMask(mask) ||
      [1n, 2n, 4n, 8n].some((bit) => !permitted(bit) && mask / bit % 2n === 0n)
    ) throw new Error("Emergency authority may only tighten restrictions");
    if (
      BigInt(
        old.emergency.authority.signers.filter((key) =>
          inputs.signers?.includes(key)
        ).length,
      ) < old.emergency.authority.quorum
    ) throw new Error("Explicit emergency quorum is required");
    next.emergency = {
      ...old.emergency,
      mask,
      epoch: old.emergency.epoch + 1n,
      restoration: null,
    };
  } else if (typeof action === "object" && "ProposeRestoration" in action) {
    authority();
    const { mask, authority: emergencyAuthority, expires_at } =
      action.ProposeRestoration;
    if (!validMask(mask)) throw new Error("Unsupported restriction mask");
    assertEmergencyAuthority(emergencyAuthority, old.governance);
    const ready_at = to + old.governance.delay_ms;
    if (expires_at <= ready_at) {
      throw new Error("Restoration expires before its activation delay");
    }
    next.emergency.restoration = {
      registry_nonce: old.nonce,
      generation: old.current.generation,
      epoch: old.emergency.epoch,
      mask,
      authority: emergencyAuthority,
      ready_at,
      expires_at,
    };
  } else if (action === "CancelRestoration") {
    authority();
    next.emergency.restoration = null;
  } else if (action === "Restore") {
    const approval = old.emergency.restoration;
    if (
      !approval || approval.registry_nonce !== old.nonce ||
      approval.generation !== old.current.generation ||
      approval.epoch !== old.emergency.epoch || from < approval.ready_at ||
      to > approval.expires_at
    ) throw new Error("Restoration is absent, stale, delayed or expired");
    assertEmergencyAuthority(approval.authority, old.governance);
    next.emergency = {
      authority: approval.authority,
      epoch: old.emergency.epoch + 1n,
      mask: approval.mask,
      restoration: null,
    };
  } else if (typeof action === "object" && "Propose" in action) {
    if (old.phase !== "Ready") {
      throw new Error("Registry already has a pending transition");
    }
    authority();
    const proposal = action.Propose.proposal;
    if ("Replace" in proposal && inputs.preparationHost) {
      requireToken(inputs.preparationHost, old.host_policy + HOST_NAME);
      if (
        inputs.preparationHost.address !== roleAddress(old.current, 0) ||
        !inputs.transferRoot
      ) {
        throw new Error(
          "Preparation requires the current HostState and transfer registry snapshot",
        );
      }
      const host = Data.from(inputs.preparationHost.datum!, HostStateDatum);
      const registration = host.control.port_registry.get(fromText("transfer"));
      if (!registration) throw new Error("Transfer port is not bound");
      requireToken(inputs.transferRoot, tokenUnit(registration.module_token));
      requireToken(inputs.transferRoot, tokenUnit(registration.port_token));
      if (
        inputs.transferRoot.address !== roleAddress(old.current, 4) ||
        Data.from(inputs.transferRoot.datum!, TransferModuleDatum)
            .escrow_shard_registry_root !== proposal.Replace.escrow_inventory
      ) throw new Error("Prepared escrow inventory is stale");
      const currentCounts = counts(host);
      if (
        Object.keys(currentCounts).some((key) =>
          currentCounts[key as keyof Counts] >
            proposal.Replace.maximum[key as keyof Counts]
        )
      ) throw new Error("Prepared state limits are stale");
      // These are preflight observations, not durable approval inputs. Ordinary
      // continuations may consume them while signatures are collected. Begin
      // authenticates the then-current NFTs, addresses, inventory and limits on
      // chain before any object moves. A changed inventory can prevent Begin;
      // it cannot broaden the approved plan. The registry input still pins the
      // exact authority/nonce and invalidates a concurrent governance transition.
    }
    if ("Rotate" in proposal) {
      assertEmergencyAuthority(
        old.emergency.authority,
        proposal.Rotate.governance,
      );
    }
    const details = "Replace" in proposal ? proposal.Replace : proposal.Rotate;
    if (details.nonce !== old.nonce + 1n) {
      throw new Error("Stale approval nonce");
    }
    if (
      "Replace" in proposal &&
      (proposal.Replace.source_generation !== old.current.generation ||
        proposal.Replace.target.generation !== old.current.generation + 1n ||
        proposal.Replace.target.compatibility !== old.current.compatibility)
    ) {
      throw new Error(
        "Unsupported identity, generation or compatibility change",
      );
    }
    const ready_at = to + old.governance.delay_ms;
    if (action.Propose.expires_at <= ready_at) {
      throw new Error("Approval expires before its activation delay");
    }
    next.nonce++;
    next.phase = {
      Proposed: { proposal, ready_at, expires_at: action.Propose.expires_at },
    };
  } else if (action === "Cancel") {
    if (typeof old.phase !== "object" || !("Proposed" in old.phase)) {
      throw new Error("Cancellation is only safe before Begin");
    }
    if (from <= old.phase.Proposed.expires_at) authority();
    next.phase = "Ready";
  } else if (action === "RotateAuthority") {
    const proposed = ready();
    if (!("Rotate" in proposed.proposal)) {
      throw new Error("Approval is not an authority rotation");
    }
    assertEmergencyAuthority(
      old.emergency.authority,
      proposed.proposal.Rotate.governance,
    );
    next.governance = proposed.proposal.Rotate.governance;
    next.phase = "Ready";
  } else if (action === "Begin") {
    const proposed = ready();
    if (!("Replace" in proposed.proposal)) {
      throw new Error("Approval is not a replacement");
    }
    const approved = proposed.proposal.Replace;
    const object = requireObject(0, old.host_policy + HOST_NAME);
    const host = Data.from(object.datum!, HostStateDatum);
    const registration = host.control.port_registry.get(fromText("transfer"));
    if (!registration || !inputs.transferRoot) {
      throw new Error("Begin requires the authenticated transfer registry");
    }
    requireToken(inputs.transferRoot, tokenUnit(registration.module_token));
    requireToken(inputs.transferRoot, tokenUnit(registration.port_token));
    if (inputs.transferRoot.address !== roleAddress(old.current, 4)) {
      throw new Error("Transfer registry is at the wrong implementation");
    }
    const inventory = Data.from(inputs.transferRoot.datum!, TransferModuleDatum)
      .escrow_shard_registry_root;
    const limits = counts(host);
    if (
      inventory !== approved.escrow_inventory ||
      Object.keys(limits).some((key) =>
        limits[key as keyof Counts] > approved.maximum[key as keyof Counts]
      )
    ) throw new Error("State exceeds the approved migration workload");
    const published = inputs.successorReferences ?? [];
    for (const address of approved.target.addresses) {
      if (
        !("Script" in address.payment_credential) ||
        !published.some((ref) =>
          ref.address ===
            bech32Address(network, old.identity.reference_holder) &&
          ref.scriptRef &&
          validatorToScriptHash(ref.scriptRef) ===
            (address.payment_credential as { Script: [string] }).Script[0]
        )
      ) {
        throw new Error(
          "Publish every exact approved successor script before Begin",
        );
      }
    }
    references.push(inputs.transferRoot, ...published);
    next.phase = {
      Moving: {
        target: approved.target,
        limits,
        next: { clients: 0n, connections: 0n, channels: 0n },
        registration,
        escrow_remaining: inventory,
        module_moved: false,
      },
    };
    host.state.version++;
    host.state.last_update_time = to;
    objectDatum = Data.to(host, HostStateDatum, { canonical: true });
    destination = roleAddress(approved.target, 0);
  } else if (typeof action === "object" && "MoveCore" in action) {
    const phase = moving();
    const role = Number(action.MoveCore.role);
    const entry =
      ([null, ["clients", old.identity.client_policy, "ibc_client"], [
        "connections",
        old.identity.connection_policy,
        "connection",
      ], ["channels", old.identity.channel_policy, "channel"]] as const)[role];
    if (!entry) throw new Error("Unsupported migration role");
    const [key, policy, prefix] = entry;
    if (phase.next[key] >= phase.limits[key]) {
      throw new Error("Role already completely migrated");
    }
    const name = await generateTokenName(
      { policy_id: old.host_policy, name: HOST_NAME },
      fromText(prefix),
      phase.next[key],
    );
    requireObject(role, policy + name);
    next.phase = {
      Moving: {
        ...phase,
        next: { ...phase.next, [key]: phase.next[key] + 1n },
      },
    };
    destination = roleAddress(phase.target, role);
  } else if (action === "MoveTransferRoot") {
    const phase = moving();
    if (phase.module_moved) throw new Error("Transfer root already migrated");
    const object = requireObject(4, tokenUnit(phase.registration.module_token));
    requireToken(object, tokenUnit(phase.registration.port_token));
    next.phase = { Moving: { ...phase, module_moved: true } };
    destination = roleAddress(phase.target, 4);
  } else if (typeof action === "object" && "MoveEscrow" in action) {
    const phase = moving();
    if (!inputs.object?.datum) throw new Error("Missing escrow shard");
    const escrow = Data.from(inputs.object.datum, Escrow);
    const name = escrowShardName(escrow.channel_id, escrow.denom);
    requireObject(4, old.identity.escrow_policy + name);
    next.phase = {
      Moving: {
        ...phase,
        escrow_remaining: updateRoot(
          phase.escrow_remaining,
          `escrowShards/${name}`,
          "01",
          "",
          action.MoveEscrow.siblings,
        ),
      },
    };
    destination = roleAddress(phase.target, 4);
  } else if (typeof action === "object" && "Activate" in action) {
    const phase = moving();
    if (
      !phase.module_moved || phase.escrow_remaining !== EMPTY_ROOT ||
      Object.keys(phase.next).some((key) =>
        phase.next[key as keyof Counts] !== phase.limits[key as keyof Counts]
      )
    ) throw new Error("Authenticated migration inventory is incomplete");
    const object = requireObject(0, old.host_policy + HOST_NAME, phase.target);
    const host = Data.from(object.datum!, HostStateDatum);
    const credential = phase.target.addresses[4].payment_credential;
    if (!("Script" in credential)) {
      throw new Error("Successor transfer role is not a script");
    }
    const registration = {
      ...phase.registration,
      module_script_hash: credential.Script[0],
    };
    host.state.ibc_state_root = updateRoot(
      host.state.ibc_state_root,
      "ports/transfer",
      Data.to(phase.registration, ModuleRegistration),
      Data.to(registration, ModuleRegistration),
      action.Activate.port_siblings,
    );
    host.control.port_registry.set(fromText("transfer"), registration);
    host.state.version++;
    host.state.last_update_time = to;
    objectDatum = Data.to(host, HostStateDatum, { canonical: true });
    next.current = phase.target;
    next.phase = "Ready";
    destination = roleAddress(phase.target, 0);
  } else throw new Error("Unsupported migration action");

  if (!destination && inputs.object) {
    throw new Error("Control actions cannot consume bridge objects");
  }
  references = [
    ...new Map(
      references.map((utxo) => [`${utxo.txHash}#${utxo.outputIndex}`, utxo]),
    ).values(),
  ];
  let tx = lucid.newTx().readFrom(references).collectFrom(
    [inputs.registry],
    Data.to(action, RegistryRedeemer),
  )
    .pay.ToContract(
      inputs.registry.address,
      { kind: "inline", value: Data.to(next, Registry) },
      { ...inputs.registry.assets },
      inputs.registry.scriptRef ?? undefined,
    )
    .validFrom(inputs.validFrom).validTo(inputs.validTo);
  if (destination) {
    tx = tx.collectFrom([inputs.object!], MIGRATION_SPEND)
      .pay.ToContract(destination, { kind: "inline", value: objectDatum! }, {
        ...inputs.object!.assets,
      }, inputs.object!.scriptRef ?? undefined);
  }
  for (const signer of new Set(inputs.signers ?? [])) {
    tx = tx.addSignerKey(signer);
  }
  return { tx, next };
}
