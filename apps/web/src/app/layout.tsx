import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ServiceWorkerRegistration } from "@/pwa/ServiceWorkerRegistration";
import "./globals.css";
import styles from "./layout.module.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "LASTBITE", template: "%s · LASTBITE" },
  description: "Cứu món ngon cuối ngày quanh bạn: đặt giữ và nhận tại quầy.",
  applicationName: "LASTBITE",
  appleWebApp: { capable: true, title: "LASTBITE", statusBarStyle: "black-translucent" },
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
