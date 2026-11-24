"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { buildMapStyleChain, MAPLIBRE_WORKER_URL } from "@/features/discover/mapStyles";
import styles from "./LocationPickerMap.module.css";

const STYLE_LOAD_TIMEOUT_MS = 6000;
const DEFAULT_CENTER = { lat: 16.0544, lng: 108.2022 };

export type PickerPoint = { lat: number; lng: number };

type Props = {
  coords?: PickerPoint;
  styleUrl?: string;
  pinned?: boolean;
  onChange: (point: PickerPoint) => void;
};

/**
 * Interactive MapLibre pin picker for Post Step 2/3.
 * Supports tapping anywhere on the map or dragging the pin, with automatic
 * style fallback (Liberty → Carto Voyager → OSM raster) and ResizeObserver.
 */
export default function LocationPickerMap({ coords = DEFAULT_CENTER, styleUrl, pinned = false, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const container = box.current;
    if (!container) return;

    const styleChain = buildMapStyleChain(styleUrl);
    let fallbackIndex = 0;
    let styleLoaded = false;
    let disposed = false;
    let lastSwitchAt = 0;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

    const m = new maplibregl.Map({
      container,
      style: styleChain[0]!,
      center: [coords.lng, coords.lat],
      zoom: 15,
      attributionControl: false,
    });
    m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    const collapseAttribution = () => {
      const attrib = container.querySelector(".maplibregl-ctrl-attrib");
      if (!attrib) return;
      attrib.classList.remove("maplibregl-compact-show");
      attrib.removeAttribute("open");
    };

    const scheduleWatchdog = () => {
      clearWatchdog();
      if (disposed || styleLoaded || fallbackIndex >= styleChain.length - 1) return;
      watchdog = setTimeout(() => {
        if (!disposed && !styleLoaded && !m.isStyleLoaded()) {
          advanceFallback();
        }
      }, STYLE_LOAD_TIMEOUT_MS);
    };

    const advanceFallback = () => {
      if (disposed || styleLoaded || fallbackIndex >= styleChain.length - 1) return;
      fallbackIndex += 1;
      const nextStyle = styleChain[fallbackIndex];
      if (!nextStyle) return;
      lastSwitchAt = Date.now();
      clearWatchdog();
      m.setStyle(nextStyle);
      scheduleWatchdog();
    };

    const handleStyleReady = () => {
      styleLoaded = true;
      clearWatchdog();
      collapseAttribution();
      m.resize();
    };

    collapseAttribution();
    m.on("load", handleStyleReady);
    m.on("style.load", handleStyleReady);
    m.on("error", (ev) => {
      if (disposed || styleLoaded || m.isStyleLoaded()) return;
      const errName = ev?.error && typeof ev.error === "object" && "name" in ev.error ? String(ev.error.name) : "";
      if (errName === "AbortError") return;
      if (Date.now() - lastSwitchAt < 300) return;
      advanceFallback();
    });

    scheduleWatchdog();

    const pinEl = document.createElement("div");
    pinEl.className = styles.pin ?? "";
    pinEl.setAttribute("aria-label", "Ghim điểm nhận món");

    const marker = new maplibregl.Marker({ element: pinEl, draggable: true, anchor: "bottom" })
      .setLngLat([coords.lng, coords.lat])
      .addTo(m);

    marker.on("dragend", () => {
      const pos = marker.getLngLat();
      onChangeRef.current({ lat: pos.lat, lng: pos.lng });
    });

    m.on("click", (ev) => {
      marker.setLngLat(ev.lngLat);
      onChangeRef.current({ lat: ev.lngLat.lat, lng: ev.lngLat.lng });
    });

    const rafId = window.requestAnimationFrame(() => {
      if (!disposed) m.resize();
    });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        if (!disposed) m.resize();
      });
      ro.observe(container);
    }

    mapRef.current = m;
    markerRef.current = marker;

    return () => {
      disposed = true;
      clearWatchdog();
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
      marker.remove();
      m.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
    // Map is initialized once per styleUrl; coordinate updates sync in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    const m = mapRef.current;
    const marker = markerRef.current;
    if (!m || !marker) return;
    const current = marker.getLngLat();
    const movedExternally = Math.abs(current.lat - coords.lat) > 1e-6 || Math.abs(current.lng - coords.lng) > 1e-6;
    if (movedExternally) {
      marker.setLngLat([coords.lng, coords.lat]);
      m.easeTo({ center: [coords.lng, coords.lat], zoom: Math.max(m.getZoom(), 15), duration: 450 });
    }
  }, [coords.lat, coords.lng]);

  return (
    <div className={styles.wrap}>
      <div ref={box} className={styles.mapBox} role="region" aria-label="Bản đồ chọn điểm nhận món" />
      <div className={[styles.badge, pinned ? styles.badgePinned : ""].filter(Boolean).join(" ")}>
        <span className={styles.dot} aria-hidden="true" />
        <span>
          {pinned
            ? `Đã ghim trên bản đồ · ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
            : "Chạm vào bản đồ hoặc kéo ghim để chọn điểm nhận"}
        </span>
      </div>
    </div>
  );
}
