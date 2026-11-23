"use client";

import { useState } from "react";
import { MapPin } from "@/components/ui";
import type { MapPin as MapPinData } from "@/lib/contract/types";
import styles from "./MapPreview.module.css";

/** Projects pins into a 0–1 box around their bounds (with padding). Exported for tests. */
export function projectPins(pins: MapPinData[], pad = 0.18): { pin: MapPinData; x: number; y: number }[] {
  if (pins.length === 0) return [];
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const spanLat = maxLat - minLat || 0.01;
  const spanLng = maxLng - minLng || 0.01;
  return pins.map((pin) => ({
    pin,
    x: pad + ((pin.lng - minLng) / spanLng) * (1 - 2 * pad),
    y: pad + ((maxLat - pin.lat) / spanLat) * (1 - 2 * pad),
  }));
}

/**
 * Placeholder for the map in Figma V1 01 until FE M3 adds the real map tiles.
 * Pins are positioned relative to each other only.
 */
export function MapPreview({ pins }: { pins: MapPinData[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className={styles.map} role="region" aria-label="Bản đồ món gần bạn (bản xem trước)">
      <div className={styles.grid} aria-hidden="true" />
      {projectPins(pins).map(({ pin, x, y }) => (
        <span key={pin.id} className={styles.pin} style={{ left: `${x * 100}%`, top: `${20 + y * 70}%` }}>
          <MapPin
            price={pin.rescuePrice}
            title={pin.title}
            selected={selected === pin.id}
            onClick={() => setSelected(pin.id === selected ? null : pin.id)}
          />
        </span>
      ))}
    </div>
  );
}
