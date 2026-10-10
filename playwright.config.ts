import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { inflate } from "./node_modules/@sparticuz/chromium/build/lambdafs.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const external = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const bundled =
  !external && process.platform === "linux" && process.arch === "x64";
// Packaged NSS/NSPR libraries make the isolated tests runnable on minimal Linux.
if (bundled) {
  const root = await inflate(
    join(
      dirname(fileURLToPath(import.meta.resolve("@sparticuz/chromium"))),
      "../bin/al2023.tar.br",
    ),
  );
  process.env.LD_LIBRARY_PATH =
    join(root, "lib") + ":" + (process.env.LD_LIBRARY_PATH ?? "");
}
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.browser.ts",
  workers: 1,
  timeout: 30000,
  outputDir: ".cache/browser-results",
  reporter: [["list"], ["json", { outputFile: ".cache/browser-report.json" }]],
  webServer: [
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://127.0.0.1:5173/tests/browser/index.html",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: "npm run preview -- --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    launchOptions: {
      executablePath:
        external ?? (bundled ? await chromium.executablePath() : undefined),
      args: bundled
        ? chromium.args.filter(
            (arg) =>
              ![
                "--disable-web-security",
                "--allow-running-insecure-content",
                "--single-process",
              ].includes(arg),
          )
        : [],
    },
  },
});
