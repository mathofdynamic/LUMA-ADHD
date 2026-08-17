import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  ["migrations:local", []],
  ["types:check", []],
  ["typecheck", []],
  ["test", []],
  ["eval", []],
  ["build", []],
  ["check:startup", []],
];

for (const [script, args] of steps) {
  console.log(`\n[verify] npm run ${script}`);
  // npm.cmd is a shell shim on Windows; invoke cmd.exe explicitly instead of
  // using Node's shell:true mode. The script names and arguments are
  // hard-coded above, so no user input is interpolated here.
  const command = `${npm} run ${script}${args.length > 0 ? ` ${args.join(" ")}` : ""}`;
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { stdio: "inherit", shell: false })
    : spawnSync(npm, ["run", script, ...args], { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\n[verify] deterministic local acceptance passed");
