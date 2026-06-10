"use client";
import { useState } from "react";
import { useWallet, getBal } from "./WalletProvider";

export const TOKENS = [
  { sym:"USDC",   name:"USD Coin",       bg:"#2775CA" },
  { sym:"EURC",   name:"Euro Coin",      bg:"#2B5EDD" },
  { sym:"cirBTC", name:"Circle Bitcoin", bg:"#F7931A" },
];
export const RATES: Record<string,number> = {
  "USDC-EURC":0.9245,"EURC-USDC":1.0818,
  "USDC-cirBTC":0.0000148,"cirBTC-USDC":67450,
  "EURC-cirBTC":0.0000136,"cirBTC-EURC":73500,
};
export function getRate(a:string,b:string){ return RATES[`${a}-${b}`]??1/(RATES[`${b}-${a}`]??1); }

interface Props { onSelect:(sym:string,bg:string)=>void; onClose:()=>void; exclude?:string }
export default function TokenSelectModal({ onSelect,onClose,exclude }:Props) {
  const { wallet } = useWallet();
  const [q,setQ]   = useState("");
  const filtered   = TOKENS.filter(t=>t.sym!==exclude&&(!q||t.sym.toLowerCase().includes(q.toLowerCase())||t.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box fade-in" onClick={e=>e.stopPropagation()} style={{maxWidth:380}}>
        <div className="modal-head"><h2 className="modal-title">Select Token</h2><button className="close-x" onClick={onClose}>×</button></div>
        <input autoFocus className="tok-search" placeholder="Search token…" value={q} onChange={e=>setQ(e.target.value)}/>
        {filtered.map(t=>{
          const bal = wallet.connected ? getBal(wallet.balances,t.sym) : null;
          return (
            <div key={t.sym} className="tok-item" onClick={()=>{onSelect(t.sym,t.bg);onClose();}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:t.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>
                {t.sym==="cirBTC"?"₿":t.sym.slice(0,2)}
              </div>
              <div>
                <p style={{fontWeight:700,fontSize:14}}>{t.sym}</p>
                <p style={{fontSize:12,color:"var(--text2)",fontFamily:"var(--mono)"}}>{t.name}</p>
              </div>
              <span className="tok-bal">{bal!==null?bal.toLocaleString(undefined,{maximumFractionDigits:t.sym==="cirBTC"?8:4}):"—"}</span>
            </div>
          );
        })}
        {filtered.length===0&&<p style={{color:"var(--text2)",fontSize:13,textAlign:"center",padding:"20px 0",fontFamily:"var(--mono)"}}>No tokens found</p>}
      </div>
    </div>
  );
}
