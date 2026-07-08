"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, CONTRACTS, toUnits, encodeApprove, encodeAllowance } from "@/lib/contracts";

const ROUTER   = "0x29E0C2A0780196792dECc9183Dd5aA540c955BDf";
const PAIR     = "0x5eFf76b80A58ea34b23d0981bCCe2E639171c9cb";
const USDC     = CONTRACTS.USDC;
const EURC     = CONTRACTS.EURC;
const MAX_U256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
const GAS_APPROVE = "0x186A0";
const GAS_SWAP    = "0x3D090";

const TOKEN_META: Record<string, { color: string; bg: string; label: string }> = {
  USDC: { color: "#2775CA", bg: "rgba(39,117,202,0.15)", label: "USD Coin" },
  EURC: { color: "#2B5EDD", bg: "rgba(43,94,221,0.15)",  label: "Euro Coin" },
};

function encodeGetAmountsOut(amtIn: bigint, tokenIn: string, tokenOut: string): string {
  const sel    = "0xd06ca61f";
  const offset = (64).toString(16).padStart(64, "0");
  const len    = (2).toString(16).padStart(64, "0");
  const a0     = tokenIn.toLowerCase().replace("0x","").padStart(64,"0");
  const a1     = tokenOut.toLowerCase().replace("0x","").padStart(64,"0");
  return sel + amtIn.toString(16).padStart(64,"0") + offset + len + a0 + a1;
}

function encodeSwap(amtIn: bigint, amtOutMin: bigint, tokenIn: string, tokenOut: string, to: string, deadline: bigint): string {
  const sel     = "0x38ed1739";
  const pathOff = (5*32).toString(16).padStart(64,"0");
  const len     = (2).toString(16).padStart(64,"0");
  const a0      = tokenIn.toLowerCase().replace("0x","").padStart(64,"0");
  const a1      = tokenOut.toLowerCase().replace("0x","").padStart(64,"0");
  return sel + amtIn.toString(16).padStart(64,"0") + amtOutMin.toString(16).padStart(64,"0") + pathOff + to.toLowerCase().replace("0x","").padStart(64,"0") + deadline.toString(16).padStart(64,"0") + len + a0 + a1;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch("https://rpc.testnet.arc.network", {
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
    if (e.code===4902) await eth.request({ method:"wallet_addEthereumChain", params:[{ chainId:hex, chainName:"Arc Network Testnet", nativeCurrency:{ name:"USDC", symbol:"USDC", decimals:18 }, rpcUrls:["https://rpc.testnet.arc.network"], blockExplorerUrls:["https://testnet.arcscan.app"] }] });
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
function TokenIcon({ sym, size=28 }: { sym: string; size?: number }) {
  const m = TOKEN_META[sym];
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", background:m?.color ?? "#666", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.4, fontWeight:800, color:"#fff", flexShrink:0, letterSpacing:"-0.5px" }}>
      {sym.slice(0,2)}
    </div>
  );
}

// ── Token Pill (selector) ─────────────────────────────────────────────────────
function TokenPill({ sym, onClick, active }: { sym: string; onClick?: ()=>void; active?: boolean }) {
  const m = TOKEN_META[sym];
  return (
    <button type="button" onClick={onClick}
      style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px 8px 8px", borderRadius:40, border:`1.5px solid ${active ? m?.color : "var(--border)"}`, background: active ? m?.bg : "var(--bg3)", cursor: onClick?"pointer":"default", transition:"all 0.15s", flexShrink:0 }}>
      <TokenIcon sym={sym} size={24} />
      <span style={{ fontWeight:800, fontSize:15, color:"var(--text0)", letterSpacing:"-0.2px" }}>{sym}</span>
    </button>
  );
}

export default function SwapPage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tokenIn,  setTokenIn]  = useState<"USDC"|"EURC">("USDC");
  const [amountIn, setAmountIn] = useState("");
  const [estimate, setEstimate] = useState<{ amtOut:string; rate:string; impact:string }|null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState("");
  const [txHistory, setTxHistory] = useState<{ hash:string; amtOut:string; amtIn:number; tokenIn:string; tokenOut:string; ts:number }[]>([]);
  const [slippage, setSlippage] = useState(0.5);
  const [showSlip, setShowSlip] = useState(false);
  const [reserves, setReserves] = useState<{ usdc:number; eurc:number }|null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>|null>(null);

  const tokenOut     = tokenIn==="USDC" ? "EURC" : "USDC";
  const tokenInAddr  = tokenIn ==="USDC" ? USDC : EURC;
  const tokenOutAddr = tokenOut==="USDC" ? USDC : EURC;
  const balIn  = wallet.connected ? getBal(wallet.balances, tokenIn)  : 0;
  const balOut = wallet.connected ? getBal(wallet.balances, tokenOut) : 0;
  const amtNum = parseFloat(amountIn) || 0;
  const metaIn  = TOKEN_META[tokenIn];
  const metaOut = TOKEN_META[tokenOut];

  // Load reserves
  useEffect(()=>{
    rpcCall("eth_call",[{ to:PAIR, data:"0x0902f1ac" },"latest"])
      .then((r:any)=>{
        if (!r||r==="0x") return;
        const hex = r.replace("0x","");
        const r0 = parseInt(hex.slice(0,64),16)/1e6;
        const r1 = parseInt(hex.slice(64,128),16)/1e6;
        setReserves({ usdc:r0, eurc:r1 });
      }).catch(()=>{});
  },[]);

  // Auto-estimate
  useEffect(()=>{
    if (!amtNum||amtNum<=0) { setEstimate(null); return; }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async()=>{
      setEstimating(true);
      try {
        const amtInRaw = toUnits(amtNum,6);
        const data = encodeGetAmountsOut(amtInRaw, tokenInAddr, tokenOutAddr);
        const r:any = await rpcCall("eth_call",[{ to:ROUTER, data },"latest"]);
        if (!r||r==="0x") { setEstimate(null); return; }
        const hex = r.replace("0x","");
        const amtOutRaw = BigInt("0x"+hex.slice(192,256));
        const amtOut = Number(amtOutRaw)/1e6;
        const rate = (amtOut/amtNum).toFixed(6);
        const impact = (Math.abs(1-amtOut/amtNum)*100).toFixed(2);
        setEstimate({ amtOut:amtOut.toFixed(6), rate, impact });
      } catch { setEstimate(null); }
      finally { setEstimating(false); }
    },500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[amountIn,tokenIn]);

  async function handleSwap(e: React.FormEvent) {
    e.preventDefault();
    if (!wallet.connected) { openModal(); return; }
    if (!amtNum) return;
    setLoading(true); setStatus("");
    const eth = (window as any).ethereum;
    try {
      await switchToArc();
      const amtInRaw  = toUnits(amtNum,6);
      const amtOutNum = estimate ? parseFloat(estimate.amtOut) : amtNum*0.9;
      const amtOutMin = toUnits(amtOutNum*(1-slippage/100),6);
      const deadline  = BigInt(Math.floor(Date.now()/1000)+1200);

      setStatus(`Checking ${tokenIn} allowance…`);
      const allowRaw:any = await rpcCall("eth_call",[{ to:tokenInAddr, data:encodeAllowance(wallet.address,ROUTER) },"latest"]);
      const allowance = allowRaw&&allowRaw!=="0x" ? BigInt(allowRaw) : 0n;

      if (allowance<amtInRaw) {
        setStatus(`Approve ${tokenIn} — confirm in wallet…`);
        const approveTx:string = await eth.request({ method:"eth_sendTransaction", params:[{ from:wallet.address, to:tokenInAddr, data:encodeApprove(ROUTER,MAX_U256), gas:GAS_APPROVE }] });
        setStatus("Waiting for approval…");
        if (!await waitTx(approveTx,90000)) throw new Error(`Approve failed. TX: ${approveTx}`);
        setStatus("Approved! Preparing swap…");
        await new Promise(r=>setTimeout(r,3000));
        const newAllow:any = await rpcCall("eth_call",[{ to:tokenInAddr, data:encodeAllowance(wallet.address,ROUTER) },"latest"]);
        if (!newAllow||BigInt(newAllow)<amtInRaw) throw new Error("Allowance not updated.");
      }

      setStatus(`Swapping — confirm in wallet…`);
      const swapData = encodeSwap(amtInRaw,amtOutMin,tokenInAddr,tokenOutAddr,wallet.address,deadline);
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

  const impactColor = (v:string) => parseFloat(v)<1?"var(--green)":parseFloat(v)<3?"#f59e0b":"var(--red)";
  const rate = reserves ? (tokenIn==="USDC" ? reserves.eurc/reserves.usdc : reserves.usdc/reserves.eurc) : null;

  return (
    <div style={{ maxWidth:480, margin:"0 auto", padding:"20px 20px" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:800, margin:0, letterSpacing:-0.5 }}>Swap</h1>
          {rate && <p style={{ fontSize:12, color:"var(--text2)", margin:"2px 0 0", fontFamily:"var(--mono)" }}>1 {tokenIn} ≈ <strong style={{ color:"var(--text1)" }}>{rate.toFixed(4)}</strong> {tokenOut}</p>}
        </div>

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

      {/* Main card */}
      <form onSubmit={handleSwap}>
        <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:20, overflow:"hidden" }}>

          {/* Sell box */}
          <div style={{ padding:"18px 18px 14px", background:"var(--bg2)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:12, color:"var(--text2)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.5px" }}>Sell</span>
              {wallet.connected && (
                <button type="button" onClick={()=>setAmountIn(balIn.toFixed(6))}
                  style={{ fontSize:12, color:"var(--cyan)", background:"none", border:"none", cursor:"pointer", padding:0, fontFamily:"var(--mono)" }}>
                  Balance: <strong>{balIn.toFixed(4)}</strong>
                </button>
              )}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="number" placeholder="0" step="any" min="0" value={amountIn}
                onChange={e=>{ setAmountIn(e.target.value); }}
                style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:36, fontWeight:800, color:"var(--text0)", fontFamily:"var(--mono)", minWidth:0, letterSpacing:"-1px" }} />
              <TokenPill sym={tokenIn} />
            </div>
            {amtNum>0 && balIn>0 && (
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                {[25,50,75,100].map(p=>(
                  <button key={p} type="button" onClick={()=>setAmountIn((balIn*p/100).toFixed(6))}
                    style={{ flex:1, padding:"4px 0", borderRadius:6, border:"1px solid var(--border)", background:"var(--bg3)", color:"var(--text2)", fontSize:11, fontFamily:"var(--mono)", fontWeight:700, cursor:"pointer" }}>
                    {p}%
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Flip button */}
          <div style={{ position:"relative", height:0, display:"flex", justifyContent:"center" }}>
            <button type="button"
              onClick={()=>{ setTokenIn(tokenOut as "USDC"|"EURC"); setAmountIn(""); setEstimate(null); }}
              style={{ position:"absolute", top:-18, width:36, height:36, borderRadius:10, border:"2px solid var(--bg0)", background:"var(--bg1)", color:"var(--cyan)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, zIndex:1, boxShadow:"0 2px 8px rgba(0,0,0,0.2)" }}>
              ⇅
            </button>
          </div>

          {/* Buy box */}
          <div style={{ padding:"18px 18px 18px", borderTop:"1px solid var(--border)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <span style={{ fontSize:12, color:"var(--text2)", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.5px" }}>Buy</span>
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
              <TokenPill sym={tokenOut} active />
            </div>

            {/* Rate details */}
            {estimate && !estimating && (
              <div className="fade-in" style={{ marginTop:12, paddingTop:12, borderTop:"1px solid var(--border)", display:"flex", justifyContent:"space-between", fontSize:12, fontFamily:"var(--mono)", color:"var(--text2)" }}>
                <span>1 {tokenIn} = {estimate.rate} {tokenOut}</span>
                <span style={{ color:impactColor(estimate.impact) }}>Price impact: {estimate.impact}%</span>
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
            <span>Min received: {(parseFloat(estimate.amtOut)*(1-slippage/100)).toFixed(4)} {tokenOut}</span>
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

      {/* TX History */}
      {txHistory.length > 0 && (
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
                      {new Date(tx.ts).toLocaleTimeString()}
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