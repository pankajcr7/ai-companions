import type { Metadata } from "next";
import { Instrument_Serif, Space_Grotesk, Urbanist } from "next/font/google";
import "./globals.css";

const urbanist = Urbanist({
  variable: "--font-urbanist",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

// An italic serif for the landing page's accent words.
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agent Company",
  description:
    "Give one goal. A team of AI companions plans it, debates it, reviews it, and delivers real work you can see.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${urbanist.variable} ${spaceGrotesk.variable} ${instrument.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
