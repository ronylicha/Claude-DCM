import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/providers/query-provider";
import { NavigationRail } from "@/components/layout/NavigationRail";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { StatusBar } from "@/components/layout/StatusBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Context Manager Dashboard",
  description: "Distributed Context Manager for Claude Code",
};

/**
 * Inline script injected before hydration to prevent flash of wrong theme.
 * Content is fully static — no user input involved (safe use of dangerouslySetInnerHTML).
 * Reads 'dcm-theme' from localStorage, falls back to legacy 'theme' key then system preference.
 */
function ThemeScript() {
  // Static hardcoded script — not derived from user input, XSS risk is nil.
  const script = [
    "(function(){",
    "try{",
    "var t=localStorage.getItem('dcm-theme');",
    "if(!t)t=localStorage.getItem('theme');",
    "var p=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;",
    "if(t==='dark'||(!t&&p)){document.documentElement.classList.add('dark');}",
    "}catch(e){}",
    "})();",
  ].join("");

  return (
    <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          <div className="flex h-screen overflow-hidden">
            <NavigationRail />
            <div className="flex flex-col flex-1 ml-[72px] overflow-hidden">
              <TopAppBar />
              <main className="flex-1 overflow-auto p-6 pb-[72px]">
                {children}
              </main>
            </div>
          </div>
          <StatusBar />
        </QueryProvider>
      </body>
    </html>
  );
}
