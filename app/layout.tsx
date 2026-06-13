import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { WalletProvider } from "@/components/WalletProvider";
import ToastContainer from "@/components/Toast";

export const metadata: Metadata = {
  title: "Maxtrix – Exchange · Bridge · Pool · Send",
  description: "Next-gen DeFi on Arc Network — powered by Circle App Kit",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='url(%23g)'/><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%2300e5ff'/><stop offset='1' stop-color='%230066ff'/></linearGradient></defs><text x='50%' y='54%' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif' font-weight='900' font-size='20' fill='white'>A</text></svg>",
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
