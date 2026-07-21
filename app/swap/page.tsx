"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_RPC, ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

const ROUTER   = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const PAIR     = "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb";
const USDC     = CONTRACTS.USDC;
const EURC     = CONTRACTS.EURC;
const cirBTC   = CONTRACTS.cirBTC;
// Large approval: 1 billion tokens per decimals.
// Avoids MAX_U256 which MetaMask misidentifies as an NFT setApprovalForAll call.
function makeLargeApproval(decimals: number): bigint {
  return BigInt(1_000_000_000) * BigInt(10 ** decimals);
}
// Safely parse an allowance RPC result — returns 0n on null/empty/error
function safeAllowance(raw: unknown): bigint {
  try {
    if (!raw || raw === "0x" || raw === "0x0") return 0n;
    return BigInt(raw as string);
  } catch { return 0n; }
}
const GAS_APPROVE = "0x186A0";
const GAS_SWAP    = "0x493E0";

const BASE_TOKENS = ["USDC", "EURC", "cirBTC"] as const;
type BaseToken = typeof BASE_TOKENS[number];

interface CustomToken { sym: string; addr: string; decimals: number; color: string; label: string; }
type TokenSym = BaseToken | string;

const DEFAULT_TOKEN_META: Record<string, { color: string; bg: string; label: string; decimals: number }> = {
  USDC:   { color: "#2775CA", bg: "rgba(39,117,202,0.15)",  label: "USD Coin",       decimals: 6 },
  EURC:   { color: "#2B5EDD", bg: "rgba(43,94,221,0.15)",   label: "Euro Coin",       decimals: 6 },
  cirBTC: { color: "#F7931A", bg: "rgba(247,147,26,0.15)",  label: "Circle Bitcoin",  decimals: 8 },
};

// Generate a deterministic color from token address
function addrColor(addr: string): string {
  const n = parseInt(addr.slice(2, 8), 16);
  const h = n % 360;
  return `hsl(${h}, 65%, 50%)`;
}

// Static route map — used as fallback and for building candidate paths.
// Direct paths (2 tokens) are always tried first; multi-hop only used when better.
const ROUTES: Record<string, string[]> = {
  "USDC-EURC":   [USDC, EURC],
  "EURC-USDC":   [EURC, USDC],
  "USDC-cirBTC": [USDC, cirBTC],
  "cirBTC-USDC": [cirBTC, USDC],
  "EURC-cirBTC": [EURC, USDC, cirBTC],
  "cirBTC-EURC": [cirBTC, USDC, EURC],
};

// All possible intermediate tokens for building candidate multi-hop paths.
const HOP_TOKENS = [USDC, EURC, cirBTC];

// Find the best swap path for a given tokenIn → tokenOut and amountIn.
// Queries all candidate paths (direct + all 1-hop intermediates) in parallel
// and returns the path that yields the highest amountOut.
// Falls back to the static ROUTES entry if all on-chain queries fail.
async function findBestPath(
  tokenInAddr: string,
  tokenOutAddr: string,
  amtInRaw: bigint,
  staticPath: string[],
): Promise<{ path: string[]; amtOutRaw: bigint; isOptimal: boolean }> {
  // Build candidate paths: direct + via each intermediate token
  const candidates: string[][] = [];

  // Direct path (only if different tokens)
  if (tokenInAddr.toLowerCase() !== tokenOutAddr.toLowerCase()) {
    candidates.push([tokenInAddr, tokenOutAddr]);
  }

  // Single-hop paths via each intermediate
  for (const hop of HOP_TOKENS) {
    const h = hop.toLowerCase();
    const inL = tokenInAddr.toLowerCase();
    const outL = tokenOutAddr.toLowerCase();
    if (h !== inL && h !== outL) {
      candidates.push([tokenInAddr, hop, tokenOutAddr]);
    }
  }

  // Deduplicate candidates (avoid querying the same path twice)
  const seen = new Set<string>();
  const unique = candidates.filter(p => {
    const key = p.map(a => a.toLowerCase()).join("-");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Query all candidate paths in parallel
  const results = await Promise.all(
    unique.map(async (path) => {
      try {
        const data = encodeGetAmountsOut(amtInRaw, path);
        const r: any = await rpcCall("eth_call", [{ to: ROUTER, data }, "latest"]);
        if (!r || r === "0x") return null;
        const hex = r.replace("0x", "");
        const lastIdx = 128 + (path.length - 1) * 64;
        if (hex.length < lastIdx + 64) return null;
        const amtOutRaw = BigInt("0x" + hex.slice(lastIdx, lastIdx + 64));
        return { path, amtOutRaw };
      } catch {
        return null;
      }
    })
  );

  // Pick the path with the highest amountOut
  let best: { path: string[]; amtOutRaw: bigint } | null = null;
  for (const r of results) {
    if (!r) continue;
    if (!best || r.amtOutRaw > best.amtOutRaw) best = r;
  }

  if (!best) {
    // All queries failed — fall back to static route without an amountOut estimate
    return { path: staticPath, amtOutRaw: 0n, isOptimal: false };
  }

  return { path: best.path, amtOutRaw: best.amtOutRaw, isOptimal: true };
}

function encodeGetAmountsOut(amtIn: bigint, path: string[]): string {
  const sel    = "0xd06ca61f";
  const offset = (64).toString(16).padStart(64, "0");
  const len    = path.length.toString(16).padStart(64, "0");
  const addrs  = path.map(a => a.toLowerCase().replace("0x","").padStart(64,"0")).join("");
  return sel + amtIn.toString(16).padStart(64,"0") + offset + len + addrs;
}

function encodeSwap(amtIn: bigint, amtOutMin: bigint, path: string[], to: string, deadline: bigint): string {
  const sel     = "0x38ed1739";
  const pathOff = (5*32).toString(16).padStart(64,"0");
  const len     = path.length.toString(16).padStart(64,"0");
  const addrs   = path.map(a => a.toLowerCase().replace("0x","").padStart(64,"0")).join("");
  return sel + amtIn.toString(16).padStart(64,"0") + amtOutMin.toString(16).padStart(64,"0") + pathOff + to.toLowerCase().replace("0x","").padStart(64,"0") + deadline.toString(16).padStart(64,"0") + len + addrs;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ARC_RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc:"2.0", id:1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}

async function switchToArc() {
  const eth = (window as any).ethereum;
  const hex = "0x4cef52";
  let cur: string | undefined;
  try { cur = await eth.request({ method:"eth_chainId" }); } catch {}
  if (cur?.toLowerCase() === hex) return;
  try { await eth.request({ method:"wallet_switchEthereumChain", params:[{ chainId:hex }] }); }
  catch (e: any) {
    if (e.code===4902) await eth.request({ method:"wallet_addEthereumChain", params:[{ chainId:hex, chainName:"Arc Network Testnet", nativeCurrency:{ name:"USDC", symbol:"USDC", decimals:18 }, rpcUrls:[ARC_RPC], blockExplorerUrls:["https://testnet.arcscan.app"] }] });
    else throw e;
  }
  for (let i=0; i<20; i++) {
    await new Promise(r=>setTimeout(r,400));
    try { const c = await eth.request({ method:"eth_chainId" }); if(c?.toLowerCase()===hex) return; } catch {}
  }
}

async function waitTx(hash: string, maxMs=90000): Promise<boolean> {
  const start = Date.now();
  while (Date.now()-start < maxMs) {
    await new Promise(r=>setTimeout(r,3000));
    try {
      const r: any = await rpcCall("eth_getTransactionReceipt",[hash]);
      if (r?.blockNumber) return r.status==="0x1"||r.status===1;
    } catch {}
  }
  return false;
}

// ── Token Icon ────────────────────────────────────────────────────────────────
function TokenIcon({ sym, size=28, meta }: { sym: string; size?: number; meta?: Record<string,{color:string}> }) {
  const m = (meta ?? DEFAULT_TOKEN_META)[sym];
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:m?.color ?? "#888", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.38, fontWeight:800, color:"#fff", flexShrink:0, letterSpacing:"-0.5px" }}>
      {sym === "cirBTC" ? "₿" : sym.slice(0,2)}
    </div>
  );
}

// ── Token Selector dropdown ───────────────────────────────────────────────────
// Each selector manages its own open state — avoids event conflict with document listeners
function TokenSelector({ sym, onChange, active, closeOther, registerClose, tokenMeta, allTokens }: {
  sym: string; onChange: (s: TokenSym)=>void; active?: boolean;
  closeOther: ()=>void; registerClose: (fn: ()=>void)=>void;
  tokenMeta: Record<string,{color:string;bg:string;label:string;decimals:number}>;
  allTokens: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const m = tokenMeta[sym];
  const options = allTokens.filter(t => t !== sym);

  // Register close function so parent can close this dropdown
  useEffect(()=>{ registerClose(()=>setOpen(false)); },[]);

  // Close on outside click
  useEffect(()=>{
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  },[open]);

  function toggle() {
    if (!open) closeOther(); // close the other selector first
    setOpen(o=>!o);
  }

  return (
    <div ref={ref} style={{ position:"relative", flexShrink:0 }}>
      <button type="button" onClick={toggle}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 10px 8px 8px", borderRadius:40, border:`1.5px solid ${open||active ? m?.color : "var(--border)"}`, background:open||active ? m?.bg : "var(--bg3)", cursor:"pointer", transition:"all 0.15s" }}>
        <TokenIcon sym={sym} size={22} />
        <span style={{ fontWeight:800, fontSize:14, color:"var(--text0)" }}>{sym}</span>
        <span style={{ fontSize:9, color:"var(--text2)" }}>▾</span>
      </button>
      {open && (
        <div style={{ position:"absolute", right:0, top:"calc(100% + 6px)", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:12, overflow:"hidden", zIndex:50, minWidth:160, boxShadow:"0 8px 24px rgba(0,0,0,0.4)" }}>
          {options.map((t, i) => (
            <button key={t} type="button"
              onClick={()=>{ onChange(t); setOpen(false); }}
              style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"11px 14px", background:"transparent", border:"none", borderBottom: i < options.length-1 ? "1px solid var(--border)" : "none", cursor:"pointer", transition:"background 0.1s" }}
              onMouseEnter={e=>(e.currentTarget.style.background="var(--bg2)")}
              onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
              <TokenIcon sym={t} size={22} meta={tokenMeta}/>
              <div style={{ textAlign:"left" }}>
                <div style={{ fontWeight:700, fontSize:13, color:"var(--text0)" }}>{t}</div>
                <div style={{ fontSize:11, color:"var(--text2)" }}>{tokenMeta[t]?.label ?? t}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add Custom Token Modal ────────────────────────────────────────────────────
function AddTokenModal({ onClose, onAdd, tokenMeta }: {
  onClose: ()=>void;
  onAdd: (t: CustomToken)=>void;
  tokenMeta: Record<string, { color:string; bg:string; label:string; decimals:number }>;
}) {
  const [addr,    setAddr]    = useState("");
  const [sym,     setSym]     = useState("");
  const [decimals,setDec]     = useState("");
  const [name,    setName]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function lookup() {
    if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) { setError("Invalid contract address"); return; }
    setLoading(true); setError("");
    try {
      function pad(v: string) { return v.toLowerCase().replace("0x","").padStart(64,"0"); }
      async function call(data: string) {
        const r = await fetch(ARC_RPC, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:addr,data},"latest"]}),
        });
        return (await r.json()).result ?? null;
      }
      // symbol() → bytes32 or string
      const symRaw = await call("0x95d89b41");
      // decimals() → uint8
      const decRaw = await call("0x313ce567");
      // name() → string
      const nameRaw = await call("0x06fdde03");

      if (!symRaw || symRaw === "0x") { setError("Not a valid ERC-20 on Arc Testnet"); return; }

      // Decode symbol (may be bytes32 or ABI-encoded string)
      let symDecoded = "";
      try {
        const hex = symRaw.replace("0x","");
        if (hex.length === 64) {
          // bytes32 fixed
          symDecoded = Buffer.from(hex.replace(/00+$/, ""), "hex").toString("utf8").replace(/ /g,"");
        } else {
          // ABI string: offset(32) + length(32) + data
          const len = parseInt(hex.slice(64,128), 16);
          symDecoded = Buffer.from(hex.slice(128, 128 + len*2), "hex").toString("utf8");
        }
      } catch { symDecoded = "???"; }

      // Decode name
      let nameDecoded = symDecoded;
      try {
        const hex = (nameRaw??"").replace("0x","");
        if (hex.length > 128) {
          const len = parseInt(hex.slice(64,128), 16);
          nameDecoded = Buffer.from(hex.slice(128, 128 + len*2), "hex").toString("utf8");
        }
      } catch {}

      const dec = decRaw ? parseInt(decRaw, 16) : 18;
      setSym(symDecoded); setDec(String(dec)); setName(nameDecoded);
    } catch (e: any) {
      setError(e.message ?? "Lookup failed");
    } finally { setLoading(false); }
  }

  function handleAdd() {
    if (!sym || !addr) return;
    const color = addrColor(addr);
    const token: CustomToken = {
      sym, addr, decimals: parseInt(decimals)||18,
      color, label: name || sym,
    };
    onAdd(token);
    onClose();
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:20, padding:24, width:340, boxShadow:"0 16px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800 }}>Add Custom Token</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text2)", cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>
        </div>

        {/* Contract address input */}
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:6 }}>Token Contract Address</div>
          <div style={{ display:"flex", gap:8 }}>
            <input value={addr} onChange={e=>{ setAddr(e.target.value); setSym(""); setDec(""); setName(""); setError(""); }}
              placeholder="0x…"
              style={{ flex:1, background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:"9px 12px", fontSize:12, color:"var(--text0)", fontFamily:"var(--mono)", outline:"none" }}/>
            <button onClick={lookup} disabled={loading}
              style={{ padding:"9px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--cyan)", fontFamily:"var(--mono)", fontSize:12, fontWeight:700, cursor:loading?"not-allowed":"pointer" }}>
              {loading ? "…" : "Lookup"}
            </button>
          </div>
          {error && <div style={{ fontSize:11, color:"var(--red)", fontFamily:"var(--mono)", marginTop:6 }}>{error}</div>}
        </div>

        {/* Token info preview */}
        {sym && (
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
              <div style={{ width:32, height:32, borderRadius:"50%", background:addrColor(addr), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#fff" }}>
                {sym.slice(0,2)}
              </div>
              <div>
                <div style={{ fontWeight:800, fontSize:14 }}>{sym}</div>
                <div style={{ fontSize:11, color:"var(--text2)" }}>{name}</div>
              </div>
            </div>
            <div style={{ fontSize:12, fontFamily:"var(--mono)", color:"var(--text2)" }}>
              Decimals: <strong style={{ color:"var(--text1)" }}>{decimals}</strong>
              <span style={{ marginLeft:12 }}>Address: {addr.slice(0,10)}…</span>
            </div>
            {tokenMeta[sym] && <div style={{ fontSize:11, color:"#f59e0b", marginTop:6, fontFamily:"var(--mono)" }}>⚠ Token "{sym}" already exists</div>}
          </div>
        )}

        <button onClick={handleAdd} disabled={!sym || !!tokenMeta[sym]}
          className={!sym || !!tokenMeta[sym] ? "swap-btn disabled-state" : "swap-btn ready"}
          style={{ margin:0, fontSize:14 }}>
          Add {sym || "Token"}
        </button>
      </div>
    </div>
  );
}

export default function SwapPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tokenIn,  setTokenIn]  = useState<TokenSym>("USDC");
  const [tokenOut, setTokenOut] = useState<TokenSym>("EURC");
  const [amountIn, setAmountIn] = useState("");
  const [estimate, setEstimate] = useState<{ amtOut:string; rate:string; impact:string }|null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState("");
  const [txHistory, setTxHistory] = useState<{ hash:string; amtOut:string; amtIn:number; tokenIn:string; tokenOut:string; ts:number }[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage after hydration (client-only)
  useEffect(()=>{
    try { const s = localStorage.getItem("matrix_swap_history"); if (s) setTxHistory(JSON.parse(s)); } catch {}
    setHydrated(true);
  }, []);

  // Persist tx history to localStorage whenever it changes
  useEffect(()=>{
    try { localStorage.setItem("matrix_swap_history", JSON.stringify(txHistory)); } catch {}
  }, [txHistory]);
  const [slippage,    setSlippage]    = useState(0.5);
  const [showSlip,    setShowSlip]    = useState(false);
  const [reserves,    setReserves]    = useState<{ usdc:number; eurc:number }|null>(null);
  const [showAddToken,setShowAddToken]= useState(false);
  const [customTokens,setCustomTokens]= useState<CustomToken[]>(()=>{
    try { const s=localStorage.getItem("matrix_custom_tokens"); return s?JSON.parse(s):[]; } catch { return []; }
  });

  // Build dynamic TOKEN_META merging defaults + custom tokens
  const TOKEN_META = {
    ...DEFAULT_TOKEN_META,
    ...Object.fromEntries(customTokens.map(t=>([t.sym, { color:t.color, bg:`${t.color}26`, label:t.label, decimals:t.decimals }]))),
  };

  // Build dynamic ALL_TOKENS list
  const ALL_TOKENS: string[] = [...BASE_TOKENS, ...customTokens.map(t=>t.sym)];

  // Build dynamic ROUTES — add custom token routes via USDC
  const ROUTES_DYNAMIC: Record<string, string[]> = {
    ...ROUTES,
    ...Object.fromEntries(customTokens.flatMap(t=>[
      [`USDC-${t.sym}`,  [USDC, t.addr]],
      [`${t.sym}-USDC`,  [t.addr, USDC]],
      [`EURC-${t.sym}`,  [EURC, USDC, t.addr]],
      [`${t.sym}-EURC`,  [t.addr, USDC, EURC]],
      [`cirBTC-${t.sym}`,[cirBTC, USDC, t.addr]],
      [`${t.sym}-cirBTC`,[t.addr, USDC, cirBTC]],
    ])),
  };

  // Persist custom tokens to localStorage
  useEffect(()=>{
    try { localStorage.setItem("matrix_custom_tokens", JSON.stringify(customTokens)); } catch {}
  },[customTokens]);

  function addCustomToken(t: CustomToken) {
    setCustomTokens(prev=>[...prev.filter(x=>x.sym!==t.sym), t]);
  }
  function removeCustomToken(sym: string) {
    setCustomTokens(prev=>prev.filter(t=>t.sym!==sym));
    if (tokenIn===sym)  setTokenIn("USDC");
    if (tokenOut===sym) setTokenOut("EURC");
  }

  const debounce  = useRef<ReturnType<typeof setTimeout>|null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval>|null>(null);

  // Best path found by the optimizer — updated whenever amountIn/tokenIn/tokenOut changes
  const [bestPath, setBestPath] = useState<string[] | null>(null);
  const [pathLabel, setPathLabel] = useState<string>("");

  const routeKey    = `${tokenIn}-${tokenOut}`;
  const staticPath  = ROUTES_DYNAMIC[routeKey] ?? [USDC, EURC];
  // Use optimizer-selected path when available, otherwise fall back to static route
  const path        = bestPath ?? staticPath;
  const isMultiHop  = path.length > 2;
  const tokenInDec  = TOKEN_META[tokenIn]?.decimals  ?? 6;
  const tokenOutDec = TOKEN_META[tokenOut]?.decimals ?? 6;
  const balIn  = wallet.connected ? getBal(wallet.balances, tokenIn)  : 0;
  const balOut = wallet.connected ? getBal(wallet.balances, tokenOut) : 0;
  const amtNum = parseFloat(amountIn) || 0;



  // Load reserves (USDC/EURC pair only, for rate display)
  useEffect(()=>{
    if (isMultiHop || tokenIn==="cirBTC" || tokenOut==="cirBTC") { setReserves(null); return; }
    rpcCall("eth_call",[{ to:PAIR, data:"0x0902f1ac" },"latest"])
      .then((r:any)=>{
        if (!r||r==="0x") return;
        const hex = r.replace("0x","");
        const r0 = parseInt(hex.slice(0,64),16)/1e6;
        const r1 = parseInt(hex.slice(64,128),16)/1e6;
        setReserves({ usdc:r0, eurc:r1 });
      }).catch(()=>{});
  },[tokenIn, tokenOut, isMultiHop]);

  // Auto-estimate: runs path optimizer then displays best quote.
  // Resets bestPath on token/amount change so the optimizer always re-runs fresh.
  useEffect(()=>{
    if (!amtNum||amtNum<=0) { setEstimate(null); setBestPath(null); setPathLabel(""); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async()=>{
      setEstimating(true);
      setBestPath(null); // clear previous best so we use staticPath during query
      try {
        const amtInRaw = toUnits(amtNum, tokenInDec);
        const tokenInAddr  = ROUTES_DYNAMIC[`${tokenIn}-${tokenOut}`]?.[0]  ?? staticPath[0];
        const tokenOutAddr = ROUTES_DYNAMIC[`${tokenIn}-${tokenOut}`]?.slice(-1)[0] ?? staticPath[staticPath.length - 1];

        // Find the optimal path across all candidates
        const { path: optPath, amtOutRaw, isOptimal } = await findBestPath(
          tokenInAddr, tokenOutAddr, amtInRaw, staticPath
        );

        setBestPath(optPath);

        // Build human-readable route label using token symbols
        const addrToSym: Record<string, string> = {
          [USDC.toLowerCase()]:   "USDC",
          [EURC.toLowerCase()]:   "EURC",
          [cirBTC.toLowerCase()]: "cirBTC",
        };
        // Add custom tokens to lookup
        customTokens.forEach(t => { addrToSym[t.addr.toLowerCase()] = t.sym; });
        const label = optPath.map(a => addrToSym[a.toLowerCase()] ?? a.slice(0,6)+"…").join(" → ");
        setPathLabel(label);

        if (!isOptimal || amtOutRaw === 0n) { setEstimate(null); return; }

        const amtOut = Number(amtOutRaw) / 10 ** tokenOutDec;
        const rate   = (amtOut / amtNum).toFixed(tokenOutDec === 8 ? 8 : 6);
        // Price impact is only meaningful for same-unit single-hop swaps
        const impact = (optPath.length === 2 && tokenInDec === tokenOutDec)
          ? (Math.abs(1 - amtOut / amtNum) * 100).toFixed(2)
          : "N/A";
        setEstimate({ amtOut: amtOut.toFixed(tokenOutDec === 8 ? 8 : 6), rate, impact });
      } catch { setEstimate(null); }
      finally { setEstimating(false); }
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[amountIn, tokenIn, tokenOut]);

  // Auto-refresh quote every 15 seconds when amount is entered
  useEffect(()=>{
    if (refreshTimer.current) clearInterval(refreshTimer.current);
    if (!amtNum || amtNum <= 0) return;
    refreshTimer.current = setInterval(async ()=>{
      if (loading) return; // skip refresh during active swap
      try {
        const amtInRaw = toUnits(amtNum, tokenInDec);
        const data = encodeGetAmountsOut(amtInRaw, path);
        const r:any = await rpcCall("eth_call",[{ to:ROUTER, data },"latest"]);
        if (!r||r==="0x") return;
        const hex = r.replace("0x","");
        const lastIdx = 128 + (path.length - 1) * 64;
        const amtOutRaw = BigInt("0x"+hex.slice(lastIdx, lastIdx+64));
        const amtOut = Number(amtOutRaw)/10**tokenOutDec;
        const rate   = (amtOut/amtNum).toFixed(tokenOutDec===8?8:6);
        const impact = (!isMultiHop && tokenInDec===tokenOutDec)
          ? (Math.abs(1-amtOut/amtNum)*100).toFixed(2)
          : "N/A";
        setEstimate({ amtOut:amtOut.toFixed(tokenOutDec===8?8:6), rate, impact });
      } catch {}
    }, 15000);
    return ()=>{ if (refreshTimer.current) clearInterval(refreshTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[amtNum, tokenIn, tokenOut, loading]);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.connected) { openModal(); return; }
    if (!amtNum) return;
    setLoading(true); setStatus("");
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const amtInRaw  = toUnits(amtNum, tokenInDec);
      const amtOutNum = estimate ? parseFloat(estimate.amtOut) : amtNum*0.9;
      const amtOutMin = toUnits(amtOutNum*(1-slippage/100), tokenOutDec);
      const deadline  = BigInt(Math.floor(Date.now()/1000)+1200);
      const tokenInAddr = path[0];

      setStatus(`Checking ${tokenIn} allowance…`);
      const allowRaw = await rpcCall("eth_call",[{ to:tokenInAddr, data:encodeAllowance(wallet.address,ROUTER) },"latest"]);
      const allowance = safeAllowance(allowRaw);

      if (allowance < amtInRaw) {
        setStatus(`Approve ${tokenIn} — confirm in wallet…`);
        // Approve a large but not unlimited amount — avoids MetaMask NFT withdrawal UI
        const approveTx:string = await eth.request({ method:"eth_sendTransaction", params:[{ from:wallet.address, to:tokenInAddr, data:encodeApprove(ROUTER,makeLargeApproval(tokenInDec)), gas:GAS_APPROVE }] });
        setStatus("Waiting for approval…");
        if (!await waitTx(approveTx,90000)) throw new Error(`Approve failed. TX: ${approveTx}`);
        setStatus("Approved! Preparing swap…");
        await new Promise(r=>setTimeout(r,3000));
        const newAllow = await rpcCall("eth_call",[{ to:tokenInAddr, data:encodeAllowance(wallet.address,ROUTER) },"latest"]);
        if (safeAllowance(newAllow) < amtInRaw) throw new Error("Allowance not updated after approval.");
      }

      setStatus(`Swapping — confirm in wallet…`);
      const swapData = encodeSwap(amtInRaw, amtOutMin, path, wallet.address, deadline);
      const swapTx:string = await eth.request({ method:"eth_sendTransaction", params:[{ from:wallet.address, to:ROUTER, data:swapData, gas:GAS_SWAP }] });
      setStatus("Waiting for confirmation…");
      if (!await waitTx(swapTx)) throw new Error(`Swap reverted. Check: ${ARC_EXPLORER}/tx/${swapTx}`);

      setTxHistory(prev => [{ hash:swapTx, amtOut:estimate?.amtOut??"?", amtIn:amtNum, tokenIn, tokenOut, ts:Date.now() }, ...prev].slice(0,3));
      showToast(true,"Swap Confirmed ✓",`${amtNum} ${tokenIn} → ~${estimate?.amtOut??""} ${tokenOut}`);
      setAmountIn(""); setEstimate(null);
      await refreshBalances();
    } catch (err:any) {
      const msg = err?.message||String(err);
      if (msg.includes("4001")||/reject|denied|cancel/i.test(msg)) showToast(false,"Cancelled","Rejected in wallet.");
      else showToast(false,"Swap Failed",msg.slice(0,80));
    } finally { setLoading(false); setStatus(""); }
  }

  // Refs to close each dropdown from the other
  const closeInRef  = useRef<()=>void>(()=>{});
  const closeOutRef = useRef<()=>void>(()=>{});

  const impactColor = (v:string) => v==="N/A"?"var(--text2)":parseFloat(v)<1?"var(--green)":parseFloat(v)<3?"#f59e0b":"var(--red)";
  const rate = reserves && !isMultiHop
    ? (tokenIn==="USDC" ? reserves.eurc/reserves.usdc : reserves.usdc/reserves.eurc)
    : null;

  return (
    <div style={{ maxWidth:480, margin:"0 auto", padding:"20px 20px" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0, letterSpacing:-0.5 }}>Swap</h1>
          {rate
            ? <p style={{ fontSize:12, color:"var(--text2)", margin:"2px 0 0", fontFamily:"var(--mono)" }}>1 {tokenIn} ≈ <strong style={{ color:"var(--text1)" }}>{rate.toFixed(4)}</strong> {tokenOut}</p>
            : isMultiHop
              ? <p style={{ fontSize:12, color:"#a855f7", margin:"2px 0 0", fontFamily:"var(--mono)" }}>Route: {pathLabel || `${tokenIn} → USDC → ${tokenOut}`}</p>
              : null
          }
        </div>

        <div style={{ display:"flex", gap:8 }}>
        {/* Add custom token button */}
        <button type="button" onClick={()=>setShowAddToken(true)}
          title="Add custom token"
          style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--text2)", cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>
          +
        </button>

        {/* Slippage gear */}
        <div style={{ position:"relative" }}>
          <button type="button" onClick={()=>setShowSlip(s=>!s)}
            style={{ width:36, height:36, borderRadius:10, border:`1px solid ${showSlip?"var(--cyan)":"var(--border)"}`, background:showSlip?"rgba(0,229,255,0.08)":"var(--bg2)", color:showSlip?"var(--cyan)":"var(--text2)", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" }}>
            ⚙️
          </button>
          {showSlip && (
            <div style={{ position:"absolute", right:0, top:44, background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 14px", zIndex:10, minWidth:200, boxShadow:"0 8px 24px rgba(0,0,0,0.3)" }}>
              <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", fontWeight:700, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.6px" }}>Slippage Tolerance</div>
              <div style={{ display:"flex", gap:6 }}>
                {[0.1,0.5,1.0].map(s=>(
                  <button key={s} type="button" onClick={()=>{ setSlippage(s); setShowSlip(false); }}
                    style={{ flex:1, padding:"7px 0", borderRadius:8, border:"1px solid", borderColor:slippage===s?"var(--cyan)":"var(--border)", background:slippage===s?"rgba(0,229,255,0.12)":"var(--bg2)", color:slippage===s?"var(--cyan)":"var(--text2)", fontFamily:"var(--mono)", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Add custom token modal */}
      {showAddToken && (
        <AddTokenModal
          onClose={()=>setShowAddToken(false)}
          onAdd={addCustomToken}
          tokenMeta={TOKEN_META}
        />
      )}

      {/* Custom token list (removable) */}
      {customTokens.length > 0 && (
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
          {customTokens.map(t=>(
            <div key={t.sym} style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px 3px 8px", borderRadius:20, background:"var(--bg2)", border:"1px solid var(--border)", fontSize:12, fontFamily:"var(--mono)" }}>
              <div style={{ width:14, height:14, borderRadius:"50%", background:t.color }}/>
              <span style={{ color:"var(--text1)", fontWeight:700 }}>{t.sym}</span>
              <button onClick={()=>removeCustomToken(t.sym)} style={{ background:"none", border:"none", color:"var(--text2)", cursor:"pointer", fontSize:14, lineHeight:1, padding:"0 0 0 2px" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Main card */}
      <form onSubmit={handleSwap}>
        <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:20, overflow:"visible" }}>

          {/* Sell box */}
          <div style={{ padding:"18px 18px 14px", background:"var(--bg2)", borderRadius:"20px 20px 0 0" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:12, color:"var(--text2)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.5px" }}>Sell</span>
              {wallet.connected && (
                <button type="button" onClick={()=>setAmountIn(balIn.toFixed(tokenInDec))}
                  style={{ fontSize:12, color:"var(--cyan)", background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:"var(--mono)" }}>
                  Balance: <strong>{balIn.toFixed(4)}</strong>
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="number" placeholder="0" step="any" min="0" value={amountIn}
                onChange={e=>{ setAmountIn(e.target.value); }}
                style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:36, fontWeight:800, color:"var(--text0)", fontFamily:"var(--mono)", minWidth:0, letterSpacing:"-1px" }} />
              <TokenSelector sym={tokenIn}
                closeOther={()=>closeOutRef.current()}
                registerClose={(fn)=>{ closeInRef.current=fn; }}
                tokenMeta={TOKEN_META}
                allTokens={ALL_TOKENS}
                onChange={(s)=>{
                  if (s===tokenOut) setTokenOut(tokenIn);
                  setTokenIn(s); setAmountIn(""); setEstimate(null);
                }} />
            </div>
            {balIn>0 && (
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                {[25,50,75,100].map(p=>(
                  <button key={p} type="button" onClick={()=>setAmountIn((balIn*p/100).toFixed(tokenInDec))}
                    style={{ flex:1, padding:"4px 0", borderRadius:6, border:"1px solid var(--border)", background:"var(--bg3)", color:"var(--text2)", fontSize:11, fontFamily:"var(--mono)", fontWeight:700, cursor:"pointer" }}>
                    {p}%
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip button */}
          <div style={{ position:"relative", height:0, display:"flex", justifyContent:"center", zIndex:2 }}>
            <button type="button"
              onClick={()=>{ setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn(""); setEstimate(null); closeInRef.current(); closeOutRef.current(); }}
              style={{ position:"absolute", top:-18, width:36, height:36, borderRadius:10, border:"2px solid var(--bg0)", background:"var(--bg1)", color:"var(--cyan)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
              ⇅
            </button>
          </div>

          {/* Buy box */}
          <div style={{ padding:"18px 18px 18px", borderTop:"1px solid var(--border)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:12, color:"var(--text2)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.5px" }}>Buy</span>
                {isMultiHop && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:20, background:"rgba(168,85,247,0.15)", color:"#a855f7", fontFamily:"var(--mono)", fontWeight:700 }}>Multi-hop</span>}
              </div>
              {wallet.connected && (
                <span style={{ fontSize:12, color:"var(--text2)", fontFamily:"var(--mono)" }}>
                  Balance: <strong style={{ color:"var(--text1)" }}>{balOut.toFixed(4)}</strong>
                </span>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, fontSize:36, fontWeight:800, fontFamily:"var(--mono)", letterSpacing:"-1px", color: estimating?"var(--text2)": estimate?"var(--green)":"var(--text2)" }}>
                {estimating ? (
                  <span style={{ fontSize:24, animation:"pulse 1s infinite" }}>…</span>
                ) : (
                  estimate?.amtOut ?? "0"
                )}
              </div>
              <TokenSelector sym={tokenOut}
                closeOther={()=>closeInRef.current()}
                registerClose={(fn)=>{ closeOutRef.current=fn; }}
                tokenMeta={TOKEN_META}
                allTokens={ALL_TOKENS}
                onChange={(s)=>{
                  if (s===tokenIn) setTokenIn(tokenOut);
                  setTokenOut(s); setEstimate(null);
                }}
                active />
            </div>

            {/* Rate details */}
            {estimate && !estimating && (
              <div className="fade-in" style={{ marginTop:12, paddingTop:12, borderTop:"1px solid var(--border)", fontSize:12, fontFamily:"var(--mono)", color:"var(--text2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span>1 {tokenIn} = {estimate.rate} {tokenOut}</span>
                  <span style={{ color:impactColor(estimate.impact) }}>Impact: {estimate.impact}%</span>
                </div>
                {isMultiHop && <div style={{ fontSize:10, color:"#a855f7", marginTop:2 }}>Route: {pathLabel || `${tokenIn} → USDC → ${tokenOut}`}</div>}
              </div>
            )}
            {estimating && amtNum>0 && (
              <div style={{ marginTop:8, fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)" }}>
                <span className="spinner" style={{ borderTopColor:"var(--cyan)", width:10, height:10, borderWidth:1.5 }}/> Refreshing quote…
              </div>
            )}
          </div>
        </div>

        {/* Status bar */}
        {loading && status && (
          <div className="fade-in" style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--cyan)", fontFamily:"var(--mono)", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:12, padding:"10px 14px", marginTop:10 }}>
            <span className="spinner" style={{ borderTopColor:"var(--cyan)" }} />{status}
          </div>
        )}

        {/* Slippage info */}
        {estimate && !loading && (
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", padding:"6px 4px 0" }}>
            <span>Slippage: {slippage}%</span>
            <span>Min received: {(parseFloat(estimate.amtOut)*(1-slippage/100)).toFixed(tokenOutDec===8?8:4)} {tokenOut}</span>
          </div>
        )}

        {/* CTA Button */}
        <div style={{ marginTop:12 }}>
          {!wallet.connected
            ? <button type="button" onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button type="submit" disabled={loading||!amtNum}
                className={loading||!amtNum ? "swap-btn disabled-state" : "swap-btn ready"}
                style={{ margin:0, fontSize:16, fontWeight:800, letterSpacing:"-0.2px" }}>
                {loading
                  ? <><span className="spinner" />{status.includes("Approve")?"Approving…":"Swapping…"}</>
                  : amtNum>0
                    ? `Swap ${amtNum} ${tokenIn} → ${tokenOut}`
                    : "Enter an amount"
                }
              </button>
          }
        </div>
      </form>

      {/* TX History — only render client-side to avoid hydration mismatch */}
      {hydrated && txHistory.length > 0 && (
        <div className="fade-in" style={{ marginTop:14 }}>
          <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:8 }}>Recent Transactions</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {txHistory.map((tx, i) => (
              <div key={tx.hash} style={{ background: i===0 ? "rgba(0,200,150,0.06)" : "var(--bg1)", border:`1px solid ${i===0 ? "rgba(0,200,150,0.2)" : "var(--border)"}`, borderRadius:12, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  {i===0 && <div style={{ width:6, height:6, borderRadius:"50%", background:"var(--green)", animation:"pulse 2s infinite", flexShrink:0 }} />}
                  <div>
                    <div style={{ fontSize:13, fontWeight:700, color: i===0 ? "var(--green)" : "var(--text1)" }}>
                      {tx.amtIn} {tx.tokenIn} → ~{tx.amtOut} {tx.tokenOut}
                    </div>
                    <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", marginTop:2 }}>
                      {new Date(tx.ts).toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
                    </div>
                  </div>
                </div>
                <a href={`${ARC_EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize:11, color:"var(--cyan)", fontFamily:"var(--mono)", textDecoration:"none", flexShrink:0, marginLeft:8 }}>
                  {tx.hash.slice(0,6)}…{tx.hash.slice(-4)} ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}