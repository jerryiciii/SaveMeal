import { describe, expect, it } from "vitest";
import {
  formatCardPrice,
  formatDistance,
  formatOrderCode,
  formatPickupDay,
  formatPickupWindow,
  formatPinPrice,
  formatVnd,
} from "./format";

describe("format", () => {
  it("formats VND with dot grouping and đ", () => {
    expect(formatVnd(18000)).toBe("18.000đ");
    expect(formatVnd(0)).toBe("0đ");
    expect(formatVnd(1250000)).toBe("1.250.000đ");
  });

  it("formats pin prices like Figma pins", () => {
    expect(formatPinPrice(0)).toBe("0đ");
    expect(formatPinPrice(15000)).toBe("15k");
    expect(formatPinPrice(12500)).toBe("12,5k");
  });

  it("shows FREE on cards for free items", () => {
    expect(formatCardPrice(0)).toBe("FREE");
    expect(formatCardPrice(18000)).toBe("18.000đ");
  });

  it("normalises order codes to LB–NNNN with an en dash", () => {
    expect(formatOrderCode("4281")).toBe("LB–4281");
    expect(formatOrderCode("lb-4281")).toBe("LB–4281");
    expect(formatOrderCode("LB 4281")).toBe("LB–4281");
  });

  it("formats pickup windows in Đà Nẵng time", () => {
    expect(formatPickupWindow("2026-11-23T10:30:00Z", "2026-11-23T11:30:00Z")).toBe("17:30–18:30");
  });

  it("labels pickup days relative to now in Đà Nẵng", () => {
    const now = new Date("2026-11-23T03:00:00Z"); // 10:00 local
    expect(formatPickupDay("2026-11-23T10:30:00Z", now)).toBe("Hôm nay");
    expect(formatPickupDay("2026-11-24T04:30:00Z", now)).toBe("Ngày mai");
    expect(formatPickupDay("2026-11-26T04:30:00Z", now)).toBe("26/11");
  });

  it("formats distances", () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(648)).toBe("650 m");
    expect(formatDistance(1200)).toBe("1,2 km");
  });
});
