"use client";
import { useState } from "react";
import { bridgeTokens, estimateBridge } from "./actions";
import ResultBox from "@/components/ResultBox";

const CHAINS = [
  { id: "Arc_Testnet",      label: "Arc Testnet"      },
  { id: "Ethereum_Sepolia", label: "Ethereum Sepolia" },
  { id: "Avalanche_Fuji",   label: "Avalanche Fuji"   },
];

export default function BridgePage() {
  const [loading,    setLoading]    = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [result,     setResult]     = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [estimate,   setEstimate]   = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [fromChain,  setFromChain]  = useState("Ethereum_Sepolia");
  const [toChain,    setToChain]    = useState("Arc_Testnet");

  function fd(amount: string) {
    const f = new FormData(); f.set("fromChain", fromChain); f.set("toChain", toChain); f.set("amount", amount); return f;
  }
  const getAmt = () => (document.querySelector<HTMLInputElement>('input[name="amount"]'))?.value ?? "";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center text-xl">🌉</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Bridge Tokens</h1>
          <p className="text-gray-500 text-sm">⚠️ Testnet only — do not use real funds</p>
        </div>
      </div>
      <div className="card">
        <form onSubmit={async e => { e.preventDefault(); setLoading(true); setResult(null); setResult(await bridgeTokens(fd(getAmt()))); setLoading(false); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">From</label>
            <select className="select-field" value={fromChain} onChange={e => setFromChain(e.target.value)}>
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="flex justify-center">
            <button type="button" onClick={() => { setFromChain(toChain); setToChain(fromChain); }}
              className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white text-sm transition-colors">
              ⇅ Swap direction
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">To</label>
            <select className="select-field" value={toChain} onChange={e => setToChain(e.target.value)}>
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount (USDC)</label>
            <div className="relative">
              <input type="number" name="amount" placeholder="0.00" step="0.01" min="0.01" className="input-field pr-16" required />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">USDC</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={estimating}
              onClick={async () => { setEstimating(true); setEstimate(null); setEstimate(await estimateBridge(fd(getAmt()))); setEstimating(false); }}
              className="py-3 rounded-xl font-semibold text-sm border border-purple-700 text-purple-300 hover:bg-purple-900/30 transition-colors disabled:opacity-40">
              {estimating ? "⏳ Estimating..." : "💰 Estimate Fee"}
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "⏳ Bridging..." : "Bridge →"}
            </button>
          </div>
        </form>
      </div>
      {estimate && (
        <div className={`mt-4 rounded-xl border p-4 ${estimate.success ? "border-purple-800 bg-purple-950/20" : "border-red-800 bg-red-950/20"}`}>
          <p className="text-sm font-semibold text-purple-300 mb-2">💰 Fee Estimate</p>
          <pre className="text-xs text-gray-300 overflow-auto">{JSON.stringify(estimate.data ?? estimate.error, null, 2)}</pre>
        </div>
      )}
      <ResultBox result={result} />
    </div>
  );
}
