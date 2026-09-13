import type { Metadata } from "next";
import { Inter, Instrument_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/shared/toast-provider";
import { AgentationDev } from "@/components/shared/agentation-dev";

// docs/22 "Tipografía": Instrument Sans se añade JUNTO a Inter (no la
// sustituye) y se carga por `next/font` en vez del `<link>` a
// fonts.googleapis.com del diseño original — mismo resultado visual, sin
// depender de una CDN externa en cada carga de página. Ambas quedan
// disponibles como variables CSS; `body` sigue usando Inter por omisión y
// `--font-display` (globals.css) es la que usan los componentes del shell
// Inspector.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Inspector",
  applicationName: "Inspector",
  description: "Evidence-led financial investigations",
};

export const viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSans.variable}`}>
      <body>
        {children}
        <ToastProvider />
        {process.env.NODE_ENV === "development" && <AgentationDev />}
      </body>
    </html>
  );
}
