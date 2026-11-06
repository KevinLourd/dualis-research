import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Providers } from "@/console/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dualis Research", template: "%s · Dualis Research" },
  description: "Research console: watchlist, company profiles, data health.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider appearance={{ variables: { colorPrimary: "#0b2a5b", borderRadius: "8px" } }}>
      <html lang="en" data-theme="kumo">
        <body className="antialiased">
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
