"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import pinStyles from "@/components/ui/MapPin.module.css";
import type { MapPin } from "@/lib/contract/types";
import { formatPinPrice } from "@/lib/format";
import styles from "./ListingMap.module.css";

type Props = {
  styleUrl: string;
  center: { lat: number; lng: number };
  pins: MapPin[];
  selectedId?: string | null;
  /** Buyer location marker (client-side only, never stored). */
  me?: { lat: number; lng: number } | null;
  onSelect: (pin: MapPin) => void;
  onClearSelection?: () => void;
};

/**
 * MapLibre + OpenStreetMap tiles (spec §3.1). Pins reuse the V1 MapPin look
 * (Figma 01, 2:46/2:48; selected state 13, 7:96). Rendered client-side only.
 */
export default function ListingMap({ styleUrl, center, pins, selectedId = null, me, onSelect, onClearSelection }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<{ id: string; marker: maplibregl.Marker; el: HTMLButtonElement }[]>([]);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClearSelection);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onClearRef.current = onClearSelection;
    selectedIdRef.current = selectedId;
  });

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: styleUrl,
      center: [center.lng, center.lat],
      zoom: 14,
      attributionControl: { compact: true },
    });
    m.on("click", () => {
      onClearRef.current?.();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // Map is created once; center changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl]);

  useEffect(() => {
    map.current?.easeTo({ center: [center.lng, center.lat], duration: 600 });
  }, [center.lat, center.lng]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    markers.current.forEach((item) => item.marker.remove());
    // Listings of the same seller share a pickup point: fan them out so each pin stays tappable.
    const seen = new Map<string, number>();
    markers.current = pins.map((pin) => {
      const at = `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`;
      const n = seen.get(at) ?? 0;
      seen.set(at, n + 1);
      const el = document.createElement("button");
      el.type = "button";
      const isSelected = pin.id === selectedIdRef.current;
      el.className = [pinStyles.pin, pin.isFree ? pinStyles.free : pinStyles.priced, isSelected ? pinStyles.selected : ""]
        .filter(Boolean)
        .join(" ");
      el.textContent = formatPinPrice(pin.price);
      el.setAttribute("aria-label", `${pin.title}, ${pin.isFree ? "miễn phí" : formatPinPrice(pin.price)}`);
      el.setAttribute("aria-pressed", String(isSelected));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectRef.current(pin);
      });
      const marker = new maplibregl.Marker({ element: el, offset: [n * 44, 0] }).setLngLat([pin.lng, pin.lat]).addTo(m);
      return { id: pin.id, marker, el };
    });
  }, [pins]);

  useEffect(() => {
    for (const item of markers.current) {
      const isSelected = item.id === selectedId;
      if (pinStyles.selected) item.el.classList.toggle(pinStyles.selected, isSelected);
      item.el.setAttribute("aria-pressed", String(isSelected));
    }
  }, [selectedId]);

  useEffect(() => {
    const m = map.current;
    meMarker.current?.remove();
    meMarker.current = null;
    if (!m || !me) return;
    const el = document.createElement("span");
    el.className = styles.me ?? "";
    el.setAttribute("aria-label", "Vị trí của bạn");
    meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(m);
  }, [me]);

  return <div ref={box} className={styles.map} role="region" aria-label="Bản đồ món gần bạn" />;
}
