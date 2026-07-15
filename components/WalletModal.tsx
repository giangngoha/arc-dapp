"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";
const WALLETS = [
  { id:"MetaMask" as const, name:"MetaMask",     desc:"Browser extension wallet",        color:"#F6851B", icon:"🦊" },
  { id:"Rabby"    as const, name:"Rabby Wallet", desc:"Security-focused browser wallet", color:"#7148e8", icon:"🐰" },
];
export default function WalletModal() {
  const { modalOpen, closeModal, connect } = useWallet();
  const [loading, setLoading] = useState<string|null>(null);
  const [err, setErr]         = useState("");
  if (!modalOpen) return null;
  async function handle(id:"MetaMask"|"Rabby") {
    setErr(""); setLoading(id);
    try { await connect(id); } catch(e:unknown) { setErr(e instanceof Error ? e.message : String(e)); }
    setLoading(null);
  }
  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="modal-box fade-in" onClick={e=>e.stopPropagation()}>
        <div className="modal-head"><h2 className="modal-title">Connect Wallet</h2><button className="close-x" onClick={closeModal}>×</button></div>
        {WALLETS.map(w=>(
          <button key={w.id} className="wallet-opt" disabled={loading!==null} onClick={()=>handle(w.id)} style={{opacity:loading&&loading!==w.id?0.5:1}}>
            <div className="w-logo" style={{background:w.color}}>{w.icon}</div>
            <div><div className="w-name">{w.name}</div><div className="w-desc">{w.desc}</div></div>
            {loading===w.id&&<span className="w-status">Connecting…</span>}
          </button>
        ))}
        {err&&<p style={{fontSize:12,color:"var(--red)",marginTop:10,background:"rgba(224,65,90,0.08)",border:"1px solid rgba(224,65,90,0.2)",borderRadius:8,padding:"8px 12px",fontFamily:"var(--mono)"}}>⚠ {err}</p>}
        <p style={{textAlign:"center",fontSize:11,color:"var(--text2)",marginTop:14,fontFamily:"var(--mono)"}}>Testnet only — no real funds required</p>
      </div>
    </div>
  );
}