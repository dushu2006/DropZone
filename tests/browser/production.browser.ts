import { test, expect } from "@playwright/test";
test("built static bundle serves direct SPA paths and refreshes public privacy without fixtures", async ({
  page,
  request,
}) => {
  const origin = "http://127.0.0.1:4173";
  for (const path of [
    "/login",
    "/register",
    "/recovery",
    "/auth/callback",
    "/auth/reset-password",
    "/app/account",
    "/app/events/test/participant",
    "/app/events/test/organizer",
    "/app/events/test/moderator",
  ]) {
    const response = await request.get(origin + path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("/assets/");
    expect(html).not.toContain("/src/main.tsx");
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/privacy");
  await expect(
    page.getByRole("heading", { name: "DropZone privacy" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "DropZone privacy" }),
  ).toBeVisible();
  await page.goto(origin + "/development-preview");
  await expect(page.getByText(/simulated preview/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});
