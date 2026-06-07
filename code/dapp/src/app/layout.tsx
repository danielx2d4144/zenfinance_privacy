import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavTabs } from "@/components/NavTabs";
import { TopBar } from "@/components/TopBar";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lending Protocol",
  description:
    "Privacy-preserving multi-asset lending with auditor opt-in. Built on Horizen.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-zinc-950 text-zinc-100"
        suppressHydrationWarning
      >
        <Providers>
          <TopBar />
          <NavTabs />
          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
