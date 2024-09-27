import * as dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";

async function run() {
  const prefix = "SUBQL_";
  const distFile = "./dist/index.js";
  const filePath = path.resolve(process.cwd(), distFile);
  const envs = process.env;
  const dataToReplace = (Object.keys(envs) || []).reduce(
    (acc: any, keyEnv: string) => {
      if (!keyEnv || !keyEnv.startsWith(prefix)) return acc;
      return { ...acc, [keyEnv]: process.env[keyEnv] };
    },
    {}
  );
  try {
    const envKeys = Object.keys(dataToReplace) || [];

    for (let index = 0; index < envKeys.length; index++) {
      const envKey = envKeys[index];
      const value = dataToReplace[envKey];

      const data = await fs.readFile(filePath, "utf8");
      const regex = new RegExp(String.raw`\sprocess.env.${envKey}\s`, "gm");
      const result = data.replace(regex, `"${value}"`);
      await fs.writeFile(filePath, result, "utf8");
    }
  } catch (e) {
    console.log(e);
  }
}

dotenv.config();
run();
