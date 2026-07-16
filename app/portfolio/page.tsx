"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/components/WalletProvider";
import { ARC_RPC, ARC_EXPLORER, CONTRACTS, TOKEN_META } from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────
const ROUTER  = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";

const TOKENS = [
  { sym:"USDC",   addr:CONTRACTS.USDC,   decimals:6, color:"#2775CA", price:1     },
  { sym:"EURC",   addr:CONTRACTS.EURC,   decimals:6, color:"#2B5EDD", price:1.082 },
  // cirBTC price set to 0 — not included in USD total (no live price feed)
  { sym:"cirBTC", addr:CONTRACTS.cirBTC, decimals:8, color:"#F7931A", price:0     },
];

// Hardcoded pair addresses — avoids Factory lookup which can hit rate limits
const POOLS = [
  { id:"usdc-eurc",   tA:"USDC", tB:"EURC",   label:"USDC / EURC",   pair:"0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb" },
  { id:"usdc-cirbtc", tA:"USDC", tB:"cirBTC", label:"USDC / cirBTC", pair:"0xa1d507a9662012bd43bf1ba5e03989d750a8c069" },
  { id:"eurc-cirbtc", tA:"EURC", tB:"cirBTC", label:"EURC / cirBTC", pair:"0x4404ec28d88768e3d36c3f8b981f662aba09d1c0" },
];

// ─── RPC helpers ─────────────────────────────────────────────────────────────
async function rpc(method: string, params: unknown[], retries=4): Promise<string|null> {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(ARC_RPC, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ jsonrpc:"2.0", id:1, method, params }),
      });
      const j = await r.json();
      if (!j.error) return j.result ?? null;
      const msg: string = j.error.message ?? "";
      if (/rate|limit|too many/i.test(msg)) {
        if (i < retries - 1) { await new Promise(res => setTimeout(res, 1000 * (i + 1))); continue; }
        return null; // silent fail
      }
      return null;
    } catch {
      if (i < retries - 1) await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
  return null;
}

function pad(v: string, isAddr=false) {
  if (isAddr) return v.toLowerCase().replace("0x","").padStart(64,"0");
  return BigInt(v).toString(16).padStart(64,"0");
}

const encodeBalOf   = (a:string) => "0x70a08231"+pad(a,true);
const encodeTotSup  = ()         => "0x18160ddd";
const encodeGetRes  = ()         => "0x0902f1ac";

// ─── Types ────────────────────────────────────────────────────────────────────
interface TokenBalance { sym:string; addr:string; decimals:number; color:string; price:number; balance:number; valueUSD:number; }
interface LPPosition  { id:string; label:string; pair:string; tA:string; tB:string; lpBal:number; sharePct:number; valueA:number; valueB:number; valueUSD:number; }

// ─── Sub-components ───────────────────────────────────────────────────────────
function TokenIcon({ sym, size=28 }: { sym:string; size?:number }) {
  const color = TOKENS.find(t=>t.sym===sym)?.color ?? "#666";
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.36, fontWeight:800, color:"#fff", flexShrink:0 }}>
      {sym==="cirBTC"?"₿":sym.slice(0,2)}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label:string; value:string; sub?:string; color?:string }) {
  return (
    <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px" }}>
      <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", textTransform:"uppercase", letterSpacing:"0.6px", marginBottom:6 }}>{label}</div>
      <div style={{ fontSize:24, fontWeight:800, color:color??"var(--text0)", letterSpacing:"-0.5px" }}>{value}</div>
      {sub && <div style={{ fontSize:12, color:"var(--text2)", marginTop:3, fontFamily:"var(--mono)" }}>{sub}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function PortfolioPage() {
  const { wallet, openModal } = useWallet();
  const [tokens,   setTokens]   = useState<TokenBalance[]>([]);
  const [lpPos,    setLpPos]    = useState<LPPosition[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date|null>(null);

  const totalTokenUSD = tokens.reduce((s,t)=>s+t.valueUSD,0);
  const totalLpUSD    = lpPos.reduce((s,p)=>s+p.valueUSD,0);
  const totalUSD      = totalTokenUSD + totalLpUSD;

  const load = useCallback(async () => {
    if (!wallet.connected || !wallet.address) return;
    setLoading(true);
    try {
      // ── 1. Token balances — sequential to avoid rate limit ─────────────────
      const tokenData: TokenBalance[] = [];
      for (const t of TOKENS) {
        const raw = await rpc("eth_call", [{ to:t.addr, data:encodeBalOf(wallet.address) }, "latest"]);
        const balance = raw && raw !== "0x" ? Number(BigInt(raw)) / 10**t.decimals : 0;
        tokenData.push({ ...t, balance, valueUSD: balance * t.price });
      }
      setTokens(tokenData);

      // ── 2. LP positions — use hardcoded pair addresses ─────────────────────
      const lpData: LPPosition[] = [];
      for (const pool of POOLS) {
        const tA = TOKENS.find(t=>t.sym===pool.tA)!;
        const tB = TOKENS.find(t=>t.sym===pool.tB)!;
        try {
          const pair = pool.pair;

          // Sequential calls to avoid rate limit
          const lpBalRaw  = await rpc("eth_call", [{ to:pair, data:encodeBalOf(wallet.address) }, "latest"]);
          const totSupRaw = await rpc("eth_call", [{ to:pair, data:encodeTotSup() }, "latest"]);
          const resRaw    = await rpc("eth_call", [{ to:pair, data:encodeGetRes() }, "latest"]);

          const lpBal  = lpBalRaw  && lpBalRaw!=="0x"  ? Number(BigInt(lpBalRaw))  / 1e18 : 0;
          const totSup = totSupRaw && totSupRaw!=="0x" ? Number(BigInt(totSupRaw)) / 1e18 : 0;
          if (lpBal === 0 || totSup === 0) continue;

          const sharePct = lpBal / totSup * 100;
          const hex = (resRaw ?? "").replace("0x","");
          const aIsToken0 = tA.addr.toLowerCase() < tB.addr.toLowerCase();
          const dec0 = aIsToken0 ? tA.decimals : tB.decimals;
          const dec1 = aIsToken0 ? tB.decimals : tA.decimals;
          const r0 = hex.length>=64  ? Number(BigInt("0x"+hex.slice(0,64)))   / 10**dec0 : 0;
          const r1 = hex.length>=128 ? Number(BigInt("0x"+hex.slice(64,128))) / 10**dec1 : 0;
          const resA = aIsToken0 ? r0 : r1;
          const resB = aIsToken0 ? r1 : r0;
          const valueA = resA * (sharePct/100);
          const valueB = resB * (sharePct/100);
          const valueUSD = valueA * tA.price + valueB * tB.price;

          lpData.push({ id:pool.id, label:pool.label, pair, tA:pool.tA, tB:pool.tB, lpBal, sharePct, valueA, valueB, valueUSD });
        } catch {}
      }
      setLpPos(lpData.sort((a,b)=>b.valueUSD-a.valueUSD));
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [wallet.connected, wallet.address]);

  useEffect(()=>{ load(); },[load]);

  // ── Not connected ──────────────────────────────────────────────────────────
  if (!wallet.connected) {
    return (
      <div style={{ maxWidth:560, margin:"60px auto", padding:"0 24px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>📊</div>
        <h1 style={{ fontSize:22, fontWeight:800, marginBottom:8 }}>Portfolio</h1>
        <p style={{ fontSize:14, color:"var(--text2)", marginBottom:24 }}>Connect your wallet to view your balances, LP positions and total value.</p>
        <button onClick={openModal} className="swap-btn connect-state" style={{ maxWidth:240, margin:"0 auto" }}>Connect Wallet</button>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ maxWidth:600, margin:"0 auto", padding:"20px 24px" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0, letterSpacing:-0.5 }}>Portfolio</h1>
          <p style={{ fontSize:12, color:"var(--text2)", margin:"3px 0 0", fontFamily:"var(--mono)" }}>
            {wallet.address.slice(0,8)}…{wallet.address.slice(-6)}
            {lastRefresh && <span style={{ marginLeft:10, color:"var(--text2)" }}>Updated {lastRefresh.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          style={{ width:36, height:36, borderRadius:10, border:"1px solid var(--border)", background:"var(--bg2)", color:"var(--cyan)", cursor:loading?"not-allowed":"pointer", fontSize:17, display:"flex", alignItems:"center", justifyContent:"center", animation:loading?"spin .7s linear infinite":"none" }}>
          ↻
        </button>
      </div>

      {loading && !totalUSD ? (
        <div style={{ display:"flex", gap:10, alignItems:"center", fontSize:13, color:"var(--text2)", fontFamily:"var(--mono)", padding:"20px 0" }}>
          <span className="spinner" style={{ borderTopColor:"var(--cyan)" }}/>Loading portfolio…
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:24 }}>
            <StatCard label="Total Value" value={`$${totalUSD.toLocaleString(undefined,{maximumFractionDigits:2})}`} color="var(--cyan)" />
            <StatCard label="Token Value" value={`$${totalTokenUSD.toLocaleString(undefined,{maximumFractionDigits:2})}`} />
            <StatCard label="LP Value"    value={`$${totalLpUSD.toLocaleString(undefined,{maximumFractionDigits:2})}`} color={totalLpUSD>0?"var(--green)":undefined} />
          </div>

          {/* Token balances */}
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:12, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", letterSpacing:"0.6px", fontFamily:"var(--mono)", marginBottom:10 }}>Token Balances</div>
            <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:14, overflow:"hidden" }}>
              {tokens.map((t, i) => (
                <div key={t.sym} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 18px", borderBottom: i<tokens.length-1?"1px solid var(--border)":"none" }}>
                  <TokenIcon sym={t.sym} size={36}/>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:15 }}>{t.sym}</div>
                    <div style={{ fontSize:12, color:"var(--text2)", fontFamily:"var(--mono)" }}>{TOKEN_META[t.sym]?.name}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:700, fontSize:15, fontFamily:"var(--mono)" }}>
                      {t.balance.toLocaleString(undefined, { maximumFractionDigits:t.decimals===8?8:4 })}
                    </div>
                    <div style={{ fontSize:12, color:"var(--text2)", fontFamily:"var(--mono)" }}>
                      {t.price > 0 ? `$${t.valueUSD.toLocaleString(undefined,{maximumFractionDigits:2})}` : "no price feed"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* LP Positions */}
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", letterSpacing:"0.6px", fontFamily:"var(--mono)", marginBottom:10 }}>LP Positions</div>
            {lpPos.length === 0 ? (
              <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:14, padding:"28px 20px", textAlign:"center" }}>
                <div style={{ fontSize:28, marginBottom:8 }}>💧</div>
                <div style={{ fontSize:14, color:"var(--text2)" }}>No liquidity positions found</div>
                <a href="/pool" style={{ fontSize:13, color:"var(--cyan)", textDecoration:"none", display:"block", marginTop:10 }}>Add liquidity →</a>
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {lpPos.map(pos => (
                  <div key={pos.id} style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:14, padding:"16px 18px" }}>
                    {/* Pool header */}
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
                      <div style={{ display:"flex" }}>
                        <TokenIcon sym={pos.tA} size={26}/>
                        <TokenIcon sym={pos.tB} size={26}/>
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:800, fontSize:14 }}>{pos.label}</div>
                        <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)" }}>
                          {pos.sharePct.toFixed(4)}% pool share
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:16, fontWeight:800, color:"var(--green)" }}>
                          ${pos.valueUSD.toLocaleString(undefined,{maximumFractionDigits:2})}
                        </div>
                        <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)" }}>total value</div>
                      </div>
                    </div>

                    {/* Position breakdown */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                      <div style={{ background:"var(--bg2)", borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, color:"var(--text2)", fontFamily:"var(--mono)", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:3 }}>{pos.tA}</div>
                        <div style={{ fontSize:15, fontWeight:700, fontFamily:"var(--mono)" }}>
                          {pos.valueA.toLocaleString(undefined,{maximumFractionDigits:4})}
                        </div>
                      </div>
                      <div style={{ background:"var(--bg2)", borderRadius:10, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, color:"var(--text2)", fontFamily:"var(--mono)", textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:3 }}>{pos.tB}</div>
                        <div style={{ fontSize:15, fontWeight:700, fontFamily:"var(--mono)" }}>
                          {pos.valueB.toLocaleString(undefined,{maximumFractionDigits:pos.tB==="cirBTC"?8:4})}
                        </div>
                      </div>
                    </div>

                    {/* Links */}
                    <div style={{ display:"flex", gap:16, marginTop:10 }}>
                      <a href="/pool" style={{ fontSize:12, color:"var(--cyan)", textDecoration:"none", fontFamily:"var(--mono)" }}>Manage →</a>
                      <a href={`${ARC_EXPLORER}/address/${pos.pair}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:"var(--text2)", textDecoration:"none", fontFamily:"var(--mono)" }}>
                        {pos.pair.slice(0,8)}…{pos.pair.slice(-6)} ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Price reference */}
          <div style={{ marginTop:20, padding:"12px 16px", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:12 }}>
            <div style={{ fontSize:11, color:"var(--text2)", fontFamily:"var(--mono)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.5px" }}>Price Reference (USD)</div>
            <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
              {TOKENS.map(t=>(
                <span key={t.sym} style={{ fontSize:12, fontFamily:"var(--mono)", color:"var(--text2)" }}>
                  {t.sym}: <strong style={{ color:"var(--text1)" }}>{t.price > 0 ? `$${t.price.toLocaleString()}` : "N/A"}</strong>
                </span>
              ))}
            </div>
            <div style={{ fontSize:10, color:"var(--text2)", fontFamily:"var(--mono)", marginTop:6 }}>
              * Prices are hardcoded references — not live feeds
            </div>
          </div>
        </>
      )}
    </div>
  );
}