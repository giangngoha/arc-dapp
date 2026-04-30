"use client";
import { useState } from "react";
import TokenSelector, { type TokenInfo } from "@/components/TokenSelector";

// ── mock pool data (replace with Arc Pool SDK when available) ──
const EXISTING_POOLS = [
  { id: "1", pair: "USDC / EURC", tokenA: "USDC", tokenB: "EURC", tvl: "$2.4M", apy: "4.2%", vol24h: "$180K", myLiquidity: null },
  { id: "2", pair: "USDC / ETH",  tokenA: "USDC", tokenB: "ETH",  tvl: "$1.1M", apy: "6.8%", vol24h: "$340K", myLiquidity: null },
  { id: "3", pair: "EURC / ETH",  tokenA: "EURC", tokenB: "ETH",  tvl: "$540K", apy: "5.1%", vol24h: "$90K",  myLiquidity: null },
];

type Tab = "pools" | "create" | "add" | "remove";
type FeeOption = "0.05" | "0.30" | "1.00";

const FEE_TIERS: { value: FeeOption; label: string; desc: string }[] = [
  { value: "0.05", label: "0.05%", desc: "Best for stable pairs" },
  { value: "0.30", label: "0.30%", desc: "Best for most pairs"  },
  { value: "1.00", label: "1.00%", desc: "Best for exotic pairs" },
];

export default function PoolPage() {
  const [tab,        setTab]        = useState<Tab>("pools");
  const [msg,        setMsg]        = useState<{ ok: boolean; text: string } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [pct,        setPct]        = useState(50);
  const [selectedPool, setSelectedPool] = useState<string | null>(null);

  // Create pool state
  const [createA,  setCreateA]  = useState<TokenInfo>({ symbol: "USDC", name: "USD Coin" });
  const [createB,  setCreateB]  = useState<TokenInfo>({ symbol: "EURC", name: "Euro Coin" });
  const [feeTier,  setFeeTier]  = useState<FeeOption>("0.30");
  const [initPrice,setInitPrice]= useState("");

  // Add liquidity state
  const [addA,  setAddA]  = useState<TokenInfo>({ symbol: "USDC" });
  const [addB,  setAddB]  = useState<TokenInfo>({ symbol: "EURC" });
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  async function simulate(action: string) {
    setLoading(true); setMsg(null);
    await new Promise(r => setTimeout(r, 1500));
    setMsg({ ok: true, text: `✅ ${action} submitted (demo — Arc Pool SDK integration pending)` });
    setLoading(false);
  }

  function openAdd(poolId: string) {
    const pool = EXISTING_POOLS.find(p => p.id === poolId);
    if (pool) {
      setAddA({ symbol: pool.tokenA });
      setAddB({ symbol: pool.tokenB });
    }
    setSelectedPool(poolId);
    setTab("add");
    setMsg(null);
  }

  function openRemove(poolId: string) {
    setSelectedPool(poolId);
    setTab("remove");
    setMsg(null);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-xl">🏊</span>
        <div>
          <h1 className="text-2xl font-bold text-white">Liquidity Pool</h1>
          <p className="text-gray-500 text-sm">⚠️ Testnet only — do not use real funds</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 p-1 rounded-xl border border-gray-800">
        {([
          { key: "pools",  label: "🏊 All Pools"      },
          { key: "create", label: "✨ Create Pool"    },
          { key: "add",    label: "➕ Add Liquidity"  },
          { key: "remove", label: "➖ Remove"          },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button key={key} type="button" onClick={() => { setTab(key); setMsg(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${tab === key ? "bg-orange-600 text-white" : "text-gray-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── ALL POOLS ── */}
      {tab === "pools" && (
        <div className="space-y-3">
          {EXISTING_POOLS.map(pool => (
            <div key={pool.id} className="card hover:border-gray-600 transition-colors">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-white">{pool.pair}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
                    <span>TVL {pool.tvl}</span>
                    <span>·</span>
                    <span>24h Vol {pool.vol24h}</span>
                  </div>
                </div>
                <span className="text-emerald-400 font-bold text-lg">{pool.apy} APY</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openAdd(pool.id)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-orange-600/20 border border-orange-700 text-orange-300 hover:bg-orange-600/30 transition-colors">
                  ➕ Add
                </button>
                <button onClick={() => openRemove(pool.id)}
                  className="flex-1 py-2 rounded-lg text-sm font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 transition-colors">
                  ➖ Remove
                </button>
              </div>
            </div>
          ))}

          <button onClick={() => { setTab("create"); setMsg(null); }}
            className="w-full py-3 rounded-xl border border-dashed border-orange-700 text-orange-400 hover:bg-orange-900/20 transition-colors text-sm font-medium">
            ✨ Create a new pool
          </button>
          <p className="text-center text-gray-700 text-xs">Pool data is illustrative — live data requires Arc Pool SDK</p>
        </div>
      )}

      {/* ── CREATE POOL ── */}
      {tab === "create" && (
        <div className="card space-y-5">
          <div>
            <h2 className="font-semibold text-white mb-1">Select Token Pair</h2>
            <p className="text-xs text-gray-500 mb-4">Choose two tokens to create a new liquidity pool</p>

            <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-end">
              <TokenSelector label="Token A" name="createTokenA" value={createA} onChange={setCreateA} />
              <div className="pb-0 flex items-end justify-center">
                <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm">+</div>
              </div>
              <TokenSelector label="Token B" name="createTokenB" value={createB} onChange={setCreateB} />
            </div>
          </div>

          {/* Fee tier */}
          <div>
            <h2 className="font-semibold text-white mb-1">Fee Tier</h2>
            <p className="text-xs text-gray-500 mb-3">How much LPs earn on each trade</p>
            <div className="grid grid-cols-3 gap-2">
              {FEE_TIERS.map(f => (
                <button key={f.value} type="button" onClick={() => setFeeTier(f.value)}
                  className={`p-3 rounded-xl border text-center transition-colors ${
                    feeTier === f.value
                      ? "border-orange-500 bg-orange-900/30 text-white"
                      : "border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500"
                  }`}>
                  <div className="font-bold text-sm">{f.label}</div>
                  <div className="text-xs mt-0.5 opacity-70">{f.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Initial price */}
          <div>
            <h2 className="font-semibold text-white mb-1">Initial Price</h2>
            <p className="text-xs text-gray-500 mb-2">Set the starting price for this pair</p>
            <div className="relative">
              <input type="number" placeholder="e.g. 1.08" step="0.0001" min="0.0001"
                value={initPrice} onChange={e => setInitPrice(e.target.value)}
                className="input-field pr-36" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-xs">
                {createB.symbol} per {createA.symbol}
              </span>
            </div>
          </div>

          {/* Initial deposit */}
          <div>
            <h2 className="font-semibold text-white mb-3">Initial Deposit</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ({createA.symbol})</label>
                <input type="number" placeholder="0.00" step="0.01" min="0.01" className="input-field" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ({createB.symbol})</label>
                <input type="number" placeholder="0.00" step="0.01" min="0.01" className="input-field" />
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-4 text-sm space-y-2">
            <div className="flex justify-between text-gray-400">
              <span>Pool</span>
              <span className="text-white font-medium">{createA.symbol} / {createB.symbol}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Fee tier</span>
              <span className="text-white font-medium">{feeTier}%</span>
            </div>
            {initPrice && (
              <div className="flex justify-between text-gray-400">
                <span>Initial price</span>
                <span className="text-white font-medium">1 {createA.symbol} = {initPrice} {createB.symbol}</span>
              </div>
            )}
          </div>

          <button type="button" disabled={loading || !initPrice}
            onClick={() => simulate(`Pool ${createA.symbol}/${createB.symbol} (${feeTier}% fee) creation`)}
            className="w-full py-3 rounded-xl font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-40 transition-colors">
            {loading ? "⏳ Creating pool..." : "✨ Create Pool"}
          </button>

          {msg && (
            <div className={`rounded-xl border p-4 ${msg.ok ? "border-green-800 bg-green-950/30" : "border-red-800 bg-red-950/30"}`}>
              <p className={msg.ok ? "text-green-400" : "text-red-400"}>{msg.text}</p>
            </div>
          )}
        </div>
      )}

      {/* ── ADD LIQUIDITY ── */}
      {tab === "add" && (
        <div className="card space-y-5">
          {selectedPool && (
            <div className="rounded-xl bg-blue-950/30 border border-blue-800 px-4 py-2 text-sm text-blue-300">
              Adding to: <strong>{EXISTING_POOLS.find(p => p.id === selectedPool)?.pair ?? "Selected Pool"}</strong>
            </div>
          )}

          <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-end">
            <TokenSelector label="Token A" name="addTokenA" value={addA} onChange={setAddA} />
            <div className="flex items-end justify-center">
              <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-sm">+</div>
            </div>
            <TokenSelector label="Token B" name="addTokenB" value={addB} onChange={setAddB} />
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ({addA.symbol})</label>
              <input type="number" placeholder="0.00" step="0.01" min="0.01" className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Amount ({addB.symbol})</label>
              <input type="number" placeholder="0.00" step="0.01" min="0.01" className="input-field" />
            </div>
          </div>

          {/* Price range */}
          <div>
            <h2 className="font-semibold text-white mb-1">Price Range</h2>
            <p className="text-xs text-gray-500 mb-3">Set the range where your liquidity is active</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Min Price</label>
                <div className="relative">
                  <input type="number" placeholder="0.00" step="0.0001"
                    value={priceMin} onChange={e => setPriceMin(e.target.value)}
                    className="input-field pr-20 text-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs">{addB.symbol}/{addA.symbol}</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Max Price</label>
                <div className="relative">
                  <input type="number" placeholder="∞" step="0.0001"
                    value={priceMax} onChange={e => setPriceMax(e.target.value)}
                    className="input-field pr-20 text-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 text-xs">{addB.symbol}/{addA.symbol}</span>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => { setPriceMin("0"); setPriceMax("999999"); }}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300">
              Use full range →
            </button>
          </div>

          <button type="button" disabled={loading}
            onClick={() => simulate("Add Liquidity")}
            className="w-full py-3 rounded-xl font-semibold text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-40 transition-colors">
            {loading ? "⏳ Adding..." : "➕ Add Liquidity"}
          </button>

          {msg && (
            <div className={`rounded-xl border p-4 ${msg.ok ? "border-green-800 bg-green-950/30" : "border-red-800 bg-red-950/30"}`}>
              <p className={msg.ok ? "text-green-400" : "text-red-400"}>{msg.text}</p>
            </div>
          )}
        </div>
      )}

      {/* ── REMOVE LIQUIDITY ── */}
      {tab === "remove" && (
        <div className="card space-y-5">
          {selectedPool && (
            <div className="rounded-xl bg-blue-950/30 border border-blue-800 px-4 py-2 text-sm text-blue-300">
              Removing from: <strong>{EXISTING_POOLS.find(p => p.id === selectedPool)?.pair ?? "Selected Pool"}</strong>
            </div>
          )}

          <div>
            <div className="flex justify-between mb-3">
              <h2 className="font-semibold text-white">Amount to Remove</h2>
              <span className="text-orange-400 font-bold text-xl">{pct}%</span>
            </div>

            <input type="range" min="1" max="100" value={pct}
              onChange={e => setPct(Number(e.target.value))}
              className="w-full accent-orange-500 mb-3" />

            {/* Quick % buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map(v => (
                <button key={v} type="button" onClick={() => setPct(v)}
                  className={`py-2 rounded-xl text-sm font-medium transition-colors ${pct === v ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  {v}%
                </button>
              ))}
            </div>
          </div>

          {/* Estimated return */}
          <div className="rounded-xl bg-gray-800/50 border border-gray-700 p-4 space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">You will receive (estimated)</p>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">USDC</span>
              <span className="text-white font-medium">~ {(pct * 0.24).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">EURC</span>
              <span className="text-white font-medium">~ {(pct * 0.22).toFixed(2)}</span>
            </div>
          </div>

          <button type="button" disabled={loading}
            onClick={() => simulate(`Remove ${pct}% Liquidity`)}
            className="w-full py-3 rounded-xl font-semibold text-white bg-red-700 hover:bg-red-600 disabled:opacity-40 transition-colors">
            {loading ? "⏳ Removing..." : `➖ Remove ${pct}% Liquidity`}
          </button>

          {msg && (
            <div className={`rounded-xl border p-4 ${msg.ok ? "border-green-800 bg-green-950/30" : "border-red-800 bg-red-950/30"}`}>
              <p className={msg.ok ? "text-green-400" : "text-red-400"}>{msg.text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
