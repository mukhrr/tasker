import type { Metadata } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tasker — AI Agent That Manages Your Open Source Tasks",
  description:
    "Tasker is an AI-powered assistant that syncs with GitHub to automatically track bounties, update task statuses, and manage payments across your open source repositories.",
  keywords: [
    "open source task tracker",
    "AI task management",
    "GitHub bounty tracker",
    "open source bounties",
    "AI agent task automation",
    "GitHub issue tracker",
    "developer productivity",
    "bounty payment tracker",
    "open source contributions",
    "AI-powered project management",
  ],
  openGraph: {
    title: "Tasker — AI Agent That Manages Your Open Source Tasks",
    description:
      "An AI assistant that watches your GitHub activity, automatically updates task statuses, and keeps your bounties organized.",
    type: "website",
    siteName: "Tasker",
    images: [
      {
        url: "/home_hero.jpg",
        width: 1200,
        height: 630,
        alt: "Tasker — AI-powered open source task tracker dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tasker — AI Agent That Manages Your Open Source Tasks",
    description:
      "An AI assistant that watches your GitHub activity, automatically updates task statuses, and keeps your bounties organized.",
    images: ["/home_hero.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${jakarta.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster />
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
