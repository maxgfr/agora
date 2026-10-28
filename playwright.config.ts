import { defineConfig, devices } from "@playwright/test";

// AGORA_E2E_PORT when 4173 is taken by something else on the machine.
const PORT = Number(process.env.AGORA_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun test/e2e-server.ts",
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Headless Chromium hides local addresses behind mDNS names it cannot always resolve
        // itself: with them visible, two test browsers on one machine connect peer to peer.
        launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] },
      },
    },
  ],
});
