import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRootGuess = resolve(scriptDir, "..");

const rootCheck = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: repoRootGuess,
  encoding: "utf8",
});

if (rootCheck.status !== 0) {
  process.exit(0);
}

const repoRoot = rootCheck.stdout.trim() || repoRootGuess;
const hookPath = resolve(repoRoot, ".githooks");

if (!existsSync(hookPath)) {
  process.exit(0);
}

spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: repoRoot,
  stdio: "ignore",
});
