import { Constr, type Data, fromText } from "@lucid-evolution/lucid";

/** Immutable authority passed to every validator that consumes client state. */
export type ClientRegistration = {
  clientType: string;
  implementation: "tendermint";
  mintPolicy: string;
  spendValidator: string;
  proofPolicy: string;
};

export function validateClientRegistrations(
  registrations: readonly ClientRegistration[],
): void {
  if (registrations.length === 0) {
    throw new Error("At least one light client must be registered");
  }
  for (const field of ["clientType", "mintPolicy", "spendValidator"] as const) {
    const values = registrations.map((registration) => registration[field]);
    if (new Set(values).size !== values.length) {
      throw new Error(`Duplicate light-client registration ${field}`);
    }
  }
  for (const registration of registrations) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(registration.clientType)) {
      throw new Error(`Invalid light-client type: ${registration.clientType}`);
    }
    if (registration.implementation !== "tendermint") {
      throw new Error(
        `Unsupported light-client implementation: ${registration.implementation}`,
      );
    }
    for (
      const field of ["mintPolicy", "spendValidator", "proofPolicy"] as const
    ) {
      if (!/^[0-9a-f]{56}$/.test(registration[field])) {
        throw new Error(`Invalid light-client registration ${field}`);
      }
    }
  }
}

/** Matches ICS-02 registry.ClientRegistration without changing datum encodings. */
export function clientRegistryData(
  registrations: readonly ClientRegistration[],
): Data {
  validateClientRegistrations(registrations);
  return registrations.map((registration) =>
    new Constr(0, [
      fromText(registration.clientType),
      new Constr(0, []), // registry.Implementation.Tendermint
      registration.mintPolicy,
      registration.spendValidator,
      registration.proofPolicy,
    ])
  );
}
