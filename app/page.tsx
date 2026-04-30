import Link from "next/link";
const features = [
  { href: "/send",   icon: "📤", title: "Send",   color: "bg-blue-600",    desc: "Send USDC/EURC to another address on the same chain" },
  { href: "/bridge", icon: "🌉", title: "Bridge", color: "bg-purple-600",  desc: "Transfer USDC cross-chain via Circle CCTP" },
  { href: "/swap",   icon: "🔄", title: "Swap",   color: "bg-emerald-600", desc: "Exchange USDC ↔ EURC on the same chain" },
  { href: "/pool",   icon: "🏊", title: "Pool",   color: "bg-orange-600",  desc: "Add or remove liquidity from Arc pools" },
];
export default function Home() {
  return (
    <div className="py-8">
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-2xl font-black mx-auto mb-4">A</div>
        <h1 className="text-4xl font-bold text-white mb-3">Arc DApp</h1>
        <p className="text-gray-400 max-w-md mx-auto">Circle App Kit integration — Send · Bridge · Swap · Pool on Arc Network</p>
        <div className="mt-4 inline-block px-3 py-1 rounded-full bg-yellow-900/40 border border-yellow-700/50 text-yellow-400 text-sm">
          ⚠️ Testnet only — do not use real funds
        </div>
      </div>
      <div className="grid gap-4">
        {features.map(f => (
          <Link key={f.href} href={f.href} className="card hover:border-gray-600 transition-all hover:-translate-y-0.5 group">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl ${f.color} flex items-center justify-center text-2xl flex-shrink-0`}>{f.icon}</div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{f.title}</h2>
                <p className="text-gray-400 text-sm mt-0.5">{f.desc}</p>
              </div>
              <span className="text-gray-600 group-hover:text-blue-400 transition-colors">→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
