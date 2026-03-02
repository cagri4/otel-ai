import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OtelAI - Virtual Hotel Staff Platform",
  description: "AI-powered virtual employees for boutique hotels",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
