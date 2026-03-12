
import type { Metadata } from "next";
import { Manrope, Noto_Sans_Devanagari, Noto_Serif_Devanagari, Source_Serif_4 } from "next/font/google";
import { Toaster } from "@/components/ui/toaster"
import { AuthProvider } from "@/context/AuthContext"
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

const hindiSerif = Noto_Serif_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-hindi-serif",
  display: "swap",
});

const hindiSans = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  variable: "--font-hindi-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "UPSC Prep | AI-Powered Learning",
  description: "Master UPSC with AI-generated quizzes, Prelims and Mains tests, and smart study tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${manrope.variable} ${sourceSerif.variable} ${hindiSerif.variable} ${hindiSans.variable} font-sans antialiased bg-slate-50 text-slate-900`}
      >
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
