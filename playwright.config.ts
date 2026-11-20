import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 2,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.MIRROR_BROWSER_REPORT || "reports/browser-results.json",
      },
    ],
    ["html", { outputFolder: "reports/playwright", open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173/Endfield-Mirror-Wiki/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/Endfield-Mirror-Wiki/",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
