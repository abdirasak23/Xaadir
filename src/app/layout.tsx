import type { Metadata } from "next";
import xaadirIcon from "../../public/images/xaadirIcon.png";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xaadir | People operations",
  description: "Simple, secure staff and attendance administration.",
  icons: {
    icon: [{ url: xaadirIcon.src, type: "image/png", sizes: "128x128" }],
    shortcut: xaadirIcon.src,
    apple: xaadirIcon.src,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
