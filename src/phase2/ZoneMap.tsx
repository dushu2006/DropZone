import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Zone } from "./api";
import { errorText, useApi } from "./api";
import { ActionForm } from "./forms";
import { mapConfiguration } from "./mapConfig";
import { requestLocation } from "./location";
function tooltip(text: string) {
  const node = document.createElement("span");
  node.textContent = text;
  return node;
}
export function ZoneMap({
  eventId,
  zones,
  editable,
  refresh,
}: {
  eventId: string;
  zones: Zone[];
  editable: boolean;
  refresh: () => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null);
  const [error, setError] = useState(""),
    [tiles, setTiles] = useState("Loading map tiles…");
  const [points, setPoints] = useState<[number, number][]>([]),
    [kind, setKind] = useState<"circle" | "polygon">("circle"),
    [selected, setSelected] = useState("");
  const [locationNotice, setLocationNotice] = useState("");
  const [location, setLocation] = useState<[number, number] | null>(null);
  const { command } = useApi(eventId);
  const selectedZone = zones.find((z) => z.id === selected);
  useEffect(() => {
    if (!node.current) return;
    const m = L.map(node.current).setView([20.59, 78.96], 5);
    map.current = m;
    const config = mapConfiguration(
      {
        VITE_MAP_TILE_URL: import.meta.env.VITE_MAP_TILE_URL,
        VITE_MAP_ATTRIBUTION: import.meta.env.VITE_MAP_ATTRIBUTION,
      },
      import.meta.env.PROD,
    );
    if (config.error || !config.url)
      setTiles(config.error ?? "Map provider unavailable.");
    else {
      const attribution = tooltip(config.attribution ?? "");
      if (config.url === "https://tile.openstreetmap.org/{z}/{x}/{y}.png") {
        const link = document.createElement("a");
        link.href = "https://www.openstreetmap.org/copyright";
        link.textContent = attribution.textContent;
        attribution.replaceChildren(link);
      }
      const tile = L.tileLayer(config.url, {
        maxZoom: 19,
        attribution: attribution.innerHTML,
      }).addTo(m);
      let tileFailed = false;
      tile.on("loading", () => {
        tileFailed = false;
        setTiles("Loading map tiles…");
      });
      tile.on("load", () => {
        if (!tileFailed) setTiles("");
      });
      tile.on("tileerror", () => {
        tileFailed = true;
        setTiles(
          "Map tiles are unavailable. Check your connection or map provider configuration. Coordinate editing remains available.",
        );
      });
    }
    layer.current = L.layerGroup().addTo(m);
    if (editable)
      m.on("click", (e) =>
        setPoints((p) => [...p, [e.latlng.lng, e.latlng.lat]]),
      );
    return () => {
      m.remove();
      map.current = null;
    };
  }, [editable]);
  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    zones.forEach((z) => {
      if (z.geometry.type === "Point")
        L.circle([z.geometry.coordinates[1], z.geometry.coordinates[0]], {
          radius: z.radius_meters ?? 5,
          color: "#547c67",
        })
          .bindTooltip(tooltip(z.name))
          .addTo(group);
      else L.geoJSON(z.geometry).bindTooltip(tooltip(z.name)).addTo(group);
    });
    const latLngs = points.map((p) => L.latLng(p[1], p[0]));
    latLngs.forEach((p) =>
      L.circleMarker(p, { radius: 5, color: "#e18468" }).addTo(group),
    );
    if (kind === "polygon" && points.length > 1)
      L.polygon(latLngs, { color: "#e18468" }).addTo(group);
    if (location)
      L.circleMarker([location[1], location[0]], {
        radius: 7,
        color: "#3563b0",
      })
        .bindTooltip("Your requested location")
        .addTo(group);
  }, [zones, points, kind, location]);
  useEffect(() => {
    const first = zones[0];
    if (!first || !map.current) return;
    if (first.geometry.type === "Point")
      map.current.setView(
        [first.geometry.coordinates[1], first.geometry.coordinates[0]],
        16,
      );
    else map.current.fitBounds(L.geoJSON(first.geometry).getBounds());
  }, [zones]);
  const locate = async () => {
    try {
      setError("");
      setLocationNotice(
        "Requesting location permission and an accurate reading…",
      );
      const p = await requestLocation(100);
      setLocation([p.longitude, p.latitude]);
      setLocationNotice(
        `Location available (±${Math.round(p.accuracy)} m). This reading is not retained.`,
      );
      map.current?.setView([p.latitude, p.longitude], 16);
    } catch (e) {
      setLocationNotice("");
      setError(errorText(e));
    }
  };
  return (
    <section className="workspace-panel">
      <h2>Event zones</h2>
      <p>
        Pan and zoom the map. Location is optional here and is never requested
        automatically.
      </p>
      <div
        className="dz-map"
        ref={node}
        aria-label="Interactive geographic map"
      />
      {tiles && <p role="status">{tiles}</p>}
      {locationNotice && <p role="status">{locationNotice}</p>}
      <button className="secondary-button" onClick={() => void locate()}>
        Request my location
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {editable && (
        <>
          <label className="auth-field">
            <span>Edit boundary</span>
            <select
              value={selected}
              onChange={(e) => {
                const z = zones.find((z) => z.id === e.target.value);
                setSelected(e.target.value);
                setKind(z?.boundary_type ?? "circle");
                setPoints(
                  z?.geometry.type === "Point"
                    ? [z.geometry.coordinates as [number, number]]
                    : z?.geometry.type === "Polygon"
                      ? (z.geometry.coordinates[0].slice(0, -1) as [
                          number,
                          number,
                        ][])
                      : [],
                );
              }}
            >
              <option value="">New zone</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="auth-field">
            <span>Boundary type</span>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setPoints([]);
              }}
            >
              <option value="circle">Circle</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
          <p>
            {kind === "circle"
              ? "Click to select the center; the last selected point is used."
              : "Click at least three distinct points in perimeter order. Do not cross edges."}
          </p>
          <button
            className="secondary-button"
            onClick={() => setPoints((p) => p.slice(0, -1))}
          >
            Undo point
          </button>{" "}
          <button className="secondary-button" onClick={() => setPoints([])}>
            Clear boundary
          </button>
          <ol>
            {points.map((p, i) => (
              <li key={i}>
                {p[1].toFixed(6)}, {p[0].toFixed(6)}
              </li>
            ))}
          </ol>
          <ActionForm
            fields={[
              {
                key: "longitude",
                label: "Longitude (keyboard coordinate selection)",
                type: "number",
                min: -180,
                max: 180,
                required: true,
              },
              {
                key: "latitude",
                label: "Latitude",
                type: "number",
                min: -90,
                max: 90,
                required: true,
              },
            ]}
            label="Add coordinate"
            submit={async (v) => {
              setPoints((p) => [
                ...p,
                [Number(v.longitude), Number(v.latitude)],
              ]);
              return "Coordinate added to the unsaved boundary.";
            }}
          />
          <ActionForm
            key={selected + kind}
            requestScope={{ selected, kind, points }}
            initial={{
              name: selectedZone?.name ?? "",
              radius_meters: String(selectedZone?.radius_meters ?? 250),
            }}
            fields={[
              { key: "name", label: "Zone name", required: true, max: 100 },
              ...(kind === "circle"
                ? [
                    {
                      key: "radius_meters",
                      label: "Radius in meters",
                      type: "number" as const,
                      min: 5,
                      max: 50000,
                      required: true,
                    },
                  ]
                : []),
            ]}
            label="Save boundary"
            submit={async (v, id) => {
              if (points.length < (kind === "circle" ? 1 : 3))
                throw new Error("Select enough points before saving.");
              const geometry =
                kind === "circle"
                  ? { type: "Point", coordinates: points[points.length - 1] }
                  : { type: "Polygon", coordinates: [[...points, points[0]]] };
              await command(
                "zone.save",
                { ...v, id: selected || null, boundary_type: kind, geometry },
                id,
              );
              refresh();
              return "Boundary saved and validated by PostGIS.";
            }}
          />
        </>
      )}
      {!zones.length && <p>No saved zones yet.</p>}
    </section>
  );
}
