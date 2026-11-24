import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ListingCard } from "@/lib/contract/types";
import { Button } from "./Button";
import { Chip } from "./Chip";
import { FoodCard } from "./FoodCard";
import { MapPin } from "./MapPin";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(cleanup);
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T03:00:00Z")); // 10:00 in Đà Nẵng
});
afterAll(() => {
  vi.useRealTimers();
});

const card: ListingCard = {
  id: "b1",
  title: "Bánh croissant bơ",
  category: "BAKERY",
  image: null,
  originalPrice: 35000,
  price: 0,
  isFree: true,
  quantityAvailable: 2,
  soldOut: false,
  pickupStart: "2026-11-23T10:30:00Z",
  pickupEnd: "2026-11-23T11:30:00Z",
  pickup: { address: "Mỹ An", lat: 0, lng: 0 },
  distanceMeters: 650,
  seller: { id: "s", name: "Tiệm bánh Mây", type: "BAKERY", verified: true },
};

describe("UI kit", () => {
  it("Chip exposes its selected state", () => {
    const onClick = vi.fn();
    render(<Chip selected onClick={onClick}>Miễn phí</Chip>);
    const chip = screen.getByRole("button", { name: "Miễn phí" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("Button is a real button and respects disabled", () => {
    render(<Button disabled>Chưa thể tiếp tục</Button>);
    const btn = screen.getByRole("button", { name: "Chưa thể tiếp tục" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.type).toBe("button");
  });

  it("FoodCard shows FREE, seller · distance and the pickup window", () => {
    render(<FoodCard listing={card} />);
    expect(screen.getByText("FREE")).toBeTruthy();
    expect(screen.getByText("Tiệm bánh Mây · 650 m")).toBeTruthy();
    expect(screen.getByText("Nhận 17:30–18:30")).toBeTruthy();
  });

  it("FoodCard names the day when pickup is not today", () => {
    render(<FoodCard listing={{ ...card, pickupStart: "2026-11-24T04:30:00Z", pickupEnd: "2026-11-24T06:00:00Z" }} />);
    expect(screen.getByText("Nhận ngày mai 11:30–13:00")).toBeTruthy();
  });

  it("FoodCard shows a VND price for paid items", () => {
    render(<FoodCard listing={{ ...card, price: 18000, isFree: false }} />);
    expect(screen.getByText("18.000đ")).toBeTruthy();
  });

  it("MapPin labels price for screen readers", () => {
    render(<MapPin price={15000} title="Bánh ngọt" />);
    expect(screen.getByRole("button", { name: "Bánh ngọt, 15k" }).textContent).toBe("15k");
  });

  it("BottomNav starts collapsed and expands to mark the current tab", async () => {
    pathname = "/notifications";
    const { BottomNav } = await import("./BottomNav");
    render(<BottomNav />);

    const toggle = screen.getByRole("button", { name: "Mở thanh điều hướng" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Thông báo" })).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: "Thông báo" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Khám phá" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Đăng món" })).toBeTruthy();

    // Scrolling down > 36px auto-collapses the bar back to the circular button.
    Object.defineProperty(window, "scrollY", { value: 80, configurable: true });
    fireEvent.scroll(document);
    expect(screen.getByRole("button", { name: "Mở thanh điều hướng" })).toBeTruthy();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
});
