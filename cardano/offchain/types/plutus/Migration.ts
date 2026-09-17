import {
  credentialToAddress,
  Data,
  getAddressDetails,
  type Network,
} from "@lucid-evolution/lucid";
import { AuthTokenSchema } from "./AuthToken.ts";
import { ModuleRegistrationSchema } from "./HostState.ts";

export const CredentialSchema = Data.Enum([
  Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
  Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
]);
export const AddressSchema = Data.Object({
  payment_credential: CredentialSchema,
  stake_credential: Data.Nullable(Data.Enum([
    Data.Object({ Inline: Data.Tuple([CredentialSchema]) }),
    Data.Object({
      Pointer: Data.Object({
        slot_number: Data.Integer(),
        transaction_index: Data.Integer(),
        certificate_index: Data.Integer(),
      }),
    }),
  ])),
});
export type PlutusAddress = Data.Static<typeof AddressSchema>;
export function bech32Address(
  network: Network,
  address: PlutusAddress,
): string {
  const credential = (value: PlutusAddress["payment_credential"]) =>
    "Script" in value
      ? { type: "Script" as const, hash: value.Script[0] }
      : { type: "Key" as const, hash: value.VerificationKey[0] };
  if (address.stake_credential && !("Inline" in address.stake_credential)) {
    throw new Error(
      "Pointer stake credentials are unsupported by this migration profile",
    );
  }
  return credentialToAddress(
    network,
    credential(address.payment_credential),
    address.stake_credential
      ? credential(address.stake_credential.Inline[0])
      : undefined,
  );
}
export function plutusAddress(address: string): PlutusAddress {
  const details = getAddressDetails(address);
  if (
    !details.paymentCredential || !["Base", "Enterprise"].includes(details.type)
  ) {
    throw new Error(
      "Migration supports full base/enterprise addresses; pointer and reward addresses are unsupported",
    );
  }
  const credential = (value: { type: string; hash: string }) =>
    value.type === "Script"
      ? { Script: [value.hash] as [string] }
      : { VerificationKey: [value.hash] as [string] };
  return {
    payment_credential: credential(details.paymentCredential),
    stake_credential: details.stakeCredential
      ? { Inline: [credential(details.stakeCredential)] }
      : null,
  };
}
export const GovernanceSchema = Data.Object({
  signers: Data.Array(Data.Bytes()),
  quorum: Data.Integer(),
  delay_ms: Data.Integer(),
});
export type Governance = Data.Static<typeof GovernanceSchema>;
export const AuthoritySchema = Data.Object({
  signers: Data.Array(Data.Bytes()),
  quorum: Data.Integer(),
});
export type Authority = Data.Static<typeof AuthoritySchema>;
export const RestorationSchema = Data.Object({
  registry_nonce: Data.Integer(),
  generation: Data.Integer(),
  epoch: Data.Integer(),
  mask: Data.Integer(),
  authority: AuthoritySchema,
  ready_at: Data.Integer(),
  expires_at: Data.Integer(),
});
export const EmergencySchema = Data.Object({
  authority: AuthoritySchema,
  epoch: Data.Integer(),
  mask: Data.Integer(),
  restoration: Data.Nullable(RestorationSchema),
});
export function assertEmergencyAuthority(
  authority: Authority,
  governance: Governance,
) {
  assertGovernance({ ...authority, delay_ms: governance.delay_ms });
  if (authority.signers.some((key) => governance.signers.includes(key))) {
    throw new Error(
      "Emergency and replacement-code authorities must use disjoint keys",
    );
  }
}
export const ImplementationSchema = Data.Object({
  generation: Data.Integer(),
  addresses: Data.Array(AddressSchema),
  compatibility: Data.Bytes(),
});
export type Implementation = Data.Static<typeof ImplementationSchema>;
export const CountsSchema = Data.Object({
  clients: Data.Integer(),
  connections: Data.Integer(),
  channels: Data.Integer(),
});
export type Counts = Data.Static<typeof CountsSchema>;
export const ProposalSchema = Data.Enum([
  Data.Object({
    Replace: Data.Object({
      source_generation: Data.Integer(),
      nonce: Data.Integer(),
      target: ImplementationSchema,
      maximum: CountsSchema,
      escrow_inventory: Data.Bytes(),
    }),
  }),
  Data.Object({
    Rotate: Data.Object({
      nonce: Data.Integer(),
      governance: GovernanceSchema,
    }),
  }),
]);
export type Proposal = Data.Static<typeof ProposalSchema>;
export const Proposal = ProposalSchema as unknown as Proposal;
export const PhaseSchema = Data.Enum([
  Data.Literal("Ready"),
  Data.Object({
    Proposed: Data.Object({
      proposal: ProposalSchema,
      ready_at: Data.Integer(),
      expires_at: Data.Integer(),
    }),
  }),
  Data.Object({
    Moving: Data.Object({
      target: ImplementationSchema,
      limits: CountsSchema,
      next: CountsSchema,
      registration: ModuleRegistrationSchema,
      escrow_remaining: Data.Bytes(),
      module_moved: Data.Boolean(),
    }),
  }),
]);
export const RegistrySchema = Data.Object({
  token: AuthTokenSchema,
  host_policy: Data.Bytes(),
  identity: Data.Object({
    client_policy: Data.Bytes(),
    connection_policy: Data.Bytes(),
    channel_policy: Data.Bytes(),
    escrow_policy: Data.Bytes(),
    reference_holder: AddressSchema,
  }),
  governance: GovernanceSchema,
  nonce: Data.Integer(),
  current: ImplementationSchema,
  phase: PhaseSchema,
  emergency: EmergencySchema,
});
export type Registry = Data.Static<typeof RegistrySchema>;
export const Registry = RegistrySchema as unknown as Registry;
export const RegistryRedeemerSchema = Data.Enum([
  Data.Object({
    Propose: Data.Object({
      proposal: ProposalSchema,
      expires_at: Data.Integer(),
    }),
  }),
  Data.Literal("Cancel"),
  Data.Literal("RotateAuthority"),
  Data.Literal("Begin"),
  Data.Object({ MoveCore: Data.Object({ role: Data.Integer() }) }),
  Data.Literal("MoveTransferRoot"),
  Data.Object({
    MoveEscrow: Data.Object({ siblings: Data.Array(Data.Bytes()) }),
  }),
  Data.Object({
    Activate: Data.Object({ port_siblings: Data.Array(Data.Bytes()) }),
  }),
  Data.Object({ Restrict: Data.Object({ mask: Data.Integer() }) }),
  Data.Object({
    ProposeRestoration: Data.Object({
      mask: Data.Integer(),
      authority: AuthoritySchema,
      expires_at: Data.Integer(),
    }),
  }),
  Data.Literal("CancelRestoration"),
  Data.Literal("Restore"),
]);
export type RegistryRedeemer = Data.Static<typeof RegistryRedeemerSchema>;
export const RegistryRedeemer =
  RegistryRedeemerSchema as unknown as RegistryRedeemer;

export function assertGovernance(governance: Governance): void {
  if (
    governance.signers.length < 1 || governance.signers.length > 7 ||
    new Set(governance.signers).size !== governance.signers.length ||
    governance.signers.some((key) => !/^[0-9a-f]{56}$/.test(key)) ||
    governance.quorum < 1n ||
    governance.quorum > BigInt(governance.signers.length) ||
    governance.delay_ms < 86_400_000n
  ) {
    throw new Error(
      "Governance requires 1–7 distinct 28-byte keys, a valid threshold, and at least 24 hours activation delay",
    );
  }
}
