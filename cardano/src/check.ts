import {
  Data,
  fromText,
  Kupmios,
  Lucid,
} from "npm:@lucid-evolution/lucid@0.3.51";
import { load } from "https://deno.land/std@0.213.0/dotenv/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v1.0.0-rc.3/command/mod.ts";
import { DeploymentTemplate } from "./template.ts";
import { AuthToken } from "../lucid-types/ibc/auth/AuthToken.ts";
import {
  generateTokenName,
  parseChannelSequence,
  parseClientSequence,
  parseConnectionSequence,
} from "./utils.ts";
import { ClientDatum } from "../lucid-types/ibc/client/ics_007_tendermint_client/client_datum/ClientDatum.ts";
import { ConnectionDatum } from "../lucid-types/ibc/core/ics_003_connection_semantics/connection_datum/ConnectionDatum.ts";
import { ChannelDatum } from "../lucid-types/ibc/core/ics_004/channel_datum/ChannelDatum.ts";

const env = await load({ allowEmptyValues: true });

const kupoUrl = env["KUPO_URL"] ? env["KUPO_URL"] : "";
const ogmiosUrl = env["OGMIOS_URL"] ? env["OGMIOS_URL"] : "";

await new Command()
  .name("cardano-ibc")
  .version("0.1.0")
  .description("Query Cardano IBC info")
  .action(function () {
    this.showHelp();
  })
  .globalOption("-k, --kupo <url:string>", "Kupo URL", {
    default: kupoUrl,
  })
  .globalOption("-o, --ogmios <url:string>", "Ogmios URL", {
    default: ogmiosUrl,
  })
  .globalOption("-ha, --handler <path:string>", "Path to handler.json file", {
    default: "./deployments/handler.json",
  })
  .command("client", "Query client, eg: ibc_client-0")
  .arguments("<value:string>")
  .action(async ({ handler, kupo, ogmios }, id) => {
    console.log("Query client with id:", id);
    const deploymentInfo = await loadDeploymentInfo(handler);

    const handlerToken: AuthToken = {
      policy_id: deploymentInfo.handlerAuthToken.policyId,
      name: deploymentInfo.handlerAuthToken.name,
    };

    const clientTokenPolicyId = deploymentInfo.validators.mintClient.scriptHash;

    const clientSequence = parseClientSequence(id);

    const clientTokenName = generateTokenName(
      handlerToken,
      fromText("ibc_client"),
      clientSequence
    );

    const lucid = await setupLucid(kupo, ogmios);

    try {
      const clientUtxo = await lucid.utxoByUnit(
        clientTokenPolicyId + clientTokenName
      );

      const clientDatum = Data.from(clientUtxo.datum!, ClientDatum);
      console.dir(clientDatum, { depth: 100 });
    } catch (_error) {
      console.log("Failed to query client");
    }
  })
  .command("connection", "Query connection, eg: connection-0")
  .arguments("<value:string>")
  .action(async ({ handler, kupo, ogmios }, id) => {
    console.log("Query connection with id:", id);
    const deploymentInfo = await loadDeploymentInfo(handler);

    const handlerToken: AuthToken = {
      policy_id: deploymentInfo.handlerAuthToken.policyId,
      name: deploymentInfo.handlerAuthToken.name,
    };

    const tokenPolicyId = deploymentInfo.validators.mintConnection.scriptHash;

    const sequence = parseConnectionSequence(id);

    const tokenName = generateTokenName(
      handlerToken,
      fromText("connection"),
      sequence
    );

    const lucid = await setupLucid(kupo, ogmios);

    try {
      const utxo = await lucid.utxoByUnit(tokenPolicyId + tokenName);

      const datum = Data.from(utxo.datum!, ConnectionDatum);
      console.dir(datum, { depth: 100 });
    } catch (_error) {
      console.log("Failed to query connection");
    }
  })
  .command("channel", "Query channel, eg: channel-0")
  .arguments("<value:string>")
  .action(async ({ handler, kupo, ogmios }, id) => {
    console.log("Query channel with id:", id);
    const deploymentInfo = await loadDeploymentInfo(handler);

    const handlerToken: AuthToken = {
      policy_id: deploymentInfo.handlerAuthToken.policyId,
      name: deploymentInfo.handlerAuthToken.name,
    };

    const tokenPolicyId = deploymentInfo.validators.mintChannel.scriptHash;

    const sequence = parseChannelSequence(id);

    const tokenName = generateTokenName(
      handlerToken,
      fromText("channel"),
      sequence
    );

    const lucid = await setupLucid(kupo, ogmios);

    try {
      const utxo = await lucid.utxoByUnit(tokenPolicyId + tokenName);

      const datum = Data.from(utxo.datum!, ChannelDatum);
      console.dir(datum, { depth: 100 });
    } catch (_error) {
      console.log("Failed to query channel");
    }
  })
  .command("balance", "Query balance of an address or public key hash")
  .arguments("<address-or-pk-hash:string>")
  .action(async ({ handler, kupo, ogmios }, id) => {
    const isAddress = id.startsWith("addr");

    console.log(
      `Query balance of ${isAddress ? "address" : "public key hash"}:`,
      id
    );
    const lucid = await setupLucid(kupo, ogmios);

    try {
      const address = isAddress
        ? id
        : lucid.utils.credentialToAddress({ hash: id, type: "Key" });

      const utxos = await lucid.utxosAt(address);

      const tokens: Map<string, bigint> = new Map();

      for (const utxo of utxos) {
        for (const [name, quantity] of Object.entries(utxo.assets)) {
          const prevAmount = tokens.get(name);

          if (prevAmount === undefined) {
            tokens.set(name, quantity);
          } else {
            tokens.set(name, prevAmount + quantity);
          }
        }
      }

      console.log("Balances:");
      for (const [name, amount] of tokens.entries()) {
        console.log(`${name}: ${amount}`);
      }
    } catch (_error) {
      console.log("Failed to query channel");
    }
  })
  .parse(Deno.args);

async function setupLucid(kupoUrl: string, ogmiosUrl: string) {
  if (!kupoUrl || !ogmiosUrl) {
    throw new Error(`Invalid provider url: ${kupoUrl} ${ogmiosUrl}`);
  }

  console.log("Provider:", `Kupo->${kupoUrl}`, `Ogmios->${ogmiosUrl}`);

  return await Lucid(new Kupmios(kupoUrl, ogmiosUrl), "Preview");
}

async function loadDeploymentInfo(handler: string) {
  const deploymentInfo: DeploymentTemplate = JSON.parse(
    await Deno.readTextFile(handler)
  );
  return deploymentInfo;
}
