// Vite build plugin: output headers for static hosts from browser-safe configuration only.
export function hostingPlugin(env) {
  // Runtime rejection is too late: Vite can serialize the entire import.meta.env.
  // Reject recognized secrets before transformation, without logging their values.
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("VITE_") || !value) continue;
    let secret =
      /SECRET|PASSWORD|SERVICE_ROLE|PRIVATE_KEY|DATABASE_URL|ACCESS_TOKEN|REFRESH_TOKEN/i.test(
        name,
      ) || String(value).includes("sb_secret_");
    for (const jwt of String(value).match(
      /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    ) ?? []) {
      try {
        const role = JSON.parse(
          Buffer.from(jwt.split(".")[1], "base64url").toString(),
        ).role;
        secret ||= role === "service_role" || role === "authenticated";
      } catch {
        /* Malformed public config is handled by startup validation. */
      }
    }
    if (secret)
      throw new Error(
        `Refusing privileged browser configuration in ${name}. Use server-only secrets; no build was generated.`,
      );
  }
  const allowed = [];
  for (const key of ["VITE_SUPABASE_URL", "VITE_MAP_TILE_URL"]) {
    try {
      const url = new URL(env[key]);
      if (url.protocol === "https:") allowed.push(url.origin);
    } catch {
      /* Missing service config stays fail-closed in the UI. */
    }
  }
  const origins = [...new Set(allowed)].join(" ");
  const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: ${origins}; connect-src 'self' ${origins}; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`;
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(self), camera=(), microphone=()",
    "Content-Security-Policy": csp,
  };
  return {
    name: "dropzone-static-headers",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "nginx-security-headers.conf",
        source:
          Object.entries(headers)
            .map(
              ([name, value]) =>
                `add_header ${name} ${JSON.stringify(value).replaceAll("$", "\\$")} always;`,
            )
            .join("\n") + "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: geolocation=(self), camera=(), microphone=()\n  Content-Security-Policy: ${csp}\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
    },
  };
}
