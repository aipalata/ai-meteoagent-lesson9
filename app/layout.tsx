import type { Metadata } from "next";
import "@fontsource-variable/golos-text";
import "@fontsource-variable/roboto-condensed";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI-метеоагент · Open-Meteo MCP",
  description: "Узнайте погоду в любом городе с помощью AI и MCP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru"><body>{children}</body></html>;
}
