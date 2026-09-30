import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const url = "https://bitchwyat.vercel.app";
const expected = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
let release;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch(url + "/release.json?check=" + Date.now(), { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (response.ok) release = await response.json();
    if (release?.version === expected) break;
    console.log("Awaiting release", response.status, release?.version);
  } catch (error) { console.log("Awaiting release", error.message); }
  await new Promise(resolve => setTimeout(resolve, 10000));
}
assert.equal(release?.version, expected);
for (const path of ["/", "/login/", "/manifest.webmanifest", "/sw.js"]) assert.equal((await fetch(url + path, { signal: AbortSignal.timeout(15000) })).status, 200, path);
console.log("PUBLIC_HTTP_PASS", url, release.version);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Username" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Log in", exact: true }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("tab", { name: "Create account" }).click();
  assert.ok(await page.getByRole("button", { name: "Create account", exact: true }).isVisible());
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.goto(url + "/login/");
  await page.getByRole("textbox", { name: "Username" }).waitFor();
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; if (!registration.active) throw new Error("Service worker is not active."); });
  assert.deepEqual(errors, []);
  console.log("PUBLIC_BROWSER_PASS", page.url());
  console.log("PUBLIC_SCREENSHOT " + (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64"));
} finally { await browser.close(); }
