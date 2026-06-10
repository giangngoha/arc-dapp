"use client";
import { useState } from "react";
import { bridgeTokens, estimateBridge } from "./actions";

const CHAINS = [
  { id:"Arc_Testnet",      label:"Arc Testnet", sub:"Arc (0x4cef52)",  color:"#00b4d8", icon:"A" },
  { id:"Ethereum_Sepolia", label:"Ethereum",    sub:"Sepolia Testnet", color:"#627EEA", icon:"Ξ" },
  { id:"Avalanche_Fuji",   label:"Avalanche",   sub:"Fuji Testnet",    color:"#E84142", icon:"▲" },
];

type Chain = typeof CHAINS[0];

function ChainCard({ chain, selected, onClick }: { chain:Chain; selected:boolean; onClick:()=>void }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex:1, padding:"14px 8px", borderRadius:14, border:"1px solid",
      borderColor: selected ? chain.color+"99" : "var(--border)",
      background:  selected ? chain.color+"18" : "var(--bg2)",
      cursor:"pointer", transition:"all 0.2s",
      display:"flex", flexDirection:"column", alignItems:"center", gap:6,
    }}>
      <div style={{
        width:36, height:36, borderRadius:"50%",
        background: selected ? chain.color : "var(--bg3)",
        border:`2px solid ${selected ? chain.color : "var(--border)"}`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:15, fontWeight:800, color:"#fff",
        boxShadow: selected ? `0 0 12px ${chain.color}44` : "none",
      }}>{chain.icon}</div>
      <span style={{ fontSize:12, fontWeight:700, color: selected ? "#fff" : "var(--text1)" }}>{chain.label}</span>
      <span style={{ fontSize:10, fontFamily:"var(--mono)", color: selected ? chain.color : "var(--text2)" }}>{chain.sub}</span>
    </button>
  );
}

function Row({ k, v, accent }:{ k:string; v:string; accent?:boolean }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0", fontFamily:"var(--mono)" }}>
      <span style={{ color:"var(--text2)" }}>{k}</span>
      <span style={{ color:accent?"var(--cyan)":"var(--text1)", fontWeight:600 }}>{v}</span>
    </div>
  );
}

export default function BridgePage() {
  const [fromId,    setFromId]    = useState("Arc_Testnet");
  const [toId,      setToId]      = useState("Ethereum_Sepolia");
  const [amount,    setAmount]    = useState("");
  const [recipient, setRecipient] = useState("");
  const [showRecip, setShowRecip] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [estimating,setEstimating]= useState(false);
  const [status,    setStatus]    = useState("");
  const [estimate,  setEstimate]  = useState<Record<string,unknown>|null>(null);
  const [result,    setResult]    = useState<{ success:boolean; data?:unknown; error?:string; needsKey?:boolean }|null>(null);

  const from     = CHAINS.find(c => c.id === fromId)!;
  const to       = CHAINS.find(c => c.id === toId)!;
  const amtN     = parseFloat(amount) || 0;
  const samePair = fromId === toId;

  function flip() { setFromId(toId); setToId(fromId); setResult(null); setEstimate(null); }

  function buildFd() {
    const f = new FormData();
    f.set("fromChain", fromId); f.set("toChain", toId); f.set("amount", amount);
    if (showRecip && recipient) f.set("recipient", recipient);
    return f;
  }

  async function handleEstimate() {
    if (!amount || amtN <= 0) return;
    setEstimating(true); setEstimate(null);
    const res = await estimateBridge(buildFd());
    if (res.success && res.data) setEstimate(res.data as Record<string,unknown>);
    else setEstimate({ error: res.error });
    setEstimating(false);
  }

  async function handleBridge() {
    if (!amount || amtN <= 0 || samePair) return;
    setLoading(true); setResult(null); setStatus("Connecting to Circle App Kit…");
    const res = await bridgeTokens(buildFd());
    setResult(res);
    setLoading(false); setStatus("");
    if (res.success) setAmount("");
  }

  // Parse steps from result
  const steps: Array<{ name:string; state:string; txHash?:string; data?:Record<string,string> }> =
    result?.success && result.data && typeof result.data === "object"
      ? ((result.data as Record<string,unknown>).steps as typeof steps) ?? []
      : [];

  return (
    <div className="fade-in" style={{ maxWidth:520, margin:"0 auto", padding:"20px 24px" }}>
      <div style={{ marginBottom:22 }}>
        <h1 style={{ fontSize:26, fontWeight:800, letterSpacing:-0.5, marginBottom:4 }}>Bridge</h1>
        <p style={{ fontSize:13, color:"var(--text2)" }}>Cross-chain USDC transfer · powered by Circle CCTP via Arc App Kit</p>
      </div>

      {/* Setup notice if no key */}
      <div style={{
        background:"rgba(245,166,35,0.07)", border:"1px solid rgba(245,166,35,0.2)",
        borderRadius:14, padding:"12px 16px", marginBottom:16,
        display:"flex", gap:10, alignItems:"flex-start",
      }}>
        <span style={{ fontSize:16, flexShrink:0 }}>🔑</span>
        <div style={{ fontSize:12, color:"var(--text2)", fontFamily:"var(--mono)", lineHeight:1.7 }}>
          <strong style={{ color:"var(--orange)" }}>Requires server credentials in .env.local:</strong><br/>
          <code style={{ color:"var(--cyan)" }}>PRIVATE_KEY=0x…</code> &nbsp;
          <code style={{ color:"var(--cyan)" }}>KIT_KEY=KIT_KEY:…</code><br/>
          Get them at{" "}
          <a href="https://console.circle.com" target="_blank" rel="noopener noreferrer"
            style={{ color:"var(--cyan)", textDecoration:"none" }}>console.circle.com ↗</a>
          {" "}· Bridge is signed server-side — the recipient wallet receives USDC automatically.
        </div>
      </div>

      <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:20, padding:22 }}>

        {/* FROM */}
        <div style={{ marginBottom:12 }}>
          <p style={{ fontSize:10, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", letterSpacing:"0.8px", fontFamily:"var(--mono)", marginBottom:10 }}>From</p>
          <div style={{ display:"flex", gap:8 }}>
            {CHAINS.map(c => (
              <ChainCard key={c.id} chain={c} selected={fromId===c.id}
                onClick={() => { if(c.id===toId) setToId(fromId); setFromId(c.id); setResult(null); setEstimate(null); }}/>
            ))}
          </div>
        </div>

        {/* Flip */}
        <div style={{ display:"flex", justifyContent:"center", margin:"10px 0" }}>
          <button onClick={flip} style={{
            display:"flex", alignItems:"center", gap:8, padding:"8px 20px",
            borderRadius:50, border:"1px solid var(--border)", background:"var(--bg2)",
            color:"var(--text1)", fontFamily:"var(--mono)", fontSize:13, fontWeight:600,
            cursor:"pointer", transition:"all 0.2s",
          }}>⇅ Flip direction</button>
        </div>

        {/* TO */}
        <div style={{ marginBottom:20 }}>
          <p style={{ fontSize:10, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", letterSpacing:"0.8px", fontFamily:"var(--mono)", marginBottom:10 }}>To</p>
          <div style={{ display:"flex", gap:8 }}>
            {CHAINS.map(c => (
              <ChainCard key={c.id} chain={c} selected={toId===c.id}
                onClick={() => { if(c.id===fromId) setFromId(toId); setToId(c.id); setResult(null); setEstimate(null); }}/>
            ))}
          </div>
        </div>

        {/* Route visual */}
        <div style={{
          display:"flex", alignItems:"center", gap:12,
          background:"var(--bg2)", border:"1px solid var(--border)",
          borderRadius:12, padding:"12px 16px", marginBottom:20,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:from.color, boxShadow:`0 0 5px ${from.color}` }}/>
            <span style={{ fontSize:13, fontWeight:600 }}>{from.label}</span>
          </div>
          <div style={{ flex:1, position:"relative", display:"flex", alignItems:"center" }}>
            <div style={{ flex:1, borderTop:"1px dashed var(--border2)" }}/>
            <span style={{ position:"absolute", left:"50%", transform:"translateX(-50%)", background:"var(--bg2)", padding:"0 8px", fontSize:10, fontWeight:700, color:"var(--cyan)", fontFamily:"var(--mono)" }}>CCTP</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:to.color, boxShadow:`0 0 5px ${to.color}` }}/>
            <span style={{ fontSize:13, fontWeight:600 }}>{to.label}</span>
          </div>
        </div>

        {samePair && (
          <div style={{ background:"rgba(224,65,90,0.08)", border:"1px solid rgba(224,65,90,0.22)", borderRadius:10, padding:"10px 14px", marginBottom:14, fontSize:12, color:"var(--red)", fontFamily:"var(--mono)" }}>
            ⚠ Source and destination must be different networks.
          </div>
        )}

        {/* Amount */}
        <div style={{ marginBottom:16 }}>
          <p style={{ fontSize:10, fontWeight:700, color:"var(--text2)", textTransform:"uppercase", letterSpacing:"0.8px", fontFamily:"var(--mono)", marginBottom:8 }}>Amount (USDC)</p>
          <div className="token-box">
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <input type="number" placeholder="0.00" step="0.01" min="0.01"
                value={amount} onChange={e => { setAmount(e.target.value); setResult(null); setEstimate(null); }}
                style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:28, fontWeight:700, color:"var(--text0)", fontFamily:"var(--mono)", minWidth:0 }}/>
              <div style={{ display:"flex", alignItems:"center", gap:7, background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:50, padding:"7px 14px 7px 8px", flexShrink:0 }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background:"#2775CA", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff" }}>US</div>
                <span style={{ fontSize:13, fontWeight:700 }}>USDC</span>
              </div>
            </div>
            <div style={{ fontSize:12, color:"var(--text2)", marginTop:8, fontFamily:"var(--mono)" }}>
              {amtN > 0 ? `≈ $${amount} USD` : "$0.00"}
            </div>
          </div>
        </div>

        {/* Optional recipient */}
        <div style={{ marginBottom:20 }}>
          <button onClick={() => setShowRecip(s => !s)} style={{
            background:"none", border:"none", color:"var(--text2)", cursor:"pointer",
            fontSize:12, fontFamily:"var(--mono)", display:"flex", alignItems:"center", gap:4,
          }}>
            {showRecip ? "▾" : "▸"} Send to different address (optional)
          </button>
          {showRecip && (
            <div style={{ marginTop:8 }}>
              <input type="text" placeholder="0x… recipient address on destination chain"
                value={recipient} onChange={e => setRecipient(e.target.value)}
                style={{
                  width:"100%", background:"var(--bg2)", border:"1px solid var(--border2)",
                  borderRadius:10, padding:"11px 14px", color:"var(--text0)",
                  fontFamily:"var(--mono)", fontSize:13, outline:"none",
                }}/>
              <p style={{ fontSize:11, color:"var(--text2)", marginTop:4, fontFamily:"var(--mono)" }}>
                Leave empty to send to the server wallet address configured in .env.local
              </p>
            </div>
          )}
        </div>

        {/* Fee estimate display */}
        {estimate && !('error' in estimate) && (
          <div className="fade-in" style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", marginBottom:16 }}>
            <p style={{ fontSize:11, fontWeight:700, color:"var(--cyan)", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.5px", fontFamily:"var(--mono)" }}>Fee Estimate</p>
            {Array.isArray(estimate.fees) && (estimate.fees as Array<Record<string,string>>).map((fee, i) => (
              <Row key={i} k={`${fee.type} fee`} v={`${fee.amount} ${fee.token ?? "USDC"}`}/>
            ))}
            {estimate.estimatedTime != null && <Row k="Est. time" v={String(estimate.estimatedTime as string)}/>}
            {estimate.from != null && <Row k="Route" v={`${String(estimate.from as string)} → ${String((estimate as Record<string,unknown>).to as string)}`} accent/>}
            {estimate.note != null && <p style={{ fontSize:11, color:"var(--orange)", marginTop:8, fontFamily:"var(--mono)" }}>⚠ {String(estimate.note as string)}</p>}
          </div>
        )}
        {estimate && 'error' in estimate && (
          <div style={{ background:"rgba(224,65,90,0.08)", border:"1px solid rgba(224,65,90,0.2)", borderRadius:10, padding:"10px 14px", marginBottom:16, fontSize:12, color:"var(--red)", fontFamily:"var(--mono)" }}>
            {String(estimate.error)}
          </div>
        )}

        {/* Summary */}
        {amtN > 0 && !samePair && !estimate && (
          <div className="fade-in" style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:12, padding:"12px 16px", marginBottom:16 }}>
            <Row k="You send"    v={`${amount} USDC on ${from.label}`}/>
            <Row k="You receive" v={`${amount} USDC on ${to.label}`}/>
            <Row k="Est. time"   v="~5–15 minutes"/>
            <Row k="Protocol"    v="Circle CCTP v1" accent/>
          </div>
        )}

        {/* Status */}
        {loading && status && (
          <div style={{ marginBottom:14, padding:"10px 14px", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, fontSize:12, color:"var(--cyan)", fontFamily:"var(--mono)", display:"flex", alignItems:"center", gap:8 }}>
            <span className="spinner" style={{ borderTopColor:"var(--cyan)" }}/>{status}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          <button disabled={estimating || !amount || amtN <= 0} onClick={handleEstimate} style={{
            padding:14, borderRadius:12, border:"1px solid var(--border)",
            background:"var(--bg2)", color:estimating||!amount?"var(--text2)":"var(--text0)",
            fontFamily:"var(--mono)", fontSize:14, fontWeight:600,
            cursor:estimating||!amount?"not-allowed":"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6, transition:"all 0.2s",
          }}>
            {estimating && <span className="spinner" style={{ borderTopColor:"var(--cyan)" }}/>}
            {estimating ? "Estimating…" : "Estimate Fee"}
          </button>
          <button disabled={loading || !amount || amtN <= 0 || samePair} onClick={handleBridge}
            className={!loading && amount && amtN > 0 && !samePair ? "swap-btn ready" : "swap-btn disabled-state"}
            style={{ margin:0 }}>
            {loading && <span className="spinner"/>}
            {loading ? "Bridging…" : `Bridge ${amtN > 0 ? amount+" " : ""}USDC →`}
          </button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="fade-in" style={{
          marginTop:14, background:"var(--bg1)",
          border:`1px solid ${result.success ? "rgba(0,200,150,0.3)" : "rgba(224,65,90,0.3)"}`,
          borderRadius:16, padding:"16px 18px",
        }}>
          {result.success ? (
            <>
              <p style={{ fontWeight:700, fontSize:13, color:"var(--green)", marginBottom:12 }}>✅ Bridge Complete</p>
              {/* Show each step with explorer link */}
              {steps.length > 0 ? steps.map((step, i) => (
                <div key={i} style={{ marginBottom:12, padding:"10px 12px", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:12, fontWeight:700, color:"var(--cyan)", fontFamily:"var(--mono)", textTransform:"uppercase" }}>{step.name}</span>
                    <span style={{ fontSize:11, fontWeight:600, color: step.state==="success"?"var(--green)":"var(--orange)", fontFamily:"var(--mono)" }}>
                      {step.state === "success" ? "✓ Success" : step.state}
                    </span>
                  </div>
                  {step.data?.explorerUrl && (
                    <a href={step.data.explorerUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:11, color:"var(--cyan)", fontFamily:"var(--mono)", textDecoration:"none" }}>
                      🔍 View on Explorer ↗
                    </a>
                  )}
                </div>
              )) : (
                <details>
                  <summary style={{ fontSize:12, color:"var(--text2)", cursor:"pointer", fontFamily:"var(--mono)" }}>View raw response</summary>
                  <pre style={{ fontSize:11, color:"var(--text1)", overflow:"auto", maxHeight:200, background:"rgba(0,0,0,0.3)", borderRadius:8, padding:10, marginTop:8 }}>
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </details>
              )}
            </>
          ) : (
            <>
              <p style={{ fontWeight:700, fontSize:13, color:"var(--red)", marginBottom:8 }}>❌ Bridge Failed</p>
              <p style={{ fontSize:12, color:"var(--text2)", fontFamily:"var(--mono)", lineHeight:1.65 }}>{result.error}</p>
              {result.needsKey && (
                <div style={{ marginTop:10, padding:"10px 12px", background:"rgba(245,166,35,0.08)", border:"1px solid rgba(245,166,35,0.2)", borderRadius:8 }}>
                  <p style={{ fontSize:12, color:"var(--orange)", fontFamily:"var(--mono)", lineHeight:1.65 }}>
                    <strong>Setup required:</strong><br/>
                    1. Open <code>.env.local</code> in your project folder<br/>
                    2. Set <code>PRIVATE_KEY=0x...</code> (your wallet private key)<br/>
                    3. Set <code>KIT_KEY=KIT_KEY:...</code> (from console.circle.com)<br/>
                    4. Restart server: <code>npm run dev</code>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
