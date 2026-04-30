"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/send",   label: "📤 Send"   },
  { href: "/bridge", label: "🌉 Bridge" },
  { href: "/swap",   label: "🔄 Swap"   },
  { href: "/pool",   label: "🏊 Pool"   },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="border-b border-gray-800 bg-gray-950 sticky top-0 z-50">
      <div className="max-w-2xl mx-auto px-4 flex items-center gap-2 h-16">
        <Link href="/" className="mr-auto font-bold text-lg text-white flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-black text-sm">A</span>
          Arc DApp
        </Link>
        {links.map(({ href, label }) => (
          <Link key={href} href={href}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              path === href ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}>{label}</Link>
        ))}
      </div>
    </nav>
  );
}
