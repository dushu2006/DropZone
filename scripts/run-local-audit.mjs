// Reproducible LOCAL audit only. Never deploys, resets, bootstraps or contacts a staging project.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = "docs/evidence/samartha-audit";
mkdirSync(dir, { recursive: true });
const commands = [
  ["tests", "npm", ["test", "--", "--run"]],
  ["typescript", "npx", ["tsc", "--noEmit", "-p", "tsconfig.json"]],
  ["build", "npm", ["run", "build"]],
  ["build-check", "npm", ["run", "verify:build"]],
  ["browser", "npm", ["run", "test:browser"]],
  [
    "edge",
    "npm",
    [
      "exec",
      "--yes",
      "--package=deno@2.9.6",
      "--",
      "deno",
      "check",
      "supabase/functions/verify-attachment/index.ts",
      "supabase/functions/maintenance/index.ts",
    ],
  ],
  ["dependencies", "npm", ["audit", "--json"]],
  ["pgtap", "npm", ["run", "db:test"]],
  ["hosted-script-syntax", "node", ["--check", "scripts/verify-hosted.mjs"]],
  ["diff", "git", ["diff", "--check"]],
];
const result = {
  executedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  branch: spawnSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).stdout.trim(),
  commands: [],
  sourceSha256: {},
};
let failed = false;
for (const [id, cmd, args] of commands) {
  const startedAt = new Date().toISOString();
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = ((r.stdout ?? "") + (r.stderr ?? "")).replace(
    /\u001b\[[0-9;]*m/g,
    "",
  );
  writeFileSync(`${dir}/${id}.txt`, output);
  result.commands.push({
    id,
    command: [cmd, ...args].join(" "),
    startedAt,
    exitCode: r.status,
    signal: r.signal,
    spawnError: r.error?.message ?? null,
    log: `${id}.txt`,
  });
  console.log(`${id}: exit ${r.status}${r.error ? " " + r.error.message : ""}`);
  // pgTAP failure is NOT a PASS; its actual exit and diagnostic are retained for the report.
  if (r.status !== 0) failed = true;
}
const listed = spawnSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
).stdout.split("\0");
for (const path of new Set(
  listed.filter((p) =>
    /^(src\/|tests\/|supabase\/|scripts\/|deploy\/|public\/|package.*json$|.*config\.[tm]s$|netlify.toml$)/.test(
      p,
    ),
  ),
)) {
  result.sourceSha256[path] = createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
}
writeFileSync(`${dir}/commands.json`, JSON.stringify(result, null, 2) + "\n");
console.log(
  "Actual exits and logs recorded in " +
    dir +
    ". Inspect pgtap.txt separately; no hosted verification was attempted.",
);
process.exitCode = failed ? 1 : 0;
