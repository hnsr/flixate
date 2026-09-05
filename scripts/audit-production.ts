import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const DIST = resolve(ROOT, "dist");
const SENSITIVE_NAME = /(?:TOKEN|SECRET|API_KEY|PASSWORD|PRIVATE_KEY)/i;
const GOOGLE_ACCESS_TOKEN = /\bya29\.[A-Za-z0-9._~-]{20,}/;

type SecretCandidate = { name: string; value: string };

function filesBelow(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path));
    else files.push(path);
  }
  return files;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) return trimmed.slice(1, -1);
  return trimmed;
}

function secretCandidates(): SecretCandidate[] {
  const candidates = Object.entries(process.env)
    .filter(([name, value]) => SENSITIVE_NAME.test(name) && Boolean(value))
    .map(([name, value]) => ({ name, value: value ?? "" }));
  const envPath = resolve(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || !SENSITIVE_NAME.test(match[1] ?? "")) continue;
      candidates.push({ name: match[1]!, value: unquote(match[2] ?? "") });
    }
  }
  return candidates.filter(({ value }) => value.length >= 8 && !/^(?:change-me|example|placeholder)$/i.test(value));
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1);
}

if (!existsSync(resolve(DIST, "index.html")) || !existsSync(resolve(DIST, "sw.js"))) {
  throw new Error("Run the production build before the privacy audit.");
}

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT })
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const isTrackedEnvironmentFile = (path: string) => {
  const name = path.split("/").at(-1) ?? "";
  return name === ".env"
    || (name.startsWith(".env.") && name !== ".env.example")
    || name === ".env~";
};
const forbiddenTracked = tracked.filter((path) =>
  isTrackedEnvironmentFile(path)
  || /^(?:dist|artifacts|playwright-report|test-results|public\/data\/live)(?:\/|$)/.test(path));

const failures: string[] = [];
if (forbiddenTracked.length > 0) {
  failures.push(`Generated or credential-bearing paths are tracked: ${forbiddenTracked.join(", ")}`);
}

const buildFiles = filesBelow(DIST);
const scanTargets = [
  ...tracked.map((path) => resolve(ROOT, path)),
  ...buildFiles,
].filter((path) => existsSync(path) && statSync(path).isFile());
for (const { name, value } of secretCandidates()) {
  for (const path of scanTargets) {
    if (readFileSync(path).includes(Buffer.from(value))) {
      failures.push(`${relative(path)} contains the value of ${name}.`);
    }
  }
}

for (const path of buildFiles) {
  const text = readFileSync(path, "utf8");
  if (GOOGLE_ACCESS_TOKEN.test(text)) failures.push(`${relative(path)} contains a Google access-token-shaped value.`);
}

const serviceWorker = readFileSync(resolve(DIST, "sw.js"), "utf8");
for (const host of ["www.googleapis.com", "accounts.google.com"]) {
  if (serviceWorker.includes(host)) failures.push(`dist/sw.js unexpectedly references ${host}.`);
}

const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
if (clientId && !/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId)) {
  failures.push("VITE_GOOGLE_CLIENT_ID is set but does not look like a Web OAuth client ID.");
}
if (clientId && !buildFiles.some((path) => readFileSync(path).includes(Buffer.from(clientId)))) {
  failures.push("The configured public OAuth client ID is missing from the production artifact.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  throw new Error(`Production privacy audit failed with ${failures.length} finding(s).`);
}

console.log(
  `Production privacy audit passed: ${tracked.length} tracked files and ${buildFiles.length} build files checked; public OAuth client ${clientId ? "configured" : "not set in this local build"}.`,
);
