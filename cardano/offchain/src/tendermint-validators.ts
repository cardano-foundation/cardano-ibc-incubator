import { Data, type LucidEvolution } from "@lucid-evolution/lucid";
import { readValidator } from "./utils.ts";

export const loadStagedTendermintValidators = (
  lucid: LucidEvolution,
  hostStateNftPolicyId: string,
  recoveryScriptHash: string,
  registryPolicy: string,
) => {
  const [sessionSpendValidator, sessionSpendScriptHash, sessionSpendAddress] =
    readValidator(
      "spending_tendermint_update_session.spend_tendermint_update_session.spend",
      lucid,
      [hostStateNftPolicyId],
      Data.Tuple([Data.Bytes()]) as unknown as [string],
    );

  const [sessionMintValidator, sessionMintPolicyId, sessionMintAddress] =
    readValidator(
      "minting_tendermint_update_session.mint_tendermint_update_session.mint",
      lucid,
      [sessionSpendScriptHash],
      Data.Tuple([Data.Bytes()]) as unknown as [string],
    );

  const [updateValidator, updateHash, updateAddress] = readValidator(
    "update_staged_client.update_staged_client.withdraw",
    lucid,
    [hostStateNftPolicyId, sessionMintPolicyId, recoveryScriptHash],
    Data.Tuple([Data.Bytes(), Data.Bytes(), Data.Bytes()]) as unknown as [
      string,
      string,
      string,
    ],
  );

  const [clientSpendValidator, clientSpendScriptHash, clientSpendAddress] =
    readValidator(
      "upgradeable/client.client.spend",
      lucid,
      [registryPolicy, 1n, hostStateNftPolicyId, updateHash, {
        Script: [recoveryScriptHash],
      }],
      Data.Tuple([
        Data.Bytes(),
        Data.Integer(),
        Data.Bytes(),
        Data.Bytes(),
        Data.Enum([
          Data.Object({ VerificationKey: Data.Tuple([Data.Bytes()]) }),
          Data.Object({ Script: Data.Tuple([Data.Bytes()]) }),
        ]),
      ]) as unknown as [string, bigint, string, string, { Script: [string] }],
    );

  return {
    updateClient: {
      validator: updateValidator,
      scriptHash: updateHash,
      address: updateAddress,
    },
    sessionSpend: {
      validator: sessionSpendValidator,
      scriptHash: sessionSpendScriptHash,
      address: sessionSpendAddress,
    },
    sessionMint: {
      validator: sessionMintValidator,
      policyId: sessionMintPolicyId,
      address: sessionMintAddress,
    },
    clientSpend: {
      validator: clientSpendValidator,
      scriptHash: clientSpendScriptHash,
      address: clientSpendAddress,
    },
  };
};
