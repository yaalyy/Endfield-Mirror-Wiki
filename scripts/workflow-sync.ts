import { spawnSync } from "node:child_process";
const args = ["--use-system-ca", "scripts/sync.ts"];
if (process.env.FORCE_REFRESH === "true") args.push("--force");
if (process.env.ALLOW_REMOVALS === "true") args.push("--allow-removals");
const result = spawnSync(process.execPath, args, { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
