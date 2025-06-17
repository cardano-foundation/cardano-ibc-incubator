import { Command } from "@cliffy/command";
import { AikenType, PlutusDefinition } from "./src/types.ts";
import { generateType } from "./src/mod.ts";
import { ensureDirSync } from "@std/fs";
import { genTypeToFile } from "./src/utils.ts";

async function main() {
  await (new Command()
    .name("juken")
    .version("0.1.0")
    .description("Generate Aiken types for Lucid")
    .option("-i, --in-file <path:string>", "Path to plutus.json file", {
      default: "./onchain/plutus.json",
    })
    .option(
      "-o, --out-dir <path:string>",
      "Output directory for generated files",
      {
        default: "./offchain/lucid-types",
      },
    )
    .action(({ inFile, outDir }) => {
      const plutusFile = JSON.parse(Deno.readTextFileSync(inFile));

      if (plutusFile.definitions["aiken/math/rational/Rational"] != undefined) {
        plutusFile.definitions["aiken/math/rational/Rational"] = {
          "title": "Rational",
          "anyOf": [
            {
              "title": "Rational",
              "dataType": "constructor",
              "index": 0,
              "fields": [
                {
                  "title": "numerator",
                  "$ref": "#/definitions/Int",
                },
                {
                  "title": "denominator",
                  "$ref": "#/definitions/Int",
                },
              ],
            },
          ],
        };
      }

      Object.entries(plutusFile.definitions).forEach(([key]) =>
        plutusFile.definitions[key].path = key
      );
      const plutusDefinition: PlutusDefinition = plutusFile.definitions;

      let count = 0;

      Object.values(plutusDefinition).forEach((typeDef) => {
        const res = generateType(plutusDefinition, typeDef as AikenType);
        if (res.type == "custom") {
          const dir = `${outDir}/` +
            res.path.split("/").slice(0, -1).join("/");
          ensureDirSync(dir);
          Deno.writeTextFileSync(
            `${outDir}/${res.path}.ts`,
            genTypeToFile(res),
          );
          count++;
        }
      });

      const lintCommand = new Deno.Command(Deno.execPath(), {
        args: ["lint", outDir],
      });
      const { stderr, code } = lintCommand.outputSync();

      if (code !== 0) {
        const error = new TextDecoder().decode(stderr);
        throw new Error("failed to lint generated files\n" + error);
      }

      const fmtCommand = new Deno.Command(Deno.execPath(), {
        args: ["fmt", outDir],
      });
      fmtCommand.outputSync();

      console.log(`Generated ${count} files`);
      console.log(`Files saved to ${outDir}/`);
    })
    .parse(Deno.args));
}

if (import.meta.main) {
  await main();
}
