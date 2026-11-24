import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NavigationFeedback } from "@/components/ui/NavigationFeedback";
import { SessionProvider } from "@/features/auth/SessionProvider";
import { ServiceWorkerRegistration } from "@/pwa/ServiceWorkerRegistration";
import "./globals.css";
import styles from "./layout.module.css";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://savemeal.thezah.space";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "SaveMeal", template: "%s · SaveMeal" },
  description: "Mua món ngon cuối ngày giá ưu đãi quanh bạn: đặt giữ, trả tiền và nhận tại quầy.",
  applicationName: "SaveMeal",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/favicon-32.png",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "SaveMeal",
    title: "SaveMeal — Món ngon cuối ngày quanh bạn",
    description: "Mua món ngon cuối ngày giá ưu đãi quanh bạn: đặt giữ, trả tiền và nhận tại quầy.",
    images: [
      {
        url: "/savemeal-og.png",
        width: 1672,
        height: 941,
        alt: "SaveMeal — Món ngon cuối ngày quanh bạn",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SaveMeal — Món ngon cuối ngày quanh bạn",
    description: "Mua món ngon cuối ngày giá ưu đãi quanh bạn: đặt giữ, trả tiền và nhận tại quầy.",
    images: ["/savemeal-og.png"],
  },
  appleWebApp: { capable: true, title: "SaveMeal", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#f4f4f0",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body>
        <NavigationFeedback />
        <SessionProvider>
          <div className={styles.frame}>{children}</div>
        </SessionProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
