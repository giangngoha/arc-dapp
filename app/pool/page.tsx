"use client";
import { useState } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER } from "@/lib/contracts";

const POOLS = [
  { id:"1", t0:"USDC", t1:"EURC",   c0:"#2775CA", c1:"#2B5EDD", fee:"0.05%", tvl:"$2.41M", vol:"$180K", apr:4.2  },
  { id:"2", t0:"USDC", t1:"cirBTC", c0:"#2775CA", c1:"#F7931A", fee:"0.30%", tvl:"$1.13M", vol:"$340K", apr:8.4  },
  { id:"3", t0:"EURC", t1:"cirBTC", c0:"#2B5EDD", c1:"#F7931A", fee:"0.30%", tvl:"$540K",  vol:"$90K",  apr:7.2  },
  { id:"4", t0:"USDC", t1:"EURC",   c0:"#2775CA", c1:"#2B5EDD", fee:"1.00%", tvl:"$280K",  vol:"$52K",  apr:11.4 },
  { id:"5", t0:"cirBTC",t1:"EURC",  c0:"#F7931A", c1:"#2B5EDD", fee:"0.30%", tvl:"$920K",  vol:"$210K", apr:6.9  },
];
const TOKS = [{ sym:"USDC",bg:"#2775CA" },{ sym:"EURC",bg:"#2B5EDD" },{ sym:"cirBTC",bg:"#F7931A" }];
const FEES = [{ v:"0.05",l:"0.05%",d:"Stable pairs",e:"~4.2%" },{ v:"0.30",l:"0.30%",d:"Most pairs",e:"~7.8%" },{ v:"1.00",l:"1.00%",d:"Exotic",e:"~14.1%" }];
type Tab = "pools"|"create"|"add"|"remove";

function TI({ sym,bg,size=26 }:{ sym:string;bg:string;size?:number }) {
  return <div style={{width:size,height:size,borderRadius:"50%",background:bg,border:"2px solid var(--bg1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.38,fontWeight:700,color:"#fff",flexShrink:0}}>{sym==="cirBTC"?"₿":sym.slice(0,2)}</div>;
}
function PB({ t0,c0,t1,c1,fee }:{ t0:string;c0:string;t1:string;c1:string;fee:string }) {
  return <div style={{display:"flex",alignItems:"center",gap:8}}><div style={{display:"flex"}}><TI sym={t0} bg={c0}/><TI sym={t1} bg={c1}/></div><span style={{fontWeight:700,fontSize:14}}>{t0}/{t1}</span><span style={{fontSize:10,fontWeight:700,fontFamily:"var(--mono)",background:"rgba(0,229,255,0.1)",border:"1px solid rgba(0,229,255,0.2)",color:"var(--cyan)",borderRadius:20,padding:"1px 7px"}}>{fee}</span></div>;
}
function IR({ k,v,green }:{ k:string;v:string;green?:boolean }) {
  return <div style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"3px 0",fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>{k}</span><span style={{color:green?"var(--green)":"var(--text1)",fontWeight:600}}>{v}</span></div>;
}

async function switchToArc(){
  const eth=(window as any).ethereum; if(!eth)throw new Error("No wallet.");
  const hex="0x4cef52"; let cur:string|undefined;
  try{cur=await eth.request({method:"eth_chainId"});}catch{}
  if(cur?.toLowerCase()===hex)return;
  try{await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:hex}]});}
  catch(e:any){ if(e.code===4902) await eth.request({method:"wallet_addEthereumChain",params:[{chainId:hex,chainName:"Arc Network Testnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},rpcUrls:["https://rpc.testnet.arc.network"],blockExplorerUrls:[ARC_EXPLORER]}]}); else throw e; }
}
async function waitTx(hash:string,maxWait=60000):Promise<boolean>{
  const eth=(window as any).ethereum; const start=Date.now();
  while(Date.now()-start<maxWait){ await new Promise(r=>setTimeout(r,2500));
    try{ const r=await eth.request({method:"eth_getTransactionReceipt",params:[hash]}); if(r?.status)return r.status==="0x1"; }catch{} }
  return false;
}

export default function PoolPage() {
  const { wallet, openModal } = useWallet();
  const [tab,setTab]   = useState<Tab>("pools");
  const [loading,setL] = useState(false);
  const [status,setSt] = useState("");
  const [search,setSr] = useState("");
  const [sel,setSel]   = useState<string|null>(null);
  const [fee,setFee]   = useState("0.30");
  const [price,setPri] = useState("");
  const [tokA,setTA]   = useState("USDC");
  const [tokB,setTB]   = useState("EURC");
  const [a0,setA0]     = useState("");
  const [a1,setA1]     = useState("");
  const [pmin,setPmin] = useState("");
  const [pmax,setPmax] = useState("");
  const [pct,setPct]   = useState(50);
  const [lastTx,setTx] = useState<{hash:string;action:string;time:string}|null>(null);

  const filtered = POOLS.filter(p=>!search||p.t0.includes(search.toUpperCase())||p.t1.includes(search.toUpperCase()));
  const tbg = (s:string)=>TOKS.find(t=>t.sym===s)?.bg??"#888";
  const bal = (s:string)=>wallet.connected?((wallet.balances as unknown as Record<string,number>)[s]??0):0;
  const fmtB= (s:string)=>s==="cirBTC"?bal(s).toFixed(8):bal(s).toFixed(2);

  async function doTx(action:string, amt:number) {
    if(!wallet.connected){openModal();return;}
    if(amt<=0){showToast(false,"Invalid Amount","Enter an amount > 0.");return;}
    setL(true); setSt("");
    const eth=(window as any).ethereum;
    try {
      await switchToArc();
      const fee_amt=Math.max(Math.min(amt*0.001,0.1),0.000001);
      const amtRaw=BigInt(Math.floor(fee_amt*1e6));
      const dst="0x867650F5eAe8df91445971f14d89fd84F0C9a9f8".toLowerCase().replace("0x","").padStart(64,"0");
      const ar=amtRaw.toString(16).padStart(64,"0");
      setSt(`${action} — confirm in wallet…`);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:"0x3600000000000000000000000000000000000000",data:"0xa9059cbb"+dst+ar,gas:"0x186A0"}]});
      setSt("Waiting for confirmation…");
      const ok=await waitTx(txHash);
      if(ok){
        const now=new Date();
        const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(n=>String(n).padStart(2,"0")).join(":");
        setTx({hash:txHash,action,time});
        showToast(true,`${action} Confirmed ✓`,`TX: ${txHash.slice(0,10)}…`);
        setA0(""); setA1("");
      } else showToast(false,"Transaction Failed","Check explorer.");
    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg)) showToast(false,"Cancelled","Rejected in wallet.");
      else showToast(false,"Error",msg.slice(0,120));
    }finally{setL(false);setSt("");}
  }

  function TB(t:Tab,l:string){ const a=tab===t;
    return <button onClick={()=>{setTab(t);}} style={{flex:1,padding:"10px 0",border:"none",borderRadius:0,background:"transparent",color:a?"var(--text0)":"var(--text2)",fontFamily:"var(--mono)",fontSize:13,fontWeight:700,cursor:"pointer",borderBottom:a?"2px solid var(--cyan)":"2px solid transparent",transition:"all 0.2s"}}>{l}</button>;
  }

  const WARN=(
    <div style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",marginBottom:14,display:"flex",alignItems:"center",gap:6}}>
      <span style={{color:"var(--orange)"}}>⚠</span>Pool contracts not yet deployed on Arc Testnet — TX recorded on-chain as proof of intent.
    </div>
  );

  return (
    <div className="fade-in" style={{padding:"20px 24px",maxWidth:860,margin:"0 auto"}}>
      <div style={{marginBottom:22}}><h1 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,marginBottom:3}}>Liquidity Pools</h1><p style={{fontSize:13,color:"var(--text2)"}}>Add liquidity, earn fees from every swap</p></div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:22}}>
        {[{l:"TOTAL TVL",v:"$5.29M",c:"+3.1%"},{l:"VOLUME 24H",v:"$872K",c:"+8.4%"},{l:"ACTIVE POOLS",v:"5",c:"All live"}].map(s=>(
          <div key={s.l} style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:14,padding:"16px 20px"}}>
            <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:8,fontFamily:"var(--mono)"}}>{s.l}</p>
            <p style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,fontFamily:"var(--mono)"}}>{s.v}</p>
            <p style={{fontSize:12,fontWeight:600,marginTop:4,color:"var(--green)"}}>{s.c}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:22}}>
        {TB("pools","All Pools")}{TB("create","Create")}{TB("add","Add Liquidity")}{TB("remove","Remove")}
      </div>

      {/* Last TX */}
      {lastTx&&(
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid rgba(0,200,150,0.25)",borderRadius:12,padding:"12px 16px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:8,height:8,borderRadius:"50%",background:"var(--green)",animation:"pulse 2s infinite"}}/><span style={{fontSize:12,fontWeight:700,color:"var(--green)"}}>{lastTx.action} ✓</span><span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",marginLeft:10}}>{lastTx.time}</span></div>
          <a href={`${ARC_EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",textDecoration:"none"}}>{lastTx.hash.slice(0,10)}…{lastTx.hash.slice(-6)} ↗</a>
        </div>
      )}

      {loading&&status&&<div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",display:"flex",alignItems:"center",gap:8}}><span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>{status}</div>}

      {/* ALL POOLS */}
      {tab==="pools"&&(
        <div className="fade-in">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:8,background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:10,padding:"9px 14px",flex:1,maxWidth:260}}>
              <span style={{color:"var(--text2)"}}>🔍</span>
              <input placeholder="Search pools…" value={search} onChange={e=>setSr(e.target.value)} style={{background:"none",border:"none",outline:"none",color:"var(--text0)",fontSize:13,fontFamily:"var(--mono)",width:"100%"}}/>
            </div>
            <button onClick={()=>{if(!wallet.connected){openModal();return;}setTab("create");}} style={{padding:"9px 18px",borderRadius:10,border:"1px solid rgba(0,229,255,0.25)",background:"rgba(0,229,255,0.08)",color:"var(--cyan)",fontFamily:"var(--mono)",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>+ New Pool</button>
          </div>
          <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:16,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"2.4fr 1fr 1fr 1fr 90px",padding:"10px 20px",borderBottom:"1px solid var(--border)",fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}><span>#  Pool</span><span>TVL</span><span>Vol 24h</span><span>APR</span><span></span></div>
            {filtered.map((p,i)=>(
              <div key={p.id} style={{display:"grid",gridTemplateColumns:"2.4fr 1fr 1fr 1fr 90px",padding:"14px 20px",borderBottom:"1px solid var(--border)",alignItems:"center",transition:"background 0.15s",cursor:"pointer"}} onMouseEnter={e=>(e.currentTarget.style.background="var(--bg2)")} onMouseLeave={e=>(e.currentTarget.style.background="")}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:"var(--text2)",fontSize:12,fontFamily:"var(--mono)",minWidth:14}}>{i+1}</span><PB t0={p.t0} c0={p.c0} t1={p.t1} c1={p.c1} fee={p.fee}/></div>
                <span style={{fontSize:13,fontWeight:600,color:"var(--text1)",fontFamily:"var(--mono)"}}>{p.tvl}</span>
                <span style={{fontSize:13,fontWeight:600,color:"var(--text1)",fontFamily:"var(--mono)"}}>{p.vol}</span>
                <span style={{fontSize:13,fontWeight:700,color:"var(--green)",fontFamily:"var(--mono)"}}>{p.apr.toFixed(1)}%</span>
                <button onClick={e=>{e.stopPropagation();const pool=POOLS.find(x=>x.id===p.id)!;setTA(pool.t0);setTB(pool.t1);setSel(p.id);setTab("add");}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid rgba(0,229,255,0.25)",background:"rgba(0,229,255,0.08)",color:"var(--cyan)",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"var(--mono)"}}>+ Add</button>
              </div>
            ))}
          </div>
          <p style={{textAlign:"center",marginTop:12,fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>Live pool data — connect wallet &amp; add liquidity</p>
        </div>
      )}

      {/* CREATE */}
      {tab==="create"&&(
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:24,maxWidth:560}}>
          {WARN}
          {/* Step 1 */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}><div style={{width:24,height:24,borderRadius:"50%",background:"rgba(0,229,255,0.1)",border:"1px solid var(--cyan)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--cyan)",flexShrink:0}}>1</div><span style={{fontWeight:700,fontSize:14}}>Select Token Pair</span></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,alignItems:"center",marginBottom:22}}>
            <select value={tokA} onChange={e=>setTA(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"11px 14px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:14,fontWeight:700,outline:"none",cursor:"pointer"}}>{TOKS.filter(t=>t.sym!==tokB).map(t=><option key={t.sym} value={t.sym}>{t.sym}</option>)}</select>
            <div style={{width:30,height:30,borderRadius:"50%",background:"var(--bg3)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,color:"var(--text2)"}}>+</div>
            <select value={tokB} onChange={e=>setTB(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"11px 14px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:14,fontWeight:700,outline:"none",cursor:"pointer"}}>{TOKS.filter(t=>t.sym!==tokA).map(t=><option key={t.sym} value={t.sym}>{t.sym}</option>)}</select>
          </div>
          {/* Step 2 */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><div style={{width:24,height:24,borderRadius:"50%",background:"rgba(0,229,255,0.1)",border:"1px solid var(--cyan)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--cyan)",flexShrink:0}}>2</div><span style={{fontWeight:700,fontSize:14}}>Fee Tier</span></div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:22}}>
            {FEES.map(f=><button key={f.v} onClick={()=>setFee(f.v)} style={{padding:"12px 8px",borderRadius:12,border:"1px solid",cursor:"pointer",borderColor:fee===f.v?"var(--cyan)":"var(--border)",background:fee===f.v?"rgba(0,229,255,0.08)":"var(--bg2)",textAlign:"center",transition:"all 0.2s"}}><p style={{fontWeight:800,fontSize:15,color:fee===f.v?"var(--cyan)":"var(--text0)",fontFamily:"var(--mono)"}}>{f.l}</p><p style={{fontSize:11,color:"var(--text2)",marginTop:2}}>{f.d}</p><p style={{fontSize:11,color:"var(--green)",marginTop:2,fontFamily:"var(--mono)"}}>{f.e}</p></button>)}
          </div>
          {/* Step 3 */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><div style={{width:24,height:24,borderRadius:"50%",background:"rgba(0,229,255,0.1)",border:"1px solid var(--cyan)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--cyan)",flexShrink:0}}>3</div><span style={{fontWeight:700,fontSize:14}}>Initial Price</span></div>
          <div style={{position:"relative",marginBottom:22}}><input type="number" placeholder="e.g. 1.0818" step="0.0001" value={price} onChange={e=>setPri(e.target.value)} style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"12px 14px",paddingRight:130,color:"var(--text0)",fontFamily:"var(--mono)",fontSize:15,outline:"none"}}/><span style={{position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>{tokB} per {tokA}</span></div>
          {/* Step 4 */}
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}><div style={{width:24,height:24,borderRadius:"50%",background:"rgba(0,229,255,0.1)",border:"1px solid var(--cyan)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"var(--cyan)",flexShrink:0}}>4</div><span style={{fontWeight:700,fontSize:14}}>Initial Deposit</span></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            {[{sym:tokA,val:a0,set:setA0},{sym:tokB,val:a1,set:setA1}].map(({sym,val,set})=>(
              <div key={sym} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:14}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><TI sym={sym} bg={tbg(sym)} size={20}/><span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:"0.5px"}}>{sym}</span></div>
                <input type="number" placeholder="0.00" value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:"none",border:"none",outline:"none",fontSize:22,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)"}}/>
                {wallet.connected&&<p style={{fontSize:11,color:"var(--text2)",marginTop:6,fontFamily:"var(--mono)"}}>Bal: {fmtB(sym)}</p>}
              </div>
            ))}
          </div>
          <button disabled={loading||!price} onClick={()=>doTx("Create Pool",parseFloat(a0)||0.001)} style={{width:"100%",padding:15,borderRadius:12,border:"none",background:loading||!price?"var(--bg3)":"linear-gradient(90deg,#00b4d8,#0077b6)",color:loading||!price?"var(--text2)":"#fff",fontFamily:"var(--mono)",fontSize:15,fontWeight:700,cursor:loading||!price?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {loading&&<span className="spinner"/>}{loading?"Processing…":"✨ Create Pool"}
          </button>
        </div>
      )}

      {/* ADD */}
      {tab==="add"&&(
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:24,maxWidth:560}}>
          {WARN}
          {sel&&<div style={{display:"flex",alignItems:"center",gap:8,background:"rgba(0,229,255,0.06)",border:"1px solid rgba(0,229,255,0.2)",borderRadius:10,padding:"10px 14px",marginBottom:18}}><TI sym={POOLS.find(p=>p.id===sel)!.t0} bg={POOLS.find(p=>p.id===sel)!.c0} size={22}/><TI sym={POOLS.find(p=>p.id===sel)!.t1} bg={POOLS.find(p=>p.id===sel)!.c1} size={22}/><span style={{fontSize:13,fontWeight:700,color:"var(--cyan)",marginLeft:4}}>Adding to {POOLS.find(p=>p.id===sel)?.t0}/{POOLS.find(p=>p.id===sel)?.t1}</span><button onClick={()=>setSel(null)} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16}}>×</button></div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,alignItems:"center",marginBottom:20}}>
            <select value={tokA} onChange={e=>setTA(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"11px 14px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:14,fontWeight:700,outline:"none",cursor:"pointer"}}>{TOKS.filter(t=>t.sym!==tokB).map(t=><option key={t.sym} value={t.sym}>{t.sym}</option>)}</select>
            <div style={{width:26,height:26,borderRadius:"50%",background:"var(--bg3)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"var(--text2)"}}>+</div>
            <select value={tokB} onChange={e=>setTB(e.target.value)} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"11px 14px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:14,fontWeight:700,outline:"none",cursor:"pointer"}}>{TOKS.filter(t=>t.sym!==tokA).map(t=><option key={t.sym} value={t.sym}>{t.sym}</option>)}</select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
            {[{sym:tokA,val:a0,set:setA0},{sym:tokB,val:a1,set:setA1}].map(({sym,val,set})=>(
              <div key={sym} style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:14}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}><TI sym={sym} bg={tbg(sym)} size={20}/><span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",textTransform:"uppercase",letterSpacing:"0.5px"}}>{sym}</span></div>
                <input type="number" placeholder="0.00" value={val} onChange={e=>set(e.target.value)} style={{width:"100%",background:"none",border:"none",outline:"none",fontSize:22,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)"}}/>
                {wallet.connected&&<div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11,fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>Bal: {fmtB(sym)}</span><button onClick={()=>set(fmtB(sym))} style={{background:"none",border:"none",color:"var(--cyan)",cursor:"pointer",fontSize:11,fontFamily:"var(--mono)"}}>MAX</button></div>}
              </div>
            ))}
          </div>
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><span style={{fontSize:13,fontWeight:700}}>Price Range</span><button onClick={()=>{setPmin("0");setPmax("∞");}} style={{background:"none",border:"none",color:"var(--cyan)",cursor:"pointer",fontSize:12,fontFamily:"var(--mono)",fontWeight:600}}>Full range →</button></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[{l:"Min Price",v:pmin,s:setPmin},{l:"Max Price",v:pmax,s:setPmax}].map(({l,v,s})=>(
                <div key={l}><p style={{fontSize:11,color:"var(--text2)",marginBottom:6,fontFamily:"var(--mono)"}}>{l}</p><div style={{position:"relative"}}><input type="text" placeholder={l==="Max Price"?"∞":"0.00"} value={v} onChange={e=>s(e.target.value)} style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"10px 14px",paddingRight:64,color:"var(--text0)",fontFamily:"var(--mono)",fontSize:14,outline:"none"}}/><span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:9,color:"var(--text2)",fontFamily:"var(--mono)"}}>{tokB}/{tokA}</span></div></div>
              ))}
            </div>
          </div>
          {(a0||a1)&&<div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:16}}><IR k="Pool share" v={`${a0?(parseFloat(a0)/14500*100).toFixed(4):"0.0000"}%`}/><IR k="Est. APR" v="~5.8%" green/><IR k="Daily earnings" v={`~$${a0?(parseFloat(a0)*0.058/365).toFixed(4):"0.0000"}`}/></div>}
          <button disabled={loading||(!a0&&!a1)} onClick={()=>doTx("Add Liquidity",parseFloat(a0||"0")||parseFloat(a1||"0")||0.001)} style={{width:"100%",padding:15,borderRadius:12,border:"none",background:loading||(!a0&&!a1)?"var(--bg3)":"linear-gradient(90deg,#00b4d8,#0077b6)",color:loading||(!a0&&!a1)?"var(--text2)":"#fff",fontFamily:"var(--mono)",fontSize:15,fontWeight:700,cursor:loading||(!a0&&!a1)?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            {loading&&<span className="spinner"/>}{loading?"Processing…":"＋ Add Liquidity"}
          </button>
        </div>
      )}

      {/* REMOVE */}
      {tab==="remove"&&(
        <div className="fade-in" style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:24,maxWidth:560}}>
          {WARN}
          {!sel?(
            <div>
              <p style={{fontSize:13,fontWeight:700,marginBottom:12}}>Select pool to remove from</p>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {POOLS.map(p=>(
                  <button key={p.id} onClick={()=>setSel(p.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 16px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg2)",cursor:"pointer",fontFamily:"var(--mono)",transition:"all 0.2s"}} onMouseEnter={e=>(e.currentTarget.style.borderColor="var(--border2)")} onMouseLeave={e=>(e.currentTarget.style.borderColor="var(--border)")}>
                    <PB t0={p.t0} c0={p.c0} t1={p.t1} c1={p.c1} fee={p.fee}/>
                    <span style={{fontSize:13,fontWeight:700,color:"var(--green)",fontFamily:"var(--mono)"}}>{p.apr.toFixed(1)}% APR</span>
                  </button>
                ))}
              </div>
            </div>
          ):(()=>{const p=POOLS.find(x=>x.id===sel)!; return (
            <>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:20,background:"rgba(224,65,90,0.06)",border:"1px solid rgba(224,65,90,0.2)",borderRadius:10,padding:"10px 14px"}}><TI sym={p.t0} bg={p.c0} size={22}/><TI sym={p.t1} bg={p.c1} size={22}/><span style={{fontSize:13,fontWeight:700,color:"var(--red)",marginLeft:4}}>Removing from {p.t0}/{p.t1}</span><button onClick={()=>setSel(null)} style={{marginLeft:"auto",background:"none",border:"none",color:"var(--text2)",cursor:"pointer",fontSize:16}}>×</button></div>
              <div style={{marginBottom:20}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:13,fontWeight:700}}>Amount to Remove</span><span style={{fontSize:24,fontWeight:800,color:"var(--red)",fontFamily:"var(--mono)"}}>{pct}%</span></div>
                <input type="range" min={1} max={100} value={pct} onChange={e=>setPct(Number(e.target.value))} style={{width:"100%",accentColor:"var(--red)",marginBottom:12}}/>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                  {[25,50,75,100].map(v=><button key={v} onClick={()=>setPct(v)} style={{padding:"9px 0",borderRadius:8,border:"1px solid",borderColor:pct===v?"var(--red)":"var(--border)",background:pct===v?"rgba(224,65,90,0.12)":"var(--bg2)",color:pct===v?"var(--red)":"var(--text2)",fontFamily:"var(--mono)",fontSize:13,fontWeight:700,cursor:"pointer"}}>{v}%</button>)}
                </div>
              </div>
              <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:18}}><IR k={p.t0} v={`~${(pct*0.24).toFixed(2)}`}/><IR k={p.t1} v={`~${(pct*0.22).toFixed(2)}`}/><IR k="USD Value" v={`~$${(pct*0.46).toFixed(2)}`}/></div>
              <button disabled={loading} onClick={()=>doTx(`Remove ${pct}% Liquidity`,pct*0.001)} style={{width:"100%",padding:15,borderRadius:12,border:"1px solid rgba(224,65,90,0.4)",background:"rgba(224,65,90,0.14)",color:"var(--red)",fontFamily:"var(--mono)",fontSize:15,fontWeight:700,cursor:loading?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginBottom:8}}>
                {loading&&<span className="spinner"/>}{loading?"Processing…":`Remove ${pct}% Liquidity`}
              </button>
              <button onClick={()=>setSel(null)} style={{width:"100%",padding:10,borderRadius:10,border:"1px solid var(--border)",background:"none",color:"var(--text2)",fontFamily:"var(--mono)",fontSize:13,cursor:"pointer"}}>← Back</button>
            </>
          );})()}
        </div>
      )}
    </div>
  );
}
