"use client";
import { useState, useRef, useEffect } from "react";

export interface SwapConfig {
  slippage: number;
  gasPriceMode: "low" | "normal" | "fast";
}

const GAS = [
  { key: "low"    as const, label: "Low",    gwei: 1,  desc: "~30s" },
  { key: "normal" as const, label: "Normal", gwei: 3,  desc: "~15s" },
  { key: "fast"   as const, label: "Fast",   gwei: 10, desc: "~5s"  },
];
const SLIPS = [0.1, 0.5, 1.0];

interface Props { config: SwapConfig; onChange: (c: SwapConfig) => void; }

export default function SwapSettings({ config, onChange }: Props) {
  const [open, setOpen]         = useState(false);
  const [customSlip, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const gas = GAS.find(g => g.key === config.gasPriceMode)!;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`p-2 rounded-lg border transition-colors ${open ? "bg-gray-700 border-gray-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
        title="Transaction Settings">⚙️</button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-4 space-y-5">
          <p className="font-semibold text-white text-sm">Transaction Settings</p>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-gray-300">Slippage Tolerance</span>
              <span className="text-sm font-bold text-blue-400">{config.slippage}%</span>
            </div>
            <div className="flex gap-2 mb-2">
              {SLIPS.map(p => (
                <button key={p} type="button"
                  onClick={() => { onChange({ ...config, slippage: p }); setCustom(""); }}
                  className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${config.slippage === p && !customSlip ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                  {p}%
                </button>
              ))}
            </div>
            <div className="relative">
              <input type="number" min="0.01" max="50" step="0.1" placeholder="Custom %" value={customSlip}
                onChange={e => { setCustom(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0 && v <= 50) onChange({ ...config, slippage: v }); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 pr-8" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
            </div>
            {config.slippage > 5 && <p className="text-yellow-400 text-xs mt-1">⚠️ High slippage — you may get a bad rate</p>}
          </div>

          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-gray-300">Transaction Speed</span>
              <span className="text-sm font-bold text-blue-400">{gas.gwei} Gwei</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {GAS.map(g => (
                <button key={g.key} type="button" onClick={() => onChange({ ...config, gasPriceMode: g.key })}
                  className={`py-2 rounded-xl text-center transition-colors ${config.gasPriceMode === g.key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
                  <div className="text-sm font-semibold">{g.label}</div>
                  <div className="text-xs opacity-70">{g.gwei} Gwei</div>
                  <div className="text-xs opacity-50">{g.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
