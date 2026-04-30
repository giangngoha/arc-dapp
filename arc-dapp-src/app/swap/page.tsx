"use client";
import { useState } from "react";
import { swapTokens, estimateSwapRate } from "./actions";
import ResultBox from "@/components/ResultBox";
import TokenSelector, { type TokenInfo } from "@/components/TokenSelector";
import SwapSettings, { type SwapConfig } from "@/components/SwapSettings";

export default function SwapPage() {
  const [loading,    setLoading]    = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [result,     setResult]     = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [estimate,   setEstimate]   = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [tokenIn,    setTokenIn]    = useState<TokenInfo>({ symbol: "USDC" });
  const [tokenOut,   setTokenOut]   = useState<TokenInfo>({ symbol: "EURC" });
  const [settings,   setSettings]   = useState<SwapConfig>({ slippage: 0.5, gasPriceMode: "normal" });

  function fd(amount: string) {
    const f = new FormData();
    f.set("chain",    "Arc_Testnet");
    f.set("tokenIn",  tokenIn.isCustom  ? (tokenIn.address  ?? tokenIn.symbol)  : tokenIn.symbol);
    f.set("tokenOut", tokenOut.isCustom ? (tokenOut.address ?? tokenOut.symbol) : tokenOut.symbol);
    f.set("amountIn", amount);
    f.set("slippage", String(settings.slippage));
    f.set("gasMode",  settings.gasPriceMode);
    return f;
  }
  const getAmt = () => (document.querySelector<HTMLInputElement>('input[name="amountIn"]'))?.value ?? "";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-xl">🔄</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Swap Tokens</h1>
          <p className="text-gray-500 text-sm">⚠️ Testnet only — do not use real funds</p>
        </div>
      </div>
      <div className="card">
        <form onSubmit={async e => { e.preventDefault(); setLoading(true); setResult(null); setResult(await swapTokens(fd(new FormData(e.currentTarget).get("amountIn") as string))); setLoading(false); }} className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Arc Testnet</span>
            <SwapSettings config={settings} onChange={setSettings} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400">Slippage: {settings.slippage}%</span>
            <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-400">Gas: {settings.gasPriceMode} ({settings.gasPriceMode === "low" ? 1 : settings.gasPriceMode === "normal" ? 3 : 10} Gwei)</span>
          </div>
          <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-end">
            <TokenSelector label="You sell" name="tokenIn" value={tokenIn} onChange={setTokenIn} />
            <button type="button" onClick={() => { setTokenIn(tokenOut); setTokenOut(tokenIn); }}
              className="p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white transition-colors">⇄</button>
            <TokenSelector label="You receive" name="tokenOut" value={tokenOut} onChange={setTokenOut} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ({tokenIn.symbol})</label>
            <div className="relative">
              <input type="number" name="amountIn" placeholder="0.00" step="0.01" min="0.01" className="input-field pr-20" required />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{tokenIn.symbol}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={estimating} onClick={async () => { setEstimating(true); setEstimate(null); setEstimate(await estimateSwapRate(fd(getAmt()))); setEstimating(false); }}
              className="py-3 rounded-xl font-semibold text-sm border border-emerald-700 text-emerald-300 hover:bg-emerald-900/30 transition-colors disabled:opacity-40">
              {estimating ? "⏳ Estimating..." : "📊 Get Rate"}
            </button>
            <button type="submit" disabled={loading}
              className="py-3 rounded-xl font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 transition-colors">
              {loading ? "⏳ Swapping..." : "Swap →"}
            </button>
          </div>
        </form>
      </div>
      {estimate && (
        <div className={`mt-4 rounded-xl border p-4 ${estimate.success ? "border-emerald-800 bg-emerald-950/20" : "border-red-800 bg-red-950/20"}`}>
          <p className="text-sm font-semibold text-emerald-300 mb-2">📊 Rate Estimate</p>
          <pre className="text-xs text-gray-300 overflow-auto">{JSON.stringify(estimate.data ?? estimate.error, null, 2)}</pre>
        </div>
      )}
      <ResultBox result={result} />
    </div>
  );
}
