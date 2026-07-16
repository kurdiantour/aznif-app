import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aznif Admin",
  description: "Standalone admin panel for Aznif Domino",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
