"use client";
import { useState, useRef, useEffect } from "react";

export interface TokenInfo {
  symbol: string;
  name?: string;
  address?: string;
  isCustom?: boolean;
  isVerified?: boolean;
}

const PRESETS: TokenInfo[] = [
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "EURC", name: "Euro Coin" },
];

// Arc Testnet = Blockscout instance
const EXPLORER = "https://testnet.arcscan.app";

interface Props {
  label: string;
  value: TokenInfo;
  onChange: (t: TokenInfo) => void;
  name: string;
}

export default function TokenSelector({ label, value, onChange, name }: Props) {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState<TokenInfo | null>(null);
  const [error,   setError]   = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

  async function fetchFromExplorer(addr: string) {
    setLoading(true); setError(""); setFetched(null);
    try {
      // Blockscout API v2: GET /api/v2/tokens/{address}
      const res  = await fetch(`${EXPLORER}/api/v2/tokens/${addr}`);
      if (!res.ok) throw new Error(`Explorer returned ${res.status}`);
      const data = await res.json() as {
        symbol?: string;
        name?: string;
        address?: string;
        is_verified_via_admin_panel?: boolean;
        verified_via_eth_bytecode_db?: boolean;
      };

      const symbol     = data.symbol ?? addr.slice(0,6) + "..." + addr.slice(-4);
      const name       = data.name   ?? "";
      const isVerified = !!(data.is_verified_via_admin_panel || data.verified_via_eth_bytecode_db);

      setFetched({ symbol, name, address: addr, isCustom: true, isVerified });
    } catch (err) {
      // Fallback: RPC call cho symbol()
      try {
        const rpcRes  = await fetch("https://rpc.testnet.arc.network", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc:"2.0", id:1, method:"eth_call",
            params:[{ to: addr, data:"0x95d89b41" }, "latest"] }),
        });
        const rpcData = await rpcRes.json() as { result: string };
        const symbol  = parseAbiString(rpcData.result) || addr.slice(0,6)+"..."+addr.slice(-4);
        setFetched({ symbol, address: addr, isCustom: true, isVerified: false });
      } catch {
        setError("Token not found on Arc Testnet Explorer.");
      }
    }
    setLoading(false);
  }

  function parseAbiString(hex: string): string {
    try {
      if (!hex || hex === "0x") return "";
      const raw  = hex.slice(2);
      const len  = parseInt(raw.slice(64, 128), 16);
      const str  = raw.slice(128, 128 + len * 2);
      return Buffer.from(str, "hex").toString("utf8").replace(/\0/g, "");
    } catch { return ""; }
  }

  function handleInput(v: string) {
    setInput(v); setFetched(null); setError("");
    if (isAddr(v)) fetchFromExplorer(v.trim());
  }

  function select(t: TokenInfo) {
    onChange(t); setOpen(false); setInput(""); setFetched(null); setError("");
  }

  const displayLabel = value.isCustom
    ? `${value.symbol}${value.name ? ` · ${value.name}` : ""}`
    : value.symbol;

  const filtered = PRESETS.filter(
    t => !input || t.symbol.toLowerCase().includes(input.toLowerCase())
  );

  return (
    <div className="relative" ref={ref}>
      <input type="hidden" name={name} value={value.isCustom ? (value.address ?? "") : value.symbol} />

      <label className="block text-sm font-medium text-gray-300 mb-1.5">{label}</label>

      <button type="button" onClick={() => setOpen(o => !o)}
        className="token-pill w-full justify-between">
        <span className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold">
            {value.symbol.slice(0,2)}
          </span>
          <span className="font-medium text-white text-sm truncate">{displayLabel}</span>
          {value.isVerified && <span className="text-green-400 text-xs">✓</span>}
        </span>
        <span className="text-gray-500 text-xs flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-full bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-gray-800">
            <input type="text" autoFocus
              placeholder="Search or paste contract address (0x…)"
              value={input} onChange={e => handleInput(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500" />
          </div>

          {/* Preset list */}
          {filtered.length > 0 && (
            <div className="p-2">
              <p className="text-xs text-gray-600 px-2 py-1 uppercase tracking-wide">Common tokens</p>
              {filtered.map(t => (
                <button key={t.symbol} type="button" onClick={() => select(t)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
                  <span className="w-8 h-8 rounded-full bg-blue-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {t.symbol.slice(0,2)}
                  </span>
                  <div className="text-left">
                    <p className="font-medium text-white text-sm">{t.symbol}</p>
                    <p className="text-xs text-gray-500">{t.name}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Custom contract result */}
          {isAddr(input) && (
            <div className="border-t border-gray-800 p-3">
              {loading && (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                  <span className="animate-spin">⏳</span>
                  Looking up on Arc Explorer…
                </div>
              )}
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {fetched && (
                <button type="button" onClick={() => select(fetched)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors">
                  <span className="w-8 h-8 rounded-full bg-purple-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                    {fetched.symbol.slice(0,2)}
                  </span>
                  <div className="text-left flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white text-sm">{fetched.symbol}</p>
                      {fetched.isVerified
                        ? <span className="text-xs text-green-400 bg-green-900/40 px-2 py-0.5 rounded-full">Verified ✓</span>
                        : <span className="text-xs text-yellow-500 bg-yellow-900/30 px-2 py-0.5 rounded-full">Unverified</span>}
                    </div>
                    {fetched.name && <p className="text-xs text-gray-400">{fetched.name}</p>}
                    <p className="text-xs text-gray-600 font-mono mt-0.5">{input.slice(0,10)}…{input.slice(-6)}</p>
                  </div>
                  <a href={`${EXPLORER}/token/${input}`} target="_blank" rel="noopener noreferrer"
                     onClick={e => e.stopPropagation()}
                     className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">
                    Explorer ↗
                  </a>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
