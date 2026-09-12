import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/shared/toast-provider";

export const metadata: Metadata = {
  title: "Forense",
  description: "Agente forense de facturación falsa",
};

export const viewport = { themeColor: "#FFFFFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
