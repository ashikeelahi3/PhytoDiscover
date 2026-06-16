import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono, Geist } from "next/font/google";
import { Providers } from "@/components/Providers";
import { TopNav } from "@/components/TopNav";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PhytoDiscover",
  description: "Phytochemical-based drug discovery platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn("h-full", inter.variable, ibmPlexMono.variable, "font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body className="h-full flex flex-col antialiased" suppressHydrationWarning>
        <Providers>
          <TopNav />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
