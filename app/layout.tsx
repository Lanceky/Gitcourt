import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Git Court",
  description:
    "Explore public court histories through a GitHub-inspired learning workspace.",
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
