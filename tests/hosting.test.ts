// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { hostingPlugin } from "../scripts/hosting.mjs";
function outputs(env: Record<string, string> = {}) {
  const files: Record<string, string> = {};
  hostingPlugin(env).generateBundle.call({
    emitFile: (file: { fileName: string; source: string }) => {
      files[file.fileName] = file.source;
    },
  });
  return files;
}
describe("SAMARTHA static hosting security configuration", () => {
  it("rejects privileged VITE values before they can be embedded in any bundle", () => {
    expect(() =>
      hostingPlugin({
        VITE_SUPABASE_PUBLISHABLE_KEY:
          "sb_secret_ISOLATED_AUDIT_ONLY_NOT_A_KEY",
      }),
    ).toThrow(/privileged/i);
    const jwt = [
      "eyJhbGciOiJIUzI1NiJ9",
      Buffer.from(JSON.stringify({ role: "service_role" })).toString(
        "base64url",
      ),
      "isolated-signature",
    ].join(".");
    expect(() => hostingPlugin({ VITE_SUPABASE_PUBLISHABLE_KEY: jwt })).toThrow(
      /privileged/i,
    );
    expect(() =>
      hostingPlugin({ VITE_DATABASE_PASSWORD: "isolated-password" }),
    ).toThrow(/privileged/i);
    // JSON whitespace in a valid JWT header need not encode to an eyJ prefix.
    const spacedHeader =
      Buffer.from('{ "alg": "HS256" }').toString("base64url");
    expect(() =>
      hostingPlugin({
        VITE_OTHER_PUBLIC_SETTING: jwt.replace(jwt.split(".")[0], spacedHeader),
      }),
    ).toThrow(/privileged/i);
  });
  it("allows missing or public configuration and never prints a rejected value", async () => {
    expect(() => outputs()).not.toThrow();
    expect(() =>
      outputs({
        VITE_SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ISOLATED_TEST",
      }),
    ).not.toThrow();
    const token = (role: string) =>
      [
        "eyJhbGciOiJIUzI1NiJ9",
        Buffer.from(JSON.stringify({ role })).toString("base64url"),
        "isolated-signature",
      ].join(".");
    expect(() =>
      outputs({ VITE_SUPABASE_ANON_KEY: token("anon") }),
    ).not.toThrow();
    expect(() =>
      outputs({ VITE_SUPABASE_ANON_KEY: token("authenticated") }),
    ).toThrow(/privileged/i);
    const value = "DO_NOT_ECHO_THIS_DUMMY_PASSWORD";
    let message = "";
    try {
      outputs({ VITE_DATABASE_PASSWORD: value });
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("VITE_DATABASE_PASSWORD");
    expect(message).not.toContain(value);
    for (const file of ["src/lib/supabase.ts", "src/phase2/ZoneMap.tsx"]) {
      // Whole-env serialization can embed unrelated build variables.
      expect(await readFile(file, "utf8")).not.toMatch(
        /import\.meta\.env(?!\s*\.)/,
      );
    }
  });
  it("generates an exact-origin CSP without privileged data or broad HTTPS wildcards", () => {
    const f = outputs({
      VITE_SUPABASE_URL: "https://project.example.test",
      VITE_MAP_TILE_URL:
        "https://tiles.example.test/{z}/{x}/{y}.png?key=public-token",
    });
    expect(f._headers).toContain(
      "connect-src 'self' https://project.example.test https://tiles.example.test",
    );
    expect(f._headers).not.toContain("public-token");
    expect(f._headers).not.toContain("https:;");
  });
  it("includes every security header in nginx locations that define their own cache header", async () => {
    const config = await readFile("deploy/nginx.conf", "utf8");
    for (const path of ["/assets/", "/"]) {
      const escaped = path.replaceAll("/", "\\/");
      const location = config.match(
        new RegExp(`location ${escaped} \\{([^}]+)\\}`),
      )?.[1];
      expect(location).toBeTruthy();
      expect(location).toContain(
        "include /usr/share/nginx/html/nginx-security-headers.conf;",
      );
    }
    const headers = outputs()["nginx-security-headers.conf"];
    expect(headers).toContain("Content-Security-Policy");
    expect(headers).toContain("nosniff");
    expect(headers).toContain("always;");
  });
});
