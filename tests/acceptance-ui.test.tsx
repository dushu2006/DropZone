import { afterEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider } from "../src/auth/AuthProvider";
import { ErrorBoundary } from "../src/ErrorBoundary";
import { Notifications } from "../src/phase2/Messaging";
import { Attachments } from "../src/phase2/Attachments";
import { createFakeSupabase, makeSession, TEST_EVENT_ID } from "./fakeSupabase";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  ["message", "conversations"],
  ["communication", "communications"],
  ["reply", "post"],
  ["post_decision", "post"],
  ["moderation", "safety"],
])(
  "routes %s notifications to %s using the server destination, without marking read",
  async (kind, destination) => {
    const fake = createFakeSupabase({ initialSession: makeSession() });
    fake.rpc.mockResolvedValue({
      data: [
        {
          id: "notification",
          kind,
          title: "Isolated notification",
          created_at: new Date().toISOString(),
          resource_id: "reply-id",
          destination_id: "parent-id",
          read_at: null,
        },
      ],
      error: null,
    } as never);
    const navigate = vi.fn();
    render(
      <AuthProvider client={fake.client}>
        <Notifications
          eventId={TEST_EVENT_ID}
          navigate={navigate}
          refresh={() => {}}
        />
      </AuthProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Open authorized resource" }),
    );
    expect(navigate).toHaveBeenCalledWith(destination, "parent-id");
    expect(
      fake.rpc.mock.calls.some(
        ([, args]) => args?.p_action === "notification.read",
      ),
    ).toBe(false);
  },
);
it("shows a recovery screen instead of private exception details when rendering fails", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never {
    throw new Error("ISOLATED_PRIVATE_EXCEPTION");
  }
  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );
  expect(
    screen.getByRole("heading", { name: "This page could not load" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reload DropZone" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Return to events" }),
  ).toHaveAttribute("href", "/app");
  expect(screen.queryByText(/ISOLATED_PRIVATE_EXCEPTION/)).toBeNull();
});
it.each([false, true])(
  "recovers failed image fetch and decode; offered download = %s",
  async (downloads) => {
    const fake = createFakeSupabase({ initialSession: makeSession() });
    fake.rpc.mockResolvedValue({
      data: [
        {
          id: "a",
          object_path: "isolated/path",
          status: "ready",
          mime: "image/png",
          size_bytes: 8,
        },
      ],
      error: null,
    } as never);
    const download = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: new Error("Isolated unavailable bytes"),
      })
      .mockResolvedValue({ data: new Blob(["isolated bytes"]), error: null });
    Object.assign(fake.client, { storage: { from: () => ({ download }) } });
    const create = vi.fn(() => "blob:isolated-image"),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const view = render(
      <AuthProvider client={fake.client}>
        <Attachments
          eventId={TEST_EVENT_ID}
          postId="post"
          owner={false}
          downloads={downloads}
        />
      </AuthProvider>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Retry image" }),
    );
    const image = await screen.findByAltText(
      "Attachment uploaded by the post author",
    );
    expect(download).toHaveBeenCalledWith("isolated/path");
    expect(
      Boolean(screen.queryByRole("link", { name: "Download image" })),
    ).toBe(downloads);
    fireEvent.error(image);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be decoded",
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry image" }));
    expect(
      await screen.findByAltText("Attachment uploaded by the post author"),
    ).toBeTruthy();
    view.unmount();
    expect(download).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenCalledTimes(2);
  },
);
