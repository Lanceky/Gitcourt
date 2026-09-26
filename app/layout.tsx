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
      <body>
        <div className="site-notice" role="note">
          <div className="site-notice-inner">
            <strong>Educational research tool:</strong> Git Court is not legal
            advice. Verify every source before relying on it.
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
