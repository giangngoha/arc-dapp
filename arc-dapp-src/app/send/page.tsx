"use client";
import { useState } from "react";
import { sendTokens } from "./actions";
import ResultBox from "@/components/ResultBox";
import TokenSelector, { type TokenInfo } from "@/components/TokenSelector";

const CHAINS = [
  { id: "Arc_Testnet",      label: "Arc Testnet"      },
  { id: "Ethereum_Sepolia", label: "Ethereum Sepolia" },
  { id: "Avalanche_Fuji",   label: "Avalanche Fuji"   },
];

export default function SendPage() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [token,   setToken]   = useState<TokenInfo>({ symbol: "USDC" });

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setResult(null);
    const res = await sendTokens(new FormData(e.currentTarget));
    setResult(res); setLoading(false);
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-xl">📤</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Send Tokens</h1>
          <p className="text-gray-500 text-sm">⚠️ Testnet only — do not use real funds</p>
        </div>
      </div>
      <div className="card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Network</label>
            <select name="chain" className="select-field" defaultValue="Arc_Testnet">
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <TokenSelector label="Token" name="token" value={token} onChange={setToken} />
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Recipient Address</label>
            <input type="text" name="recipient" placeholder="0x..." className="input-field font-mono text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount</label>
            <div className="relative">
              <input type="number" name="amount" placeholder="0.00" step="0.01" min="0.01" className="input-field pr-20" required />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{token.symbol}</span>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "⏳ Sending..." : "Send →"}
          </button>
        </form>
      </div>
      <ResultBox result={result} />
    </div>
  );
}
