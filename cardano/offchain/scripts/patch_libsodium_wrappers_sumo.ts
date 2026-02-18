// scripts/patch_libsodium_wrappers_sumo.ts
const shim = `import sodium from "libsodium-sumo";
export default sodium;
export * from "libsodium-sumo";
`;

const base = "node_modules/.deno";

async function exists(path: string) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(base))) {
  console.error(`Not found: ${base}`);
  console.error("This script expects Deno npm packages to be materialized into node_modules/.deno.");
  Deno.exit(1);
}

let patched = 0;

for await (const entry of Deno.readDir(base)) {
  if (!entry.isDirectory) continue;
  if (!entry.name.startsWith("libsodium-wrappers-sumo@")) continue;

  const targetDir =
    `${base}/${entry.name}/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm`;
  const targetFile = `${targetDir}/libsodium-sumo.mjs`;

  if (await exists(targetFile)) continue;

  await Deno.mkdir(targetDir, { recursive: true });
  await Deno.writeTextFile(targetFile, shim);
  console.log(`patched: ${targetFile}`);
  patched++;
}

if (patched === 0) {
  console.log("nothing to patch (shim already present or package not found).");
}