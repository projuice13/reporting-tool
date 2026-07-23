import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProJuice — New Customer Attribution",
  description: "Attribute newly-acquired customers to a marketing source from live WooCommerce order data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
