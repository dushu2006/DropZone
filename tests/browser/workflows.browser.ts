import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const event = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
async function open(page: any, role: string, path?: string) {
  await page.goto(
    "/tests/browser/index.html?role=" +
      role +
      "&path=" +
      encodeURIComponent(path ?? `/app/events/${event}/${role}`),
  );
  await expect(
    page.getByRole("heading", { name: "Browser fixture event", exact: true }),
  ).toBeVisible();
}
for (const width of [390, 768, 1440])
  test(`authorized screens render and remain within viewport at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "organizer");
    const nav = page.getByRole("navigation", { name: "Event workflows" });
    for (const label of [
      "Community",
      "Create a post",
      "My activity",
      "Zones & map",
      "Talk to organizers",
      "Communications",
      "Notifications",
      "Teams",
      "Privacy & preferences",
      "My reports & decisions",
      "Event settings",
      "Roster import",
      "Reports",
      "Post review",
      "Audit log",
    ]) {
      await nav
        .getByRole("button", { name: label, exact: label !== "Notifications" })
        .click();
      await expect(page.getByText("Loading workspace tools…")).toHaveCount(0);
      await expect(page.getByText("Loading authorized records…")).toHaveCount(
        0,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 2,
        ),
        `overflow at ${label}`,
      ).toBe(true);
    }
  });
test("labels, focus and automated accessibility on real participant/organizer screens", async ({
  page,
}) => {
  await open(page, "organizer");
  for (const name of [
    "Community",
    "Create a post",
    "My activity",
    "Zones & map",
    "Talk to organizers",
    "Communications",
    "Notifications",
    "Teams",
    "Privacy & preferences",
    "My reports & decisions",
    "Event settings",
    "Roster import",
    "Reports",
    "Post review",
    "Audit log",
  ]) {
    await page
      .getByRole("navigation", { name: "Event workflows" })
      .getByRole("button", { name, exact: name !== "Notifications" })
      .click();
    await expect(page.getByText("Loading authorized records…")).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .include("#root")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});
test("public landing, private URL guard and keyboard login interaction", async ({
  page,
}) => {
  await page.goto("/tests/browser/index.html?role=anonymous&path=/");
  await expect(
    page.getByRole("heading", { name: /Find your people/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("not recognized");
  await page.goto(
    "/tests/browser/index.html?role=anonymous&path=" +
      encodeURIComponent(`/app/events/${event}/organizer`),
  );
  await expect(
    page.getByRole("heading", { name: "Log in to DropZone" }),
  ).toBeVisible();
});
test("roster preview can be cancelled without a mutation", async ({ page }) => {
  await open(page, "organizer");
  await page
    .getByRole("button", { name: "Roster import", exact: true })
    .click();
  await page.getByLabel("Choose roster file").setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "email,display_name,team_name\nfixture@example.test,Fixture,Team",
    ),
  });
  await expect(
    page.getByText("Preview: 1 rows. Nothing has been written."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel import" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).fixtureCalls.filter(
        (c: any) =>
          c.name === "dz_command" && c.args.p_action === "roster.import",
      ),
    ),
  ).toHaveLength(0);
});
test("participant cannot open a privileged page and upload UI states remain honest", async ({
  page,
}) => {
  await open(
    page,
    "participant",
    `/app/events/${event}/participant?page=settings`,
  );
  await expect(page.getByRole("alert")).toContainText(
    "lacks the required permission",
  );
  await open(
    page,
    "participant",
    `/app/events/${event}/participant?page=post&id=cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
  );
  await expect(
    page.getByRole("button", { name: "Upload / retry" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit post", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit post", exact: true }).click();
  await expect(page.getByLabel("Title *", { exact: true })).toHaveValue(
    "Fixture question",
  );
});

test("moderator navigation exposes only explicitly assigned staff tools", async ({
  page,
}) => {
  await open(page, "moderator");
  const nav = page.getByRole("navigation", { name: "Event workflows" });
  await expect(
    nav.getByRole("button", { name: "Reports", exact: true }),
  ).toBeVisible();
  await expect(
    nav.getByRole("button", { name: "Event settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    nav.getByRole("button", { name: "Roster import", exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Create a post", exact: true }).click();
  await expect(page.locator(".dz-workbench > h2")).toBeFocused();
});

test("public authentication and privacy pages have an automated accessibility baseline", async ({
  page,
}) => {
  for (const route of ["/", "/login", "/register", "/recovery", "/privacy"]) {
    await page.goto(
      "/tests/browser/index.html?role=anonymous&path=" +
        encodeURIComponent(route),
    );
    await expect(page.locator("h1")).toBeVisible();
    const result = await new AxeBuilder({ page })
      .include("#root")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        route,
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
  }
});

test("SAMARTHA: rejected author submission opens a populated revision form", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/index.html?role=participant&postStatus=rejected&path=" +
      encodeURIComponent(
        `/app/events/${event}/participant?page=post&id=cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
      ),
  );
  await page.getByRole("button", { name: "Revise requested changes" }).click();
  await expect(page.getByLabel("Title *", { exact: true })).toHaveValue(
    "Fixture question",
  );
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toBeVisible();
});

test("SAMARTHA: blocked tile requests show honest failure guidance without requesting GPS", async ({
  page,
}) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.addInitScript(() => {
    (window as any).__gpsCalls = 0;
    navigator.geolocation.getCurrentPosition = () => {
      (window as any).__gpsCalls++;
    };
  });
  await open(page, "organizer");
  await page.getByRole("button", { name: "Zones & map", exact: true }).click();
  await expect(page.getByText(/Map tiles are unavailable/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__gpsCalls)).toBe(0);
});
