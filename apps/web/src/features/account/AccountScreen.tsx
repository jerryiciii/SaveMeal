"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { useSession } from "@/features/auth/SessionProvider";
import { isMockApi } from "@/lib/api";
import { resetDb } from "@/mocks/db";
import styles from "./account.module.css";

const LINKS = [
  { href: "/orders", title: "Đơn đã đặt", sub: "Theo dõi QR và lịch sử" },
  { href: "/my-listings", title: "Tin đã đăng", sub: "Quản lý suất và khung giờ nhận" },
  { href: "/sales", title: "Đơn chờ nhận", sub: "Người mua đang đến lấy món" },
  { href: "/sales/scan", title: "Quét mã nhận món", sub: "Xác nhận giao món bằng QR" },
];

/** Figma V1 08 · Tài khoản mua & bán / 35 · Trung tâm tài khoản 2 vai trò (ME-1). */
export function AccountScreen() {
  const session = useSession();
  const router = useRouter();
  if (session.status !== "authenticated") return null;
  const me = session.me;

  return (
    <section className={styles.body}>
      <h1 className={styles.h1}>Tài khoản</h1>
      <div className={styles.profile}>
        <b>{me.displayName ?? "Người dùng SaveMeal"}</b>
        <span>{me.seller.name ? `Người mua & người đăng · ${me.seller.name}` : "Vừa mua, vừa có thể đăng pass"}</span>
        {me.seller.verified ? <span className={styles.verified}>Đã xác minh</span> : null}
      </div>
      <div className={styles.stats}>
        <div>
          <b>{me.stats.reservationsActive}</b>
          <span>đơn đang giữ</span>
        </div>
        <div>
          <b>{me.stats.listingsActive}</b>
          <span>tin đang đăng</span>
        </div>
        <div>
          <b>{me.stats.portionsHandedOver}</b>
          <span>suất đã giao</span>
        </div>
      </div>
      <ul className={styles.links}>
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={styles.link}>
              <b>{l.title}</b>
              <span>{l.sub}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link className={styles.primary} href="/post">
        Đăng món mới
      </Link>
      <Button
        variant="secondary"
        onClick={async () => {
          await session.signOut();
          router.replace("/login");
        }}
      >
        Đăng xuất
      </Button>
      {isMockApi ? (
        <Notice>
          <p>
            Chế độ demo (mock).{" "}
            <button
              type="button"
              className={styles.reset}
              onClick={() => {
                resetDb();
                window.location.reload();
              }}
            >
              Đặt lại dữ liệu demo
            </button>
          </p>
        </Notice>
      ) : null}
    </section>
  );
}
