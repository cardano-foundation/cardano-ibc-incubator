import {
  Data,
  fromText,
  Kupmios,
  LucidEvolution,
} from "@lucid-evolution/lucid";
import { readValidator } from "../src/utils.ts";
import { buildLucidWithCompatibleProtocolParameters } from "../src/protocol_parameters.ts";

type ScriptArgs = {
  tokenName: string;
  amount: bigint;
  receiver?: string;
};

function usage(): never {
  throw new Error(
    "Usage: deno run --env-file=.env.default --allow-net --allow-env --allow-read --allow-ffi scripts/mint-mock-token.ts --token-name <name> [--amount <lovelace>] [--receiver <addr>]",
  );
}

function parseArgs(argv: string[]): ScriptArgs {
  let tokenName: string | undefined;
  let amount = 1_000_000n;
  let receiver: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--token-name": {
        tokenName = argv[index + 1];
        index += 1;
        break;
      }
      case "--amount": {
        const raw = argv[index + 1];
        if (!raw) {
          usage();
        }
        amount = BigInt(raw);
        index += 1;
        break;
      }
      case "--receiver": {
        receiver = argv[index + 1];
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        usage();
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!tokenName) {
    usage();
  }

  if (amount <= 0n) {
    throw new Error(`--amount must be positive, received ${amount.toString()}`);
  }

  return { tokenName, amount, receiver };
}

async function buildLucid(): Promise<LucidEvolution> {
  const deployerSk = Deno.env.get("DEPLOYER_SK");
  const kupoUrl = Deno.env.get("KUPO_URL");
  const ogmiosUrl = Deno.env.get("OGMIOS_URL");
  const cardanoNetworkMagic = Deno.env.get("CARDANO_NETWORK_MAGIC");

  if (!deployerSk || !kupoUrl || !ogmiosUrl || !cardanoNetworkMagic) {
    throw new Error("Missing required Cardano offchain environment variables");
  }

  const provider = new Kupmios(kupoUrl, ogmiosUrl);
  const lucid = await buildLucidWithCompatibleProtocolParameters(
    provider,
    ogmiosUrl,
    cardanoNetworkMagic,
  );

  lucid.selectWallet.fromPrivateKey(deployerSk);
  return lucid;
}

async function submitTxQuietly(
  lucid: LucidEvolution,
  txName: string,
  txBuilder: ReturnType<LucidEvolution["newTx"]>,
): Promise<string> {
  const completed = await txBuilder.complete();
  const signed = await completed.sign.withWallet().complete();
  const txHash = await signed.submit();
  await lucid.awaitTx(txHash, 1000);
  console.error(`Minted ${txName} in tx ${txHash}`);
  return txHash;
}

async function main() {
  const { tokenName, amount, receiver } = parseArgs(Deno.args);
  const lucid = await buildLucid();
  const [mintMockTokenValidator, mintMockTokenPolicyId] = readValidator(
    "minting_mock_token.mint_mock_token.mint",
    lucid,
  );

  const tokenNameHex = fromText(tokenName);
  const tokenUnit = mintMockTokenPolicyId + tokenNameHex;
  const receiverAddress = receiver ?? await lucid.wallet().address();

  const txBuilder = lucid
    .newTx()
    .attach.MintingPolicy(mintMockTokenValidator)
    .mintAssets(
      {
        [tokenUnit]: amount,
      },
      Data.void(),
    )
    .pay.ToAddress(receiverAddress, {
      [tokenUnit]: amount,
    });

  const txHash = await submitTxQuietly(
    lucid,
    `mock token ${tokenName}`,
    txBuilder,
  );

  console.log(
    JSON.stringify(
      {
        tokenName,
        tokenNameHex,
        tokenUnit,
        receiverAddress,
        amount: amount.toString(),
        txHash,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `mint-mock-token failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  Deno.exit(1);
});
