import * as path from "node:path";
import * as fs from "node:fs";

/**
 * How this works:
 *  - When the code being bundled is trying to import a wasm file,
 *    it will get intercepted by our onResolve handler.
 *    - It resolves the absolute path of the wasm file and redirect it to the
 *      `wasmLoaderImportStub` namespace.
 *
 *  - esbuild will invoke the registered onLoad handler for wasm files in the
 *    `wasmLoaderImportStub` namespace.
 *    - This handler generates a JS file (see generateImportStub)
 *
 *  - esbuild will try to bundle the generated JS file.
 *    - The generated JS file has `import wasm from ${path}`
 *    - This will get intercepted by the onResolve handler again, but this time
 *      with the namespace of the calling code, which is wasmLoaderImportStub.
 *    - The onResolve handler reassigns the namespace to wasmLoaderCopy
 *    - The handler for onLoad for the wasmLoaderCopy namespace loads the WASM binary and
 *      asks esbuild to handle it using the file loader.
 *    - esbuild copies the wasm file to `build-root/<filename>-[hash].wasm` and replaces
 *        import wasm from "path";
 *      with
 *        const wasm = "path relative to current file"
 *    - The generated import stub takes this constant, resolves it relative to the current file
 *      and carries out the ceremonies needed to load a WASM module.
 */

function wasmLoader() {
  return {
    name: "wasmLoader",
    setup(build) {
      build.onResolve({ filter: /.wasm$/ }, (args) => {
        if (args.namespace == "file") {
          return {
            path: path.isAbsolute(args.path)
              ? args.path
              : path.join(args.resolveDir, args.path),
            namespace: "wasmLoaderImportStub",
          };
        }

        return {
          path: args.path,
          namespace: "wasmLoaderCopy",
        };
      });

      build.onLoad(
        { filter: /.wasm$/, namespace: "wasmLoaderImportStub" },
        async (args) => {
          return {
            loader: "js",
            contents: await generateImportStub(args.path),
            resolveDir: path.dirname(args.path),
          };
        },
      );

      build.onLoad(
        { filter: /.wasm$/, namespace: "wasmLoaderCopy" },
        async (args) => {
          return {
            loader: "file",
            contents: await fs.promises.readFile(args.path),
          };
        },
      );
    },
  };
}

async function generateImportStub(importPath) {
  const module = await WebAssembly.compile(await fs.promises.readFile(importPath));
  // Get the imports needed for the WASM module
  const imports = WebAssembly.Module.imports(module);
  // Get the exported members of the WASM module
  const exports = WebAssembly.Module.exports(module);

  let resolveDir = path.dirname(importPath);

  return `
    let imports = {};
    // Fill this objects with imports needed by the WASM module.
    // The WASM module can't import anything other than what's provided in this object.
    ${generateImports("imports", imports, resolveDir)}

    // esbuild will replace this with
    //    const wasmPath = "..path to the .wasm file relative to current file"
    import wasmPath from "${importPath}";

    // Resolve wasmPath relative to the current file
    let url = new URL(wasmPath, import.meta.url);

    // Load the wasm object
    let wasm = await WebAssembly.instantiateStreaming(fetch(url), imports);

    // Re-export everything exported by the WASM module
    ${generateExports("wasm", exports)}
  `;
}

function generateImports(objName, imports, resolveDir) {
  let modules = {};
  for (let { module, name } of imports) {
    if (modules[module] == null) modules[module] = [];
    let moduleEntry = modules[module];
    moduleEntry.push(name);
  }

  return Object.entries(modules)
    .map(
      ([module, names]) =>
        `
          import {${names.join(", ")}} from "${path.join(resolveDir, module)}";
          ${objName}["${module}"] = { ${names.join(", ")} }
        `,
    )
    .join("\n");
}

function generateExports(objName, exports) {
  return exports
    .map(
      ({ name }) =>
        `export const ${name} = ${objName}.instance.exports.${name}`,
    )
    .join(";\n");
}

export { wasmLoader };
