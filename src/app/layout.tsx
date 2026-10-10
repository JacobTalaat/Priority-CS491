import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: {
    default: "Priority",
    template: "%s · Priority",
  },
  description: "A little clarity goes a long way. Make room for what matters.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches --background so the phone's browser bar blends into the page.
  themeColor: "#08090a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
