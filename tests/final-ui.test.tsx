import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../src/auth/AuthProvider";
import { AppRoutes } from "../src/App";
import {
  createFakeSupabase,
  makeSession,
  makeAccess,
  TEST_EVENT_ID,
} from "./fakeSupabase";
import { mapConfiguration } from "../src/phase2/mapConfig";
import { useQuery } from "../src/phase2/api";
import { Attachments } from "../src/phase2/Attachments";
import userEvent from "@testing-library/user-event";
function QueryProbe() {
  const q = useQuery<{ secret: string }>(TEST_EVENT_ID, "post");
  return <p>{q.data?.secret ?? "No private data"}</p>;
}
describe("Final reliability regression coverage", () => {
  it("requires explicit valid production tile configuration, retaining honest development defaults", () => {
    expect(mapConfiguration({}, true).error).toMatch(/not configured/);
    expect(mapConfiguration({}, false).url).toContain("openstreetmap");
    expect(
      mapConfiguration(
        {
          VITE_MAP_TILE_URL: "http://unsafe.test/{z}/{x}/{y}",
          VITE_MAP_ATTRIBUTION: "Provider",
        },
        true,
      ).error,
    ).toBeTruthy();
    expect(
      mapConfiguration(
        {
          VITE_MAP_TILE_URL: "https://tiles.example.test/{z}/{x}/{y}.png",
          VITE_MAP_ATTRIBUTION: "Licensed provider",
        },
        true,
      ).url,
    ).toContain("tiles.example.test");
  });
  it("refreshes trusted event access on focus and removes a revoked workspace", async () => {
    const fake = createFakeSupabase({
      initialSession: makeSession(),
      access: makeAccess("participant"),
    });
    render(
      <MemoryRouter
        initialEntries={[`/app/events/${TEST_EVENT_ID}/participant`]}
      >
        <AppRoutes client={fake.client} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Your event membership is verified."),
    ).toBeTruthy();
    fake.setAccess({ ...makeAccess(), memberships: [] });
    act(() => window.dispatchEvent(new Event("focus")));
    expect(
      await screen.findByText(
        "Your account has no active membership for this event.",
      ),
    ).toBeTruthy();
  });
  it("does not retain a prior account query result even when the event ID is unchanged", async () => {
    const fake = createFakeSupabase({ initialSession: makeSession() });
    fake.rpc.mockResolvedValue({
      data: { secret: "First account private content" },
      error: null,
    } as never);
    render(
      <AuthProvider client={fake.client}>
        <QueryProbe />
      </AuthProvider>,
    );
    expect(
      await screen.findByText("First account private content"),
    ).toBeTruthy();
    fake.rpc.mockImplementation(() => new Promise(() => {}));
    const next = makeSession("second@example.test");
    next.user.id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    act(() => fake.emit("SIGNED_IN", next));
    expect(screen.queryByText("First account private content")).toBeNull();
  });
  it("shows a failed upload honestly and never finalizes missing bytes", async () => {
    const fake = createFakeSupabase({ initialSession: makeSession() });
    fake.rpc.mockImplementation(
      async (name, args) =>
        ({
          data:
            name === "dz_read"
              ? []
              : {
                  id: "attachment",
                  object_path: "event/post/file",
                  status: "pending",
                },
          error: null,
        }) as never,
    );
    const storage = {
      from: () => ({
        upload: vi
          .fn()
          .mockResolvedValue({ error: new Error("Network upload failed") }),
      }),
    };
    Object.assign(fake.client, {
      storage,
      functions: {
        invoke: vi
          .fn()
          .mockResolvedValue({
            data: null,
            error: new Error("Object unavailable"),
          }),
      },
    });
    render(
      <AuthProvider client={fake.client}>
        <Attachments
          eventId={TEST_EVENT_ID}
          postId="post"
          owner
          downloads={false}
        />
      </AuthProvider>,
    );
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "test.png",
      { type: "image/png" },
    );
    Object.defineProperty(file, "slice", {
      value: () => ({
        arrayBuffer: async () =>
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
      }),
    });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText(/Add image/), file);
    await user.click(screen.getByRole("button", { name: "Upload / retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /connection|verification/i,
    );
    expect(
      screen.queryByText("File uploaded to private Supabase Storage."),
    ).toBeNull();
    expect(
      fake.rpc.mock.calls.some(
        ([, args]) => args?.p_action === "attachment.finalize",
      ),
    ).toBe(false);
  });
});
