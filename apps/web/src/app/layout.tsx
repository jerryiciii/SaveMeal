import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ServiceWorkerRegistration } from "@/pwa/ServiceWorkerRegistration";
import "./globals.css";
import styles from "./layout.module.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SaveMeal", template: "%s · SaveMeal" },
  description: "Mua món ngon cuối ngày giá ưu đãi quanh bạn: đặt giữ, trả tiền và nhận tại quầy.",
  applicationName: "SaveMeal",
  appleWebApp: { capable: true, title: "SaveMeal", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#111922",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body>
        <div className={styles.frame}>{children}</div>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
