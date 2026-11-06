import type { Metadata } from "next";
import localFont from "next/font/local";
import { Footer, Header } from "@/components/chrome";
import { getSubstackUrl } from "@/lib/queries";
import "./globals.css";

// Self-hosted (latin subset from Fontsource): the build never calls Google Fonts, so CI cannot fail on a download.
const serif = localFont({
  variable: "--font-serif",
  display: "swap",
  src: [
    { path: "../fonts/newsreader-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/newsreader-400-italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/newsreader-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/newsreader-600-normal.woff2", weight: "600", style: "normal" },
  ],
});
const sans = localFont({
  variable: "--font-sans",
  display: "swap",
  src: [
    { path: "../fonts/ibm-plex-sans-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-sans-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-sans-600-normal.woff2", weight: "600", style: "normal" },
  ],
});
const mono = localFont({
  variable: "--font-mono",
  display: "swap",
  src: [
    { path: "../fonts/ibm-plex-mono-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-mono-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Dualis Research | Independent Equity Research", template: "%s | Dualis Research" },
  description: "Independent research for buy-side opportunities. Long and short ideas in small and mid caps.",
  // Private preview for Thierry: no search engine indexing until launch.
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const substackUrl = await getSubstackUrl();
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Header substackUrl={substackUrl} />
        <main>{children}</main>
        <Footer substackUrl={substackUrl} />
      </body>
    </html>
  );
}
