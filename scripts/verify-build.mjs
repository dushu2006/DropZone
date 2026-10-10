import { readFile, readdir, stat } from "node:fs/promises";
import assert from "node:assert/strict";
const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));
const entry = Object.values(manifest).find((v) => v.isEntry);
assert(entry, "Build manifest must have an entry point");
assert(
  (await stat("dist/" + entry.file)).size < 500000,
  "Initial JS exceeds the 500 kB audit budget",
);
assert(
  Object.keys(manifest).some(
    (k) => k.includes("Workbench") && manifest[k].isDynamicEntry,
  ),
  "Workspace must be lazy",
);
assert(
  Object.keys(manifest).some(
    (k) => k.includes("ZoneMap") && manifest[k].isDynamicEntry,
  ),
  "Map must be lazy",
);
const files = (await readdir("dist/assets")).filter((f) => f.endsWith(".js"));
for (const file of files) {
  const text = await readFile("dist/assets/" + file, "utf8");
  for (const fixture of [
    "Team Aurora",
    "A reply to your offer",
    "Browser fixture event",
    "test-only-access-token",
  ])
    assert(!text.includes(fixture), `Test/demo fixture leaked into ${file}`);
  assert(
    !/sb_secret_[A-Za-z0-9_-]{20,}/.test(text),
    "Privileged key pattern in bundle",
  );
  assert(
    !text.includes("DROPZONE_MAINTENANCE_SECRET"),
    "Server-only maintenance config in browser",
  );
}
const index = await readFile("dist/index.html", "utf8");
assert(
  !index.includes("fonts.googleapis.com"),
  "Fonts must not require a third party",
);
assert(
  (await readFile("dist/_redirects", "utf8")).includes("/* /index.html 200"),
);
const headers = await readFile("dist/_headers", "utf8");
assert(headers.includes("Content-Security-Policy:"));
assert(headers.includes("object-src 'none'"));
console.log(
  "PASS: lazy routes/map, initial bundle budget, fixture/secret spot checks, self-hosted fonts, SPA fallback and security headers",
);
