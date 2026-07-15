"use client";
import { useState, useEffect } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_RPC, ARC_EXPLORER } from "@/lib/contracts";

const BUILTIN = [
  { sym:"USDC",   name:"USD Coin",       bg:"#2775CA", addr:"0x3600000000000000000000000000000000000000", dec:6 },
  { sym:"EURC",   name:"Euro Coin",      bg:"#2B5EDD", addr:"0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", dec:6 },
  { sym:"cirBTC", name:"Circle Bitcoin", bg:"#F7931A", addr:"0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", dec:8 },
];

function isAddr(a:string){ return /^0x[0-9a-fA-F]{40}$/.test(a.trim()); }
function parseAbiStr(hex:string){ try{ const r=hex.slice(2); if(r.length<128)return""; const l=parseInt(r.slice(64,128),16); return Buffer.from(r.slice(128,128+l*2),"hex").toString("utf8").replace(/\0/g,"").trim(); }catch{return"";} }

async function switchToArc(){
  const eth=(window as any).ethereum; if(!eth)throw new Error("No wallet.");
  const hex="0x4cef52"; let cur:string|undefined;
  try{cur=await eth.request({method:"eth_chainId"});}catch{}
  if(cur?.toLowerCase()===hex)return;
  try{await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:hex}]});}
  catch(e:any){ if(e.code===4902) await eth.request({method:"wallet_addEthereumChain",params:[{chainId:hex,chainName:"Arc Network Testnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},rpcUrls:[ARC_RPC],blockExplorerUrls:[ARC_EXPLORER]}]}); else throw e; }
}

async function waitTx(hash:string,maxWait=90000):Promise<boolean>{
  const start=Date.now();
  while(Date.now()-start<maxWait){ await new Promise(r=>setTimeout(r,3000));
    try{
      const res=await fetch(ARC_RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_getTransactionReceipt",params:[hash]})});
      const j=await res.json();
      const r=j.result;
      if(r?.blockNumber) return r.status==="0x1"||r.status===1;
    }catch{}
  }
  return false;
}

export default function SendPage(){
  const { wallet, openModal, refreshBalances } = useWallet();
  // Token selection — unified (builtin + custom in one dropdown)
  const [selSym,   setSelSym]  = useState("USDC");
  const [custAddr, setCustAddr]= useState("");
  const [custInfo, setCustInfo]= useState<{sym:string;dec:number}|null>(null);
  const [fetching, setFetching]= useState(false);
  const [custBal,  setCustBal] = useState(0);
  const [showDrop, setShowDrop]= useState(false);
  const [recipient,setRecip]   = useState("");
  const [amount,   setAmt]     = useState("");
  const [sending,  setSend]    = useState(false);
  const [status,   setStat]    = useState("");
  const [lastTx,   setTx]      = useState<{hash:string;sym:string;amt:string;to:string}|null>(null);

  const isCustom   = selSym === "CUSTOM";
  const builtinTok = BUILTIN.find(t=>t.sym===selSym);
  const activeSym  = isCustom&&custInfo ? custInfo.sym : selSym;
  const activeDec  = isCustom&&custInfo ? custInfo.dec : (builtinTok?.dec??6);
  const activeAddr = isCustom ? custAddr : (builtinTok?.addr??"");
  const activeBg   = isCustom ? "#6b7280" : (builtinTok?.bg??"#888");
  const builtinBal = wallet.connected&&builtinTok ? getBal(wallet.balances,selSym) : 0;
  const bal        = isCustom ? custBal : builtinBal;
  const fmtBal     = activeDec>=8 ? bal.toFixed(8) : bal.toFixed(2);
  const amtN       = parseFloat(amount)||0;
  const validAddr  = isAddr(recipient);
  const canSend    = wallet.connected&&amtN>0&&validAddr&&!sending&&(!isCustom||(isCustom&&!!custInfo&&isAddr(custAddr)));

  useEffect(()=>{
    if(!custAddr||!isAddr(custAddr)){setCustInfo(null);return;}
    const eth=(window as any).ethereum; if(!eth)return;
    setFetching(true);
    const pad=custAddr.toLowerCase().replace("0x","").padStart(64,"0");
    Promise.all([
      eth.request({method:"eth_call",params:[{to:custAddr,data:"0x95d89b41"},"latest"]}),
      eth.request({method:"eth_call",params:[{to:custAddr,data:"0x313ce567"},"latest"]}),
      wallet.connected?eth.request({method:"eth_call",params:[{to:custAddr,data:"0x70a08231"+pad},"latest"]}):Promise.resolve("0x"),
    ]).then(([symHex,decHex,balHex]:[string,string,string])=>{
      const sym=parseAbiStr(symHex)||custAddr.slice(0,6)+"…";
      const dec=decHex&&decHex!=="0x"?parseInt(decHex,16):18;
      const b=balHex&&balHex!=="0x"?Number(BigInt(balHex))/10**dec:0;
      setCustInfo({sym,dec}); setCustBal(b);
    }).catch(()=>setCustInfo(null)).finally(()=>setFetching(false));
  },[custAddr,wallet.connected,wallet.address]);

  async function handleSend(){
    if(!wallet.connected){openModal();return;} if(!canSend)return;
    setSend(true); setStat(""); setTx(null);
    const eth=(window as any).ethereum;
    try{
      await switchToArc();
      const amtRaw=BigInt(Math.floor(amtN*10**activeDec));
      const dst=recipient.trim().toLowerCase().replace("0x","").padStart(64,"0");
      const amt=amtRaw.toString(16).padStart(64,"0");
      setStat(`Send ${amtN} ${activeSym} — confirm in wallet…`);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:activeAddr,data:"0xa9059cbb"+dst+amt,gas:"0x186A0"}]});
      setStat("Waiting for confirmation…");
      const ok=await waitTx(txHash);
      setTx({hash:txHash,sym:activeSym,amt:amount,to:recipient.trim()});
      if(ok){ showToast(true,"Send Confirmed ✓",`${amount} ${activeSym} sent`); setAmt(""); setRecip(""); if(!isCustom)await refreshBalances(); }
      else showToast(false,"Send Failed","Transaction reverted.");
    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg)) showToast(false,"Cancelled","Rejected in wallet.");
      else showToast(false,"Error",msg.slice(0,120));
    }finally{setSend(false);setStat("");}
  }

  return (
    <div className="fade-in" style={{maxWidth:480,margin:"0 auto",padding:"20px 24px"}}>
      <div style={{marginBottom:24}}><h1 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5}}>Send Tokens</h1></div>
      <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:22}}>

        {/* Amount + Token dropdown */}
        <div style={{marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <p style={{fontSize:11,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}>Amount</p>
            {wallet.connected&&!isCustom&&<span style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",fontWeight:600,cursor:"pointer"}} onClick={()=>setAmt(fmtBal)}>MAX: {fmtBal}</span>}
            {wallet.connected&&isCustom&&custInfo&&<span style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",fontWeight:600,cursor:"pointer"}} onClick={()=>setAmt(custBal.toFixed(custInfo.dec))}>MAX: {custBal.toFixed(4)}</span>}
          </div>
          <div className="token-box">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="number" placeholder="0.00" step={activeDec>=8?"0.00000001":"0.01"} value={amount} onChange={e=>setAmt(e.target.value)}
                style={{flex:1,background:"none",border:"none",outline:"none",fontSize:28,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)",minWidth:0}}/>

              {/* Token dropdown pill */}
              <div style={{position:"relative",flexShrink:0}}>
                <div className="token-pill" onClick={()=>setShowDrop(d=>!d)}>
                  <div className="token-circle" style={{background:activeBg}}>{activeSym==="cirBTC"?"₿":activeSym.slice(0,2)}</div>
                  <span className="token-sym-txt">{activeSym==="CUSTOM"?"Select…":activeSym}</span>
                  <span className="chev">▾</span>
                </div>
                {showDrop&&(
                  <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:8,zIndex:200,minWidth:200,boxShadow:"0 12px 40px rgba(0,0,0,0.5)"}}>
                    {/* Built-in tokens */}
                    {BUILTIN.map(t=>(
                      <button key={t.sym} onClick={()=>{setSelSym(t.sym);setShowDrop(false);setCustAddr("");setCustInfo(null);}} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:10,border:"none",background:selSym===t.sym?"var(--bg3)":"none",cursor:"pointer",fontFamily:"var(--mono)",transition:"background 0.15s"}}
                        onMouseEnter={e=>(e.currentTarget.style.background="var(--bg3)")} onMouseLeave={e=>(e.currentTarget.style.background=selSym===t.sym?"var(--bg3)":"none")}>
                        <div style={{width:28,height:28,borderRadius:"50%",background:t.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>{t.sym==="cirBTC"?"₿":t.sym.slice(0,2)}</div>
                        <div style={{textAlign:"left"}}><p style={{fontSize:13,fontWeight:700,color:"var(--text0)"}}>{t.sym}</p><p style={{fontSize:11,color:"var(--text2)"}}>{t.name}</p></div>
                        {wallet.connected&&<span style={{marginLeft:"auto",fontSize:11,color:"var(--text1)",fontFamily:"var(--mono)"}}>{getBal(wallet.balances,t.sym).toFixed(t.dec>=8?8:2)}</span>}
                      </button>
                    ))}
                    {/* Divider + custom */}
                    <hr style={{border:"none",borderTop:"1px solid var(--border)",margin:"6px 0"}}/>
                    <button onClick={()=>{setSelSym("CUSTOM");setShowDrop(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:10,border:"none",background:selSym==="CUSTOM"?"var(--bg3)":"none",cursor:"pointer",fontFamily:"var(--mono)"}}
                      onMouseEnter={e=>(e.currentTarget.style.background="var(--bg3)")} onMouseLeave={e=>(e.currentTarget.style.background=selSym==="CUSTOM"?"var(--bg3)":"none")}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:"var(--bg4)",border:"1px dashed var(--border2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:"var(--text2)",flexShrink:0}}>+</div>
                      <div style={{textAlign:"left"}}><p style={{fontSize:13,fontWeight:700,color:"var(--text0)"}}>Custom Token</p><p style={{fontSize:11,color:"var(--text2)"}}>Paste contract address</p></div>
                    </button>
                  </div>
                )}
                {showDrop&&<div style={{position:"fixed",inset:0,zIndex:100}} onClick={()=>setShowDrop(false)}/>}
              </div>
            </div>
            <div style={{fontSize:12,color:"var(--text2)",marginTop:8,fontFamily:"var(--mono)"}}>{amtN>0?`≈ ${activeSym==="USDC"||activeSym==="EURC"?`$${amtN.toFixed(2)}`:activeSym==="cirBTC"?`${amtN} cirBTC`:`${amtN} tokens`}`:"$0.00"}</div>
          </div>
        </div>

        {/* Custom contract input — shown only when CUSTOM selected */}
        {selSym==="CUSTOM"&&(
          <div style={{marginBottom:18}}>
            <p style={{fontSize:11,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:8}}>Contract Address</p>
            <div style={{position:"relative"}}>
              <input placeholder="0x… (ERC-20 on Arc Testnet)" value={custAddr} onChange={e=>setCustAddr(e.target.value)}
                style={{width:"100%",background:"var(--bg2)",borderRadius:12,outline:"none",border:`1px solid ${custInfo?"rgba(0,200,150,0.4)":custAddr&&isAddr(custAddr)?"var(--border2)":custAddr?"rgba(224,65,90,0.4)":"var(--border)"}`,padding:"12px 14px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:13}}/>
              {fetching&&<span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)"}} className="spinner"/>}
            </div>
            {custAddr&&!isAddr(custAddr)&&<p style={{color:"var(--red)",fontSize:11,marginTop:4,fontFamily:"var(--mono)"}}>⚠ Invalid address format</p>}
            {custInfo&&(
              <div style={{display:"flex",alignItems:"center",gap:8,marginTop:8,padding:"8px 12px",background:"rgba(0,200,150,0.06)",border:"1px solid rgba(0,200,150,0.2)",borderRadius:8}}>
                <div style={{width:24,height:24,borderRadius:"50%",background:"#6b7280",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>{custInfo.sym.slice(0,2)}</div>
                <span style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{custInfo.sym}</span>
                <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>{custInfo.dec} decimals</span>
                {wallet.connected&&<span style={{marginLeft:"auto",fontSize:12,color:"var(--text1)",fontFamily:"var(--mono)"}}>Bal: {custBal.toFixed(4)}</span>}
              </div>
            )}
            {isAddr(custAddr)&&!fetching&&!custInfo&&<p style={{color:"var(--orange)",fontSize:11,marginTop:4,fontFamily:"var(--mono)"}}>⚠ Token not found on Arc Testnet (0x4cef52)</p>}
          </div>
        )}

        {/* Recipient */}
        <div style={{marginBottom:20}}>
          <p style={{fontSize:11,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:8}}>Recipient Address</p>
          <input type="text" placeholder="0x…" value={recipient} onChange={e=>setRecip(e.target.value)}
            style={{width:"100%",background:"var(--bg2)",borderRadius:12,outline:"none",border:`1px solid ${recipient&&!validAddr?"var(--red)":recipient&&validAddr?"rgba(0,200,150,0.4)":"var(--border)"}`,padding:"13px 16px",color:"var(--text0)",fontFamily:"var(--mono)",fontSize:13,transition:"border-color 0.2s"}}/>
          {recipient&&validAddr&&<p style={{color:"var(--green)",fontSize:11,marginTop:4,fontFamily:"var(--mono)"}}>✓ Valid address</p>}
          {recipient&&!validAddr&&<p style={{color:"var(--red)",fontSize:11,marginTop:4,fontFamily:"var(--mono)"}}>⚠ Invalid address</p>}
        </div>

        {/* Summary */}
        {amtN>0&&validAddr&&(
          <div className="fade-in" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:18}}>
            {[["Sending",`${amount} ${activeSym}`],["To",`${recipient.slice(0,10)}…${recipient.slice(-6)}`],["Network","Arc Testnet (0x4cef52)"],["Est. fee","~0.0001 USDC"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>{k}</span><span style={{color:"var(--text1)",fontWeight:600}}>{v}</span></div>
            ))}
          </div>
        )}

        {sending&&status&&<div style={{marginBottom:14,padding:"10px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",display:"flex",alignItems:"center",gap:8}}><span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>{status}</div>}

        <button onClick={handleSend} disabled={sending||(!wallet.connected?false:!canSend)} style={{width:"100%",padding:15,borderRadius:12,fontFamily:"var(--mono)",fontSize:15,fontWeight:700,cursor:sending||(!wallet.connected?false:!canSend)?"not-allowed":"pointer",transition:"all 0.2s",display:"flex",alignItems:"center",justifyContent:"center",gap:8,...(!wallet.connected?{background:"rgba(0,229,255,0.08)",border:"1px solid rgba(0,229,255,0.25)",color:"var(--cyan)"}:!canSend||sending?{background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--text2)"}:{background:"linear-gradient(90deg,#00b4d8,#0077b6)",border:"none",color:"#fff"})}}>
          {sending&&<span className="spinner"/>}
          {!wallet.connected?"Connect Wallet":sending?"Sending…":selSym==="CUSTOM"&&!custInfo?"Enter valid contract address":!amtN||!validAddr?"Enter amount & recipient":`Send ${amount} ${activeSym} →`}
        </button>
      </div>

      {lastTx&&(
        <div className="fade-in" style={{marginTop:14,background:"var(--bg1)",border:"1px solid rgba(0,200,150,0.25)",borderRadius:16,padding:"16px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><span style={{fontWeight:700,fontSize:13,color:"var(--green)"}}>✅ Transaction Confirmed</span><span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>{new Date().toLocaleTimeString()}</span></div>
          {[["Sent",`${lastTx.amt} ${lastTx.sym}`],["To",`${lastTx.to.slice(0,10)}…${lastTx.to.slice(-6)}`]].map(([k,v])=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>{k}</span><span style={{color:"var(--text1)",fontWeight:600}}>{v}</span></div>
          ))}
          <a href={`${ARC_EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,marginTop:10,color:"var(--cyan)",fontSize:12,fontFamily:"var(--mono)",textDecoration:"none"}}>🔍 View on Arc Explorer ↗</a>
        </div>
      )}
    </div>
  );
}