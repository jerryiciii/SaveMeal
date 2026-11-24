import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminMetrics } from "@/lib/api/adminEndpoints";
import type { Me, Reservation } from "@/lib/contract/types";
import { AdminShell } from "./AdminShell";
import { KpisScreen } from "./KpisScreen";
import { ReservationsScreen } from "./ReservationsScreen";

const replaceMock = vi.fn();
let mockPathname = "/admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => mockPathname,
}));

let mockSession:
  | { status: "loading"; me: null }
  | { status: "anonymous"; me: null }
  | { status: "authenticated"; me: Me } = { status: "loading", me: null };

vi.mock("@/features/auth/SessionProvider", () => ({
  useSession: () => ({
    ...mockSession,
    signIn: vi.fn(),
    signOut: vi.fn(),
    reloadMe: vi.fn(),
    setMe: vi.fn(),
  }),
}));

const getMetricsMock = vi.fn<() => Promise<AdminMetrics>>();
const listAccountsMock = vi.fn();
const listReservationsMock = vi.fn();

vi.mock("@/lib/api/adminEndpoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/adminEndpoints")>();
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      getMetrics: (...args: unknown[]) => getMetricsMock(...(args as [])),
      listAccounts: (...args: unknown[]) => listAccountsMock(...args),
      listReservations: (...args: unknown[]) => listReservationsMock(...args),
    },
  };
});

function makeUser(role: "USER" | "ADMIN"): Me {
  return {
    id: role === "ADMIN" ? "acc-admin" : "acc-user",
    displayName: role === "ADMIN" ? "Admin Test" : "Minh",
    phone: "+84900000002",
    email: null,
    avatar: null,
    role,
    status: "ACTIVE",
    seller: { name: null, type: null, verified: false, defaultPickup: null },
    stats: { portionsHandedOver: 0, reservationsActive: 0, listingsActive: 0 },
    createdAt: "2026-11-24T00:00:00Z",
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockPathname = "/admin";
});

describe("AdminShell role guard", () => {
  it("redirects unauthenticated users to /login?next=/admin", () => {
    mockSession = { status: "anonymous", me: null };
    render(<AdminShell>Nội dung</AdminShell>);
    expect(replaceMock).toHaveBeenCalledWith("/login?next=%2Fadmin");
  });

  it("renders a 403 access-denied screen for non-ADMIN users", () => {
    mockSession = { status: "authenticated", me: makeUser("USER") };
    render(<AdminShell>Nội dung mật</AdminShell>);
    expect(screen.getByText(/403 · Không có quyền truy cập/)).toBeTruthy();
    expect(screen.queryByText("Nội dung mật")).toBeNull();
  });

  it("renders navigation tabs and children for ADMIN users", () => {
    mockSession = { status: "authenticated", me: makeUser("ADMIN") };
    render(<AdminShell>Nội dung quản trị</AdminShell>);
    expect(screen.getByText("Nội dung quản trị")).toBeTruthy();
    expect(screen.getByRole("link", { name: "KPIs" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Báo cáo" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tin đăng" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tài khoản" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Đơn giữ chỗ" })).toBeTruthy();
  });
});

describe("KpisScreen & ReservationsScreen", () => {
  it("renders exact DOMAIN §8 KPI labels and sample size without forbidden waste-avoided wording", async () => {
    listAccountsMock.mockResolvedValue({ data: [], page: { nextCursor: null, limit: 50 } });
    getMetricsMock.mockResolvedValue({
      portionsHandedOver: 31,
      reservations: { created: 40, completed: 31, cancelled: 5, expired: 4 },
      completionRate: 0.775,
      listings: { published: 25, expiredWithStock: 6 },
      listingExpiredRate: 0.24,
      discount: { avgRate: 0.38, samples: 22 },
      reports: {
        total: 3,
        byType: { UNSAFE_FOOD: 1, WRONG_INFO: 2 },
        open: 1,
        medianHandlingHours: 5.5,
        byAction: { LISTING_BLOCKED: 1, NONE: 1 },
      },
    });

    const { container } = render(<KpisScreen />);
    expect(await screen.findByText("Suất đã bàn giao")).toBeTruthy();
    expect(screen.getByText("77,5%")).toBeTruthy();
    expect(screen.getByText("24,0%")).toBeTruthy();
    expect(screen.getByText("38,0%")).toBeTruthy();
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("5,5 giờ")).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/lượng thực phẩm cứu được/i);
    expect(text).not.toMatch(/waste avoided/i);
  });

  it("renders reservation details in Vietnamese format and never renders pickupToken", async () => {
    const sampleReservation: Reservation = {
      id: "r-1",
      code: "SM–4281",
      status: "RESERVED",
      quantity: 1,
      unitPrice: 18000,
      totalPrice: 18000,
      listing: {
        id: "l-com-ga",
        title: "Combo cơm gà nướng",
        image: null,
        pickupStart: "2026-11-24T10:30:00Z",
        pickupEnd: "2026-11-24T11:30:00Z",
        pickup: { address: "8 An Thượng 4", lat: 16.0512, lng: 108.2462 },
        status: "PUBLISHED",
      },
      seller: { id: "acc-an-thuong", name: "Bếp An Thượng", type: "SHOP", verified: true },
      buyer: { displayName: "Minh" },
      pickupToken: { qrPayload: "SM1.TOP_SECRET_TOKEN", expiresAt: "2026-11-24T12:00:00Z" },
      cancelReason: null,
      createdAt: "2026-11-24T09:00:00Z",
      completedAt: null,
      closedAt: null,
      canCancel: false,
      canReport: false,
    };
    listReservationsMock.mockResolvedValue({ data: [sampleReservation], page: { nextCursor: null, limit: 50 } });

    const { container } = render(<ReservationsScreen />);
    expect((await screen.findAllByText("SM–4281")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("18.000đ").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bếp An Thượng").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("SM1.TOP_SECRET_TOKEN");
  });
});
