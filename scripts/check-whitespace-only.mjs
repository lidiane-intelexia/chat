import { spawnSync } from "node:child_process";

const runQuiet = (args) =>
  spawnSync("git", args, {
    stdio: "ignore",
  });

const stagedDiff = runQuiet(["diff", "--cached", "--quiet"]);
if (stagedDiff.status === 0) {
  process.exit(0);
}

if (stagedDiff.status > 1) {
  process.exit(0);
}

const ignoreWhitespace = runQuiet(["diff", "--cached", "-w", "--quiet"]);
if (ignoreWhitespace.status === 0) {
  console.error("Commit aborted: only whitespace or blank-line changes staged.");
  console.error("Add a non-whitespace change or use --no-verify to bypass.");
  process.exit(1);
}
