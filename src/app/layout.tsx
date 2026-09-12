import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArcVet — token & deployer trust scanner on Arc",
  description: "Paste a token or deployer address on Arc, get an explainable trust score from on-chain history — no submitted evidence needed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
