export function mapConfiguration(
  env: { VITE_MAP_TILE_URL?: string; VITE_MAP_ATTRIBUTION?: string },
  production: boolean,
) {
  const url = env.VITE_MAP_TILE_URL?.trim(),
    attribution = env.VITE_MAP_ATTRIBUTION?.trim();
  if (!url)
    return production
      ? {
          error:
            "Map provider is not configured. Set VITE_MAP_TILE_URL and VITE_MAP_ATTRIBUTION for an approved tile provider. Saved boundaries and coordinate editing remain available.",
        }
      : {
          url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          attribution:
            "© OpenStreetMap contributors (development use; review usage policy)",
        };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      url.includes("{s}") ||
      !["{z}", "{x}", "{y}"].every((p) => url.includes(p)) ||
      !attribution ||
      /your[-_]|placeholder/i.test(url)
    )
      throw Error();
    return { url, attribution };
  } catch {
    return {
      error:
        "Map configuration is invalid. Use an HTTPS raster tile URL with {z}/{x}/{y} placeholders and provider attribution.",
    };
  }
}
