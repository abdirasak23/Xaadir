import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xaadir | People operations",
  description: "Simple, secure staff and attendance administration.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
