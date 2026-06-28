import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prior Auth Review Tool",
  description: "FHIR-based clinician-facing prior authorization review tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
