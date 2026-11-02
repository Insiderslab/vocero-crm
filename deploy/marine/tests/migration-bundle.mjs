import { build } from "esbuild";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [releaseArgument] = process.argv.slice(2);
if (!releaseArgument || process.argv.length !== 3) {
  console.error("Usage: node deploy/marine/tests/migration-bundle.mjs <frozen-release-directory>");
  process.exit(2);
}

const release = path.resolve(releaseArgument);
const entryPoint = "scripts/migrate.mjs";
const requiredLocalModule = "scripts/migrate-channels.mjs";

try {
  if (!(await stat(release)).isDirectory()) throw new Error("release must be a directory");
  const root = await realpath(release);
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entryPoint],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const localInputs = Object.keys(result.metafile.inputs)
    .map((input) => path.relative(root, path.resolve(root, input)).split(path.sep).join("/"))
    .filter((input) => input && !input.startsWith("../") && !path.isAbsolute(input))
    .sort();
  if (!localInputs.includes(entryPoint) || !localInputs.includes(requiredLocalModule)) {
    console.error(`FAIL migration bundle preflight: expected local modules ${entryPoint}, ${requiredLocalModule}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS migration bundle preflight: ${localInputs.join(", ")}`);
  }
} catch (error) {
  const errors = Array.isArray(error?.errors) ? error.errors : [];
  const missingChannelsModule = errors.some((item) => /Could not resolve ["']\.\/migrate-channels\.mjs["']/.test(item.text ?? ""));
  if (missingChannelsModule) {
    console.error(`FAIL migration bundle preflight: unresolved local module ${requiredLocalModule}`);
  } else {
    console.error("FAIL migration bundle preflight: esbuild could not bundle the local migration entrypoint");
  }
  process.exitCode = 1;
}
