import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://fresco-hardware-set-review.fireborndev.chatgpt.site"),
  title: {
    default: "Fresco Hardware Set Extractor",
    template: "%s | Fresco Hardware Set Extractor",
  },
  description: "Extract and review Division 08 hardware sets with source locations.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
  openGraph: {
    title: "Fresco Hardware Set Extractor",
    description: "Extract and review Division 08 hardware sets with source locations.",
    images: ["/fresco-preview.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
