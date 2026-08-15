import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bumpKinds = new Set(["patch", "minor", "major"]);

function usage() {
  return `Bump package.json, commit, tag, and push a release.

Usage:
  npm run release              # patch (default)
  npm run release -- minor
  npm run release -- major
`;
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function parseBump(arg) {
  if (arg === undefined || arg === "") return "patch";
  if (arg === "-h" || arg === "--help") {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (bumpKinds.has(arg)) return arg;
  fail(`unknown bump "${arg}" (expected patch, minor, or major)\n\n${usage()}`);
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return (result.stdout ?? "").trim();
}

function bumpVersion(version, kind) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`package.json version "${version}" is not X.Y.Z`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

const kind = parseBump(process.argv[2]);

if (capture("git", ["rev-parse", "--is-inside-work-tree"]) !== "true") {
  fail("not a git repository");
}

const dirty = capture("git", ["status", "--porcelain"]);
if (dirty) {
  fail("working tree is not clean; commit or stash other changes first");
}

if (capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]) === "HEAD") {
  fail("detached HEAD; check out a branch first");
}

const pkgPath = join(root, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
const current = pkg.version ?? "";
const next = bumpVersion(current, kind);
const tag = `v${next}`;

if (capture("git", ["tag", "-l", tag])) {
  fail(`tag ${tag} already exists`);
}

console.log(`release: ${current} → ${next} (${kind})`);

pkg.version = next;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

const lockPath = join(root, "package-lock.json");
try {
  const lockText = await readFile(lockPath, "utf8");
  let seen = 0;
  const updated = lockText.replace(/"version": "[^"]*"/g, (field) => {
    seen += 1;
    // Root package version appears twice: top-level, then packages[""].
    if (seen <= 2) return `"version": "${next}"`;
    return field;
  });
  if (seen < 2) fail("package-lock.json is missing the root package version fields");
  await writeFile(lockPath, updated, "utf8");
  run("git", ["add", "package.json", "package-lock.json"]);
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  run("git", ["add", "package.json"]);
}

run("git", ["commit", "-m", `Bump to ${next}.`]);
run("git", ["tag", tag]);
run("git", ["push", "-u", "origin", "HEAD", tag]);
console.log(`release: pushed ${tag}`);
