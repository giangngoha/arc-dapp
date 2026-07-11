import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { WalletProvider } from "@/components/WalletProvider";
import ToastContainer from "@/components/Toast";

export const metadata: Metadata = {
  title: "Matrix",
  description: "Next-gen DeFi on Arc Network — powered by Circle App Kit",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%230d1117'/><text x='16' y='24' text-anchor='middle' font-family='system-ui,sans-serif' font-weight='900' font-size='26' fill='%2300e5ff'>M</text></svg>",  
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Nav />
          {children}
        </WalletProvider>
        <ToastContainer />
      </body>
    </html>
  );
}
