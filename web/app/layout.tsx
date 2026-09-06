import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { RunProvider } from "../lib/runStore";
import { AuthGate } from "../components/auth/AuthGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Brand typeface — the varimo wordmark + headings (Sora 700, negative tracking).
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["600", "700"],
});

// Body default (redesign type system). Variable font — full 300–700 weight range,
// used both for regular copy and the uppercase mono-style eyebrow/meta labels.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "varimo",
  description: "Many originals from one master — video variant studio, Fast daily packs from your phone or desktop",
  appleWebApp: {
    capable: true,
    title: "varimo",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#e7f1f2",
};

// Prevent static HTML shells from being cached by RunPod's CDN with stale JS refs.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <head>
        {/* Material Symbols Rounded isn't in next/font/google's curated font set, so it's
            loaded the same way the design mock references it: a hosted stylesheet link.
            See .material-symbols-rounded in globals.css for the matching icon-font class.
            eslint-disable: `no-page-custom-font` assumes a Pages Router `_document.js`,
            which doesn't exist in this App Router project — this is the App Router pattern
            for a font next/font/google doesn't carry. `google-font-display` would rather
            we use swap, but block is correct here: on this ligature icon font, swap briefly
            renders the raw icon name (e.g. "home") as text instead of the glyph. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
        />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text">
        <RunProvider>
          <AuthGate>{children}</AuthGate>
        </RunProvider>
      </body>
    </html>
  );
}
