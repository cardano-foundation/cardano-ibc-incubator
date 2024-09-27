import * as dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";

async function run() {
  const prefix = "SUBQL_";
  const cosmos = "./cosmoshub.yaml";
  const osmosis = "./osmosis.yaml";
  const cardano = "./cardano.yaml";
  const cosmosFile = path.resolve(process.cwd(), cosmos);
  const osmosisFile = path.resolve(process.cwd(), osmosis);
  const cardanoFile = path.resolve(process.cwd(), cardano);
  const envs = process.env;
  const dataToReplace = (Object.keys(envs) || []).reduce(
    (acc: any, keyEnv: string) => {
      if (!keyEnv || !keyEnv.startsWith(prefix)) return acc;
      return { ...acc, [keyEnv]: process.env[keyEnv] };
    },
    {}
  );
  await Promise.all([
    updateYaml(cosmosFile, dataToReplace),
    updateYaml(osmosisFile, dataToReplace),
    updateYaml(cardanoFile, dataToReplace),
  ])

}

async function updateYaml(filename: any, dataToReplace: any) {
  try {
    const envKeys = Object.keys(dataToReplace) || [];

    for (let index = 0; index < envKeys.length; index++) {
      const envKey = envKeys[index];
      const value = dataToReplace[envKey];
      const data = await fs.readFile(filename, "utf8");
      const regex = new RegExp(String.raw`\s- ${envKey}\s`, "gm");
      const result = data.replace(regex, ` - "${value}" \n`);
      await fs.writeFile(filename, result, "utf8");
    }
  } catch (e) {
    console.log(e);
  }
}

dotenv.config();
run();
