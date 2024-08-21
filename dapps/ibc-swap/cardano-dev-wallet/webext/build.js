import * as esbuild from "esbuild";
import { wasmLoader } from "./wasmLoader.js";
import { nodeModulesPolyfillPlugin } from "esbuild-plugins-node-modules-polyfill";
import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import * as child_process from "node:child_process";
import * as sass from "sass";

import config from "./build.config.js";

function printUsage() {
  console.log();
  console.log("build.js [options]");
  console.log();
  console.log("Options:");
  console.log();
  console.log("  --release");
  console.log(
    "    Build in release mode. If not specified, build in dev mode.",
  );
  console.log(
    "    In release mode, dev server is not started and watching is not enabled.",
  );
  console.log();
  console.log("  --browser chrome|firefox");
  console.log("    Set browser.");
  console.log(
    "    Used to generate manifest.json, start browser and bundle the webextension.",
  );
  console.log();
  console.log("  --run");
  console.log(
    "    Start the browser and load the webextension. Will auto-reload.",
  );
  console.log();
  console.log("  --bundle");
  console.log("    Create the webextension bundle.");
  console.log();
  console.log("  --test");
  console.log("    Run tests.");
  console.log();
  console.log("  --help");
  console.log("    Show usage.");
}

let FILE_TYPES = ["copy", "scss", "manifest", "html"];

async function main() {
  let args = process.argv.slice(2);

  let argsConfig = {
    release: false,
    browser: "chrome",
    run: false,
    bundle: false,
    test: false,
  };

  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg == "--release") {
      argsConfig.release = true;
    } else if (arg == "--browser") {
      let browser = args[i + 1];
      i += 1;
      if (browser != "chrome" && browser != "firefox") {
        console.log("Invalid value for browser:", browser);
        printUsage();
        process.exit(-1);
      }
      argsConfig.browser = browser;
    } else if (arg == "--run") {
      argsConfig.run = true;
    } else if (arg == "--bundle") {
      if (argsConfig.run) {
        console.log("Can't use --run and --bundle together");
        process.exit(-1);
      }
      argsConfig.release = true;
      argsConfig.bundle = true;
    } else if (arg == "--test") {
      argsConfig.release = true;
      argsConfig.test = true;
    } else if (arg == "--help") {
      printUsage();
      process.exit(0);
    } else {
      console.log("Unknown argument:", arg);
      printUsage();
      process.exit(-1);
    }
  }

  fs.rmSync(config.buildDir, { recursive: true, force: true });
  fs.mkdirSync(config.buildDir);


  for (let fileType of FILE_TYPES) {
    for (let key of Object.keys(config[fileType])) {
      let dst = config[fileType][key];
      dst = path.join(config.buildDir, dst);
      config[fileType][key] = dst;
    }
  }

  // Fix config paths to work in windows
  if (path.sep != "/") {
    for (let fileType of FILE_TYPES) {
      let catObj = config[fileType];
      let newObj = {};
      for (let key of Object.keys(catObj)) {
        let keyFixed = key.replaceAll("/", path.sep);
        let valFixed = catObj[key].replaceAll("/", path.sep);
        newObj[keyFixed] = valFixed;
      }
      config[fileType] = newObj;
    }
  }

  let tsEntryPoints = Object.entries(config.typescript).map(([src, dst]) => ({
    in: src,
    out: dst,
  }));

  await watchOthers({ config, watch: !argsConfig.release, argsConfig });

  await new Promise((resolve) => setTimeout(resolve, 500));

  let ctx = await watchTypescript({
    entryPoints: tsEntryPoints,
    outdir: config.buildDir,
    watch: !argsConfig.release,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!argsConfig.release) {
    await serveBuildDir(ctx, config);
  }

  if (argsConfig.run) {
    run({ config, argsConfig });
  }

  if (argsConfig.bundle) {
    bundle({ config, argsConfig });
  }

  if (argsConfig.test) {
    runTests({ config, argsConfig });
  }
}

async function serveBuildDir(ctx, config) {
  let { host, port } = await ctx.serve({ servedir: config.buildDir });

  log(`Serving on ${host}:${port}`);
}

async function watchOthers({ config, watch, argsConfig }) {

  let filesToWatch = [];
  for (let fileType of FILE_TYPES) {
    filesToWatch.push(...Object.keys(config[fileType]))
  }

  let dirsToWatch = {};

  for (let file of filesToWatch) {
    let dir = path.dirname(file);
    if (dirsToWatch[dir] == null) {
      dirsToWatch[dir] = [];
    }
    dirsToWatch[dir].push(path.basename(file));
  }

  for (let file of filesToWatch) {
    if (fs.statSync(file).isDirectory()) {
      let dir = file;
      if (dirsToWatch[dir] == null) {
        dirsToWatch[dir] = [];
      }
    }
  }

  Object.entries(dirsToWatch).map(([dir, files]) => {
    if (watch) {
      fs.watch(dir, {}, (_event, filename) =>
        onFileChange({
          filename: path.join(dir, filename),
          config,
          argsConfig,
        }),
      );
    }

    for (let file of files) {
      onFileChange({ filename: path.join(dir, file), config, argsConfig });
    }
  });
}

async function watchTypescript({ entryPoints, outdir, watch }) {
  let ctx = await esbuild.context({
    entryPoints,
    outdir,
    define: {
      BROWSER_RUNTIME: "1",
    },
    plugins: [
      nodeModulesPolyfillPlugin({
        globals: {
          Buffer: true,
        },
        modules: {
          buffer: true,
        },
      }),
      wasmLoader(),
    ],
    bundle: true,
    platform: "browser",
    format: "esm",
    treeShaking: true,
    allowOverwrite: true,
    sourcemap: true,
    color: true,
    logLevel: "info",
  });

  log(
    "Building typescript: " +
    "\n  " +
    entryPoints.map((entrypoint) => entrypoint.in).join("\n  ") +
    "\n",
  );
  if (watch) {
    ctx.watch();
  } else {
    await ctx.rebuild();
    ctx.dispose();
    ctx = null;
  }

  return ctx;
}

const DEBOUNCER = {
  cache: {},
  time_ms: 100,
  debounce(key, fn) {
    let prevTimer = this.cache[key];
    if (prevTimer != null) {
      clearTimeout(prevTimer);
    }

    let timer = setTimeout(() => {
      fn();
    }, this.time_ms);
    this.cache[key] = timer;
  },
};

function time() {
  let now = new Date();
  let hh = now.getHours();
  let mm = now.getMinutes();
  let ss = now.getSeconds();
  return (
    hh.toString().padStart(2, "0") +
    ":" +
    mm.toString().padStart(2, "0") +
    ":" +
    ss.toString().padStart(2, "0")
  );
}

function log(msg, ...args) {
  console.log(time(), msg, ...args);
}

function onFileChange({ filename, callback, config, argsConfig }) {
  let fn = null;

  if (filename in config.scss) {
    let dst = config.scss[filename];
    fn = () => {
      log(`Compiling SCSS: ${filename}`);
      compileScss(filename, dst);
    };
  } else if (filename in config.manifest) {
    let dst = config.manifest[filename];
    fn = () => {
      log(`Compiling Manifest: ${filename}`);
      compileManifest(filename, dst, argsConfig.browser);
    };
  } else if (filename in config.html) {
    let dst = config.html[filename];
    fn = () => {
      log(`Compiling HTML: ${filename}`);
      compileHtml(filename, dst, argsConfig);
    };
  } else {
    // See if the changed file or any of its parents is a dir that's specified
    // in `config.copy`
    while (filename != "." && filename != "/" && filename != "") {
      if (filename in config.copy) {
        let dst = config.copy[filename];
        fn = () => {
          log(`Copying: ${filename}`);
          fs.cpSync(filename, dst, { force: true, recursive: true });
        };
        break;
      }
      filename = path.dirname(filename);
    }
  }

  if (fn != null) {
    DEBOUNCER.debounce(filename, () => {
      fn();
      if (callback != null) callback();
    });
  }
}

function compileScss(src, dst) {
  let output;
  try {
    output = sass.compile(src, { sourceMap: true });
  } catch (e) {
    log("Error:", e.toString());
    return;
  }

  let dstBaseName = path.basename(dst);
  fs.writeFileSync(
    dst,
    output.css + `\n/*# sourceMappingURL=${dstBaseName}.map */`,
  );
  fs.writeFileSync(dst + ".map", JSON.stringify(output.sourceMap));
}

function compileManifest(src, dst, prefix) {
  let input = fs.readFileSync(src);
  let root = JSON.parse(input);
  let output = fixupManifest(root, prefix);

  fs.writeFileSync(dst, JSON.stringify(output, null, 2));
}

function compileHtml(src, dst, { release }) {
  let srcContents = fs.readFileSync(src).toString();
  let lines = srcContents.split("\n");
  let dstLine = [];

  let inDebugBlock = false;
  for (let line of lines) {
    if (!inDebugBlock && line.includes("[build.js:if(debug)]")) {
      inDebugBlock = true;
      continue;
    }
    if (inDebugBlock && line.includes("[build.js:endif]")) {
      inDebugBlock = false;
      continue;
    }

    if (release && inDebugBlock) continue;

    dstLine.push(line);
  }

  let dstContents = dstLine.join("\n");
  fs.writeFileSync(dst, dstContents);
}

function fixupManifest(root, prefix) {
  prefix = "$" + prefix + ":";

  if (!(root instanceof Object && !Array.isArray(root))) return root;

  let newEntries = [];
  for (let [key, value] of Object.entries(root)) {
    if (key.startsWith("$")) {
      if (key.startsWith(prefix)) {
        key = key.slice(prefix.length);
      } else {
        key = null;
      }
    }
    if (key != null) {
      newEntries.push([key, fixupManifest(value)]);
    }
  }

  return Object.fromEntries(newEntries);
}

function run({ config, argsConfig }) {
  let browserType = "";
  if (argsConfig.browser == "firefox") {
    browserType = "firefox-desktop";
  } else if (argsConfig.browser == "chrome") {
    browserType = "chromium";
  } else {
    throw new Error("unreachable");
  }

  log("Launching browser");
  exec(`npx web-ext run -s ${config.buildDir} -t ${browserType} --devtools`);
}

function bundle({ config, argsConfig }) {
  let manifestFilePath = Object.keys(config.manifest)[0]
  let manifestFile = fs.readFileSync(manifestFilePath);
  let manifest = JSON.parse(manifestFile.toString());
  let version = manifest.version;

  let cmd = "";
  if (argsConfig.browser == "firefox") {
    log("Bundling for Firefox");
    cmd = `npx web-ext build -s ${config.buildDir} -a ${config.artefactsDir} -n cardano-dev-wallet-firefox-${version}.zip --overwrite-dest`;
  } else if (argsConfig.browser == "chrome") {
    log("Bundling for Chrome");
    cmd = `npx web-ext build -s ${config.buildDir} -a ${config.artefactsDir} -n cardano-dev-wallet-chrome-${version}.zip --overwrite-dest`;
  } else {
    throw new Error("unreachable");
  }

  if (!fs.existsSync(config.artefactsDir)) {
    fs.mkdirSync(config.artefactsDir, { recursive: true });
  }

  execSync(cmd);
  log("Bundle created");
}

function runTests({ argsConfig }) {
  log("Starting the test suite");
  let browser = { firefox: "firefox", chrome: "chromium" }[argsConfig.browser];
  execSync(`npx playwright test --browser ${browser}`, { stdio: "inherit" });
}

function exec(cmd, opts) {
  try {
    child_process.exec(cmd, opts);
  } catch (e) {
    if (e.stdout != null) log("Error:", e.stdout.toString("utf8"));
    else log("Process failed");
  }
}

function execSync(cmd, opts) {
  try {
    child_process.execSync(cmd, opts);
  } catch (e) {
    if (e.stdout != null) log("Error:", e.stdout.toString("utf8"));
    else log("Process failed");
  }
}

await main();
