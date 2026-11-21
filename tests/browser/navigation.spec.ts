import { test, expect, type Page } from "@playwright/test";

const uid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const cid = "33333333-3333-4333-8333-333333333333";
const self = { id: uid, username: "sam", display_name: "Sam", avatar_url: null, mood: null, is_pro: false };
const partner = { ...self, id: other, username: "alex", display_name: "Alex" };

async function openUnlistedChat(page: Page, unavailable = false) {
  await page.addInitScript(({ uid }) => {
    const token = btoa(JSON.stringify({ alg: "HS256" })) + "." + btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated", role: "authenticated" })) + ".test";
    localStorage.setItem("sb-llweydgvtpwgnslvgnqm-auth-token", JSON.stringify({ access_token: token, refresh_token: "test", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: uid, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } }));
  }, { uid });
  await page.route("**/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname.endsWith("/profiles")) body = url.searchParams.get("id")?.startsWith("in.") ? [self, partner] : self;
    if (url.pathname.endsWith("/rpc/find_profiles")) body = [partner];
    if (url.pathname.endsWith("/rpc/open_conversation")) body = cid;
    if (url.pathname.endsWith("/conversations")) {
      if (unavailable) {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "permission denied", code: "42501" }) });
        return;
      }
      body = { id: cid, kind: "direct", title: "", member_a: uid, member_b: other, created_at: "2026-09-01T10:00:00Z", last_activity: "2026-09-01T10:00:00Z", read_a: null, read_b: null, couple_a: false, couple_b: false };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.routeWebSocket("wss://llweydgvtpwgnslvgnqm.supabase.co/**", socket => {
    socket.onMessage(raw => {
      try {
        const message = JSON.parse(String(raw));
        if (Array.isArray(message)) socket.send(JSON.stringify([message[0], message[1], message[2], "phx_reply", { status: "ok", response: { postgres_changes: [] } }]));
      } catch {}
    });
  });
  await page.goto("/");
  await page.locator(".inbox-header").getByRole("button", { name: "New message", exact: true }).click();
  await page.getByRole("textbox", { name: "Search people" }).fill("alex");
  await page.getByRole("button", { name: /Alex.*alex/ }).click();
}

test("a chat outside the first inbox page opens without a blank screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openUnlistedChat(page);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await expect(page.locator(".thread-person")).toContainText("Alex");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("a denied conversation provides a way back to the inbox", async ({ page }) => {
  await openUnlistedChat(page, true);
  await expect(page.locator(".opening-error")).toContainText("This action is unavailable");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to messages" }).click();
  await expect(page.getByRole("textbox", { name: "Search chats" })).toBeVisible();
});

test("login and inbox visual checkpoints", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Username" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("login.png") });
  if (process.env.CI) console.log("UI_LOGIN_" + testInfo.project.name + " " + (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64"));
  await openUnlistedChat(page);
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chat.png") });
  if (process.env.CI) console.log("UI_CHAT_" + testInfo.project.name + " " + (await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64"));
});
