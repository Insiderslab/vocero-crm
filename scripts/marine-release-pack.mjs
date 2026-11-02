#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..");
const COPY_CONCURRENCY = 8;
const ROOT_FILES = [
  ".dockerignore", ".env.example", "LICENSE", "drizzle.config.ts", "eslint.config.mjs", "next-env.d.ts",
  "next.config.ts", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "postcss.config.mjs", "tailwind.config.ts", "tsconfig.json",
];
const SOURCE_DIRECTORIES = ["drizzle", "public", "src", "deploy/marine"];
const REQUIRED_FILES = ["scripts/marine-release-pack.mjs", "scripts/migrate.mjs", "scripts/migrate-channels.mjs"];
const DENIED_DIRECTORIES = new Set([".git", ".next", ".dev-media", ".playwright-mcp", "__pycache__", ".pytest_cache", "coverage", "dist", "node_modules", "runtime"]);
const DENIED_FILES = new Set([".env", "credentials.json", "id_dsa", "id_ed25519", "id_rsa", "secrets.json"]);

function fail(message) { throw new Error(message); }
function slash(value) { return value.split(path.sep).join("/"); }
function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..");
}
async function resolvedDestination(candidate) {
  const missing = [];
  let existing = candidate;
  while (true) {
    try { await stat(existing); break; }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      missing.unshift(path.basename(existing));
      existing = parent;
    }
  }
  return path.resolve(await realpath(existing), ...missing);
}
function denied(relativePath) {
  const segments = slash(relativePath).split("/");
  const name = segments.at(-1)?.toLowerCase() ?? "";
  if (segments.some((part) => DENIED_DIRECTORIES.has(part.toLowerCase()))) return true;
  const envFile = name === ".env" || name.startsWith(".env.") || name.endsWith(".env") || name.includes(".env.");
  if (envFile && name !== ".env.example" && !name.endsWith(".env.example")) return true;
  if (DENIED_FILES.has(name) || /\.(?:db|key|log|p12|pem|pfx|pyc|pyo|sqlite|sqlite3)$/i.test(name)) return true;
  return /^(?:secret|secrets|credentials)\.(?:ini|json|toml|txt|ya?ml)$/i.test(name);
}
async function collectDirectory(relativeDir, files, sourceReal) {
  const absolute = path.join(SOURCE_ROOT, relativeDir);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || !inside(sourceReal, await realpath(absolute))) fail(`Directory sorgente non regolare: ${slash(relativeDir)}`);
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const relative = path.join(relativeDir, entry.name);
    if (denied(relative)) continue;
    if (entry.isSymbolicLink()) fail(`Collegamento simbolico non ammesso: ${slash(relative)}`);
    if (entry.isDirectory()) await collectDirectory(relative, files, sourceReal);
    else if (entry.isFile()) files.push(relative);
  }
}
async function collectFiles() {
  const files = [...ROOT_FILES, ...REQUIRED_FILES];
  const sourceReal = await realpath(SOURCE_ROOT);
  for (const dir of SOURCE_DIRECTORIES) await collectDirectory(dir, files, sourceReal);
  for (const entry of await readdir(path.join(SOURCE_ROOT, "scripts"), { withFileTypes: true })) {
    if (entry.isFile() && /^marine-[a-z0-9-]+\.(?:mjs|js|py|ps1|psm1|ts)$/i.test(entry.name)) files.push(path.join("scripts", entry.name));
  }
  const unique = [...new Set(files.map((file) => path.normalize(file)))].sort((a, b) => slash(a) < slash(b) ? -1 : slash(a) > slash(b) ? 1 : 0);
  for (const relative of unique) {
    if (denied(relative)) fail(`File vietato nell'elenco: ${slash(relative)}`);
    const full = path.join(SOURCE_ROOT, relative);
    const info = await lstat(full);
    if (!info.isFile() || info.isSymbolicLink() || !inside(sourceReal, await realpath(full))) fail(`Input non regolare: ${slash(relative)}`);
  }
  return unique;
}
async function writeExclusive(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "wx", 0o644);
  try { await handle.writeFile(data); } finally { await handle.close(); }
}
async function copy(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  const bytes = await readFile(source);
  await writeExclusive(target, bytes);
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function main() {
  const arg = process.argv[2];
  if (!arg || process.argv.length !== 3) fail("Uso: node scripts/marine-release-pack.mjs <cartella-destinazione-nuova>");
  const destination = path.resolve(arg);
  const sourceReal = await realpath(SOURCE_ROOT);
  if (inside(sourceReal, await resolvedDestination(destination))) fail("La destinazione deve essere fuori dal repository sorgente.");
  try { await stat(destination); fail("La destinazione esiste già: scegli una cartella nuova."); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const parent = path.dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporary = path.join(parent, `.${path.basename(destination)}.partial-${process.pid}-${randomBytes(4).toString("hex")}`);
  const files = await collectFiles();
  try {
    await mkdir(temporary, { recursive: false });
    const manifestFiles = [];
    for (let i = 0; i < files.length; i += COPY_CONCURRENCY) {
      const outcomes = await Promise.allSettled(files.slice(i, i + COPY_CONCURRENCY).map(async (relative) => {
        const result = await copy(path.join(SOURCE_ROOT, relative), path.join(temporary, relative));
        return { path: slash(relative), ...result };
      }));
      const failure = outcomes.find((item) => item.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      manifestFiles.push(...outcomes.map((item) => item.value));
    }
    manifestFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const manifest = { format: "heili-marine-release-source", version: 1, createdAt: new Date().toISOString(), fileCount: manifestFiles.length, files: manifestFiles };
    const manifestBytes = JSON.stringify(manifest, null, 2) + "\n";
    await writeExclusive(path.join(temporary, "release-manifest.json"), manifestBytes);
    await rename(temporary, destination);
    console.log(`Pacchetto creato: ${destination}`);
    console.log(`File verificati nel manifesto: ${files.length}`);
    console.log(`SHA-256 manifesto: ${createHash("sha256").update(manifestBytes).digest("hex")}`);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
main().catch((error) => { console.error(`Errore: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
