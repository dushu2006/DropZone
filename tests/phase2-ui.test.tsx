import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionForm } from "../src/phase2/forms";
import { templates, validateTemplate } from "../src/phase2/templates";
import { parseRoster, safeCsvCell, validateRoster } from "../src/phase2/roster";
import { imageMime } from "../supabase/functions/_shared/image";
import { requestLocation } from "../src/phase2/location";
import { AuthProvider } from "../src/auth/AuthProvider";
import { createFakeSupabase, makeSession, TEST_EVENT_ID } from "./fakeSupabase";
import { PostComposer } from "../src/phase2/Feed";
import type { Overview } from "../src/phase2/api";
const overview: Overview = {
  event: {
    id: TEST_EVENT_ID,
    name: "Event",
    description: "",
    status: "active",
    starts_at: null,
    ends_at: null,
    location_required: false,
    max_accuracy_meters: 100,
    downloads_allowed: true,
  },
  zones: [],
  teams: [],
  memberships: [],
  team_memberships: [],
  unread: 0,
  active_posts: 0,
  preferences: [],
};
describe("Phase 2 forms, isolated external boundaries", () => {
  it("never announces success before completion, retains failed input and reuses retry keys", async () => {
    const user = userEvent.setup(),
      submit = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network unavailable"))
        .mockResolvedValue("Saved by server");
    render(
      <ActionForm
        fields={[{ key: "body", label: "Content", required: true }]}
        submit={submit}
      />,
    );
    await user.type(screen.getByLabelText("Content *"), "Keep this input");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "check your connection",
    );
    expect(screen.getByLabelText("Content *")).toHaveValue("Keep this input");
    expect(screen.queryByText("Saved by server")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Saved by server",
    );
    expect(submit.mock.calls[0][1]).toBe(submit.mock.calls[1][1]);
  });
  for (const template of templates)
    it(`${template.code} renders its dedicated fields and submits structured data`, async () => {
      const fake = createFakeSupabase({ initialSession: makeSession() }),
        saved = vi.fn(),
        user = userEvent.setup();
      fake.rpc.mockImplementation(async (name: string, args?: unknown) =>
        name === "dz_command"
          ? {
              data: {
                id: "saved-post",
                status: ["custom", "promotion"].includes(template.code)
                  ? "awaiting_review"
                  : "published",
              },
              error: null,
            }
          : { data: null, error: null },
      );
      render(
        <AuthProvider client={fake.client}>
          <PostComposer
            eventId={TEST_EVENT_ID}
            overview={overview}
            onSaved={saved}
          />
        </AuthProvider>,
      );
      await user.selectOptions(
        screen.getByLabelText("Post template"),
        template.code,
      );
      await user.type(screen.getByLabelText("Title *"), "A real request");
      await user.type(
        screen.getByLabelText("Description *"),
        "Meaningful event content",
      );
      for (const f of template.fields) {
        const input = screen.getByLabelText(f.label + (f.required ? " *" : ""));
        if (!f.required) continue;
        if (f.options) await user.selectOptions(input, f.options[0]);
        else if (f.type === "number") await user.type(input, "2");
        else if (f.type === "datetime-local")
          await user.type(input, "2026-12-01T12:00");
        else await user.type(input, "Relevant detail");
      }
      await user.click(
        screen.getByRole("button", {
          name: ["custom", "promotion"].includes(template.code)
            ? "Submit for review"
            : "Publish post",
        }),
      );
      await waitFor(() => expect(saved).toHaveBeenCalledWith("saved-post"));
      const args = fake.rpc.mock.calls.find(
        (c) => c[0] === "dz_command",
      )?.[1] as {
        p_data: { category: string; fields: Record<string, string> };
      };
      expect(args.p_data.category).toBe(template.code);
      template.fields
        .filter((f) => f.required)
        .forEach((f) => expect(args.p_data.fields[f.key]).toBeTruthy());
    });
  it("validates missing template fields, invalid category values and quantities", () => {
    expect(() =>
      validateTemplate("lost_found", { kind: "not valid", item: "Bottle" }),
    ).toThrow();
    expect(() =>
      validateTemplate("find_teammate", {
        activity: "Event",
        skills: "React",
        openings: "51",
      }),
    ).toThrow();
    expect(() =>
      validateTemplate("need_resource", { item: "Cable", quantity: "1.2" }),
    ).toThrow();
    expect(() => validateTemplate("ask_help", {})).toThrow();
  });
  it("roster validation rejects missing fields, unknown columns, duplicates and conflicting teams", () => {
    const r = validateRoster([
      { email: "a@example.test", display_name: "A", team_name: "One" },
      {
        email: "A@example.test",
        display_name: "A",
        team_name: "Two",
        unknown: "value",
      },
      { email: "invalid", display_name: "" },
    ]);
    expect(r.errors.join(" ")).toMatch(/unknown columns/);
    expect(r.errors.join(" ")).toMatch(/duplicate/);
    expect(r.errors.join(" ")).toMatch(/invalid email/);
    expect(r.errors.join(" ")).toMatch(/display_name/);
  });
  it("parses genuine CSV and XLSX files and rejects formulas", async () => {
    const XLSX = await import("@e965/xlsx"),
      book = XLSX.utils.book_new(),
      sheet = XLSX.utils.json_to_sheet([
        { email: "a@example.test", display_name: "A", team_name: "One" },
      ]);
    XLSX.utils.book_append_sheet(book, sheet, "Roster");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const file = {
      name: "roster.xlsx",
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
    } as File;
    expect((await parseRoster(file)).rows[0].email).toBe("a@example.test");
    const csv = new TextEncoder().encode(
      "email,display_name,team_name\na@example.test,A,One",
    );
    expect(
      (
        await parseRoster({
          name: "roster.csv",
          size: csv.length,
          arrayBuffer: async () => csv.buffer,
        } as File)
      ).errors,
    ).toEqual([]);
    sheet.B2 = { t: "n", f: "1+1", v: 2 };
    const bad = XLSX.write(book, { type: "array", bookType: "xlsx" });
    await expect(
      parseRoster({
        name: "bad.xlsx",
        size: bad.byteLength,
        arrayBuffer: async () => bad,
      } as File),
    ).rejects.toThrow(/Formulas/);
    expect(safeCsvCell('=IMPORTXML("secret")')).toMatch(/^"'/);
  });
  it("image format validation inspects signatures rather than trusting the filename", () => {
    expect(imageMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
      "image/png",
    );
    expect(imageMime(new Uint8Array([255, 216, 255]))).toBe("image/jpeg");
    expect(
      imageMime(new TextEncoder().encode('<svg onload="alert(1)">')),
    ).toBeNull();
  });
  it("location is requested explicitly and distinguishes denied, timeout, inaccurate and valid readings", async () => {
    const get = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: get },
    });
    expect(get).not.toHaveBeenCalled();
    get.mockImplementationOnce((_s, e) => e({ code: 1 }));
    await expect(requestLocation(100)).rejects.toThrow(/denied/);
    get.mockImplementationOnce((_s, e) => e({ code: 3 }));
    await expect(requestLocation(100)).rejects.toThrow(/timed out/);
    get.mockImplementationOnce((s) =>
      s({ coords: { longitude: 79, latitude: 19, accuracy: 500 } }),
    );
    await expect(requestLocation(100)).rejects.toThrow(/inaccurate/);
    get.mockImplementationOnce((s) =>
      s({ coords: { longitude: 79, latitude: 19, accuracy: 20 } }),
    );
    await expect(requestLocation(100)).resolves.toEqual({
      longitude: 79,
      latitude: 19,
      accuracy: 20,
    });
  });
});

describe("Retry context changes", () => {
  it("keeps the input but generates a new retry key when the target changes", async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue("Saved");
    const fields = [{ key: "body", label: "Body", required: true }];
    const view = render(
      <ActionForm fields={fields} requestScope="team-one" submit={submit} />,
    );
    await user.type(screen.getByLabelText("Body *"), "Keep this message");
    await user.click(screen.getByRole("button", { name: "Save" }));
    view.rerender(
      <ActionForm fields={fields} requestScope="team-two" submit={submit} />,
    );
    expect(screen.getByLabelText("Body *")).toHaveValue("Keep this message");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(submit.mock.calls[0][1]).not.toBe(submit.mock.calls[1][1]);
  });
});
