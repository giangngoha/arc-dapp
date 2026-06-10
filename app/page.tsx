"use client";
import { useState, useEffect } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import TokenSelectModal, { TOKENS, getRate } from "@/components/TokenSelectModal";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER } from "@/lib/contracts";

// On-chain supported pairs via StableFX
const SUPPORTED = new Set(["USDC-EURC","EURC-USDC"]);
const DEMO_POOL  = "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8";

interface TxRecord { symIn:string; amtIn:string; symOut:string; amtOut:string; hash:string; time:string; explorerUrl:string; }

async function switchToArc() {
  const eth=(window as any).ethereum; if(!eth) throw new Error("No wallet detected.");
  const hex="0x4cef52";
  let cur:string|undefined;
  try { cur=await eth.request({method:"eth_chainId"}); } catch{}
  if(cur?.toLowerCase()===hex) return;
  try { await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:hex}]}); }
  catch(e:any){ if(e.code===4902){ await eth.request({method:"wallet_addEthereumChain",params:[{chainId:hex,chainName:"Arc Network Testnet",nativeCurrency:{name:"USDC",symbol:"USDC",decimals:18},rpcUrls:["https://rpc.testnet.arc.network"],blockExplorerUrls:[ARC_EXPLORER]}]}); } else throw e; }
}

async function waitTx(hash:string,maxWait=90000):Promise<boolean> {
  const eth=(window as any).ethereum; const start=Date.now();
  while(Date.now()-start<maxWait){ await new Promise(r=>setTimeout(r,2500));
    try{ const r=await eth.request({method:"eth_getTransactionReceipt",params:[hash]}); if(r?.status) return r.status==="0x1"; }catch{} }
  return false;
}

export default function ExchangePage() {
  const { wallet, openModal, refreshBalances } = useWallet();
  const [fromSym,setFromSym]=useState("USDC"); const [fromBg,setFromBg]=useState("#2775CA");
  const [toSym,  setToSym]  =useState("EURC"); const [toBg,  setToBg]  =useState("#2B5EDD");
  const [amtIn,  setAmtIn]  =useState("");
  const [slippage,setSlip]  =useState(0.5);
  const [showSettings,setSS]=useState(false);
  const [tokenModal,setTM]  =useState<"from"|"to"|null>(null);
  const [confirmOpen,setConf]=useState(false);
  const [swapping,  setSwap]=useState(false);
  const [swapStatus,setStat]=useState("");
  const [lastTx,    setTx]  =useState<TxRecord|null>(null);

  const rate     = getRate(fromSym,toSym);
  const amtInN   = parseFloat(amtIn)||0;
  const amtOut   = amtInN>0?(amtInN*rate).toFixed(6):"";
  const impact   = amtInN>1000?0.04:amtInN>100?0.015:0.003;
  const minOut   = amtOut?(parseFloat(amtOut)*(1-slippage/100)).toFixed(6):"";
  const fromBal  = wallet.connected?getBal(wallet.balances,fromSym):0;
  const toBal    = wallet.connected?getBal(wallet.balances,toSym):0;
  const supported= SUPPORTED.has(`${fromSym}-${toSym}`);

  function fmtBal(sym:string,v:number){ return v.toLocaleString(undefined,{maximumFractionDigits:sym==="cirBTC"?8:4}); }
  function flip(){ setFromSym(toSym);setFromBg(toBg);setToSym(fromSym);setToBg(fromBg);setAmtIn(amtOut||""); }

  async function executeSwap() {
    setConf(false); setSwap(true); setStat("Starting…");
    const eth=(window as any).ethereum;
    try {
      await switchToArc();
      const dec=fromSym==="cirBTC"?8:6;
      const amtRaw=BigInt(Math.floor(amtInN*10**dec));
      const dst=DEMO_POOL.toLowerCase().replace("0x","").padStart(64,"0");
      const amt=amtRaw.toString(16).padStart(64,"0");
      const data="0xa9059cbb"+dst+amt;
      const tokenAddr=fromSym==="USDC"?"0x3600000000000000000000000000000000000000":fromSym==="EURC"?"0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a":"0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
      setStat(`Transfer ${amtInN} ${fromSym} — confirm in wallet…`);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:tokenAddr,data,gas:"0x186A0"}]});
      setStat("Waiting for confirmation…");
      const ok=await waitTx(txHash);
      const now=new Date();
      const time=[now.getHours(),now.getMinutes(),now.getSeconds()].map(n=>String(n).padStart(2,"0")).join(":");
      if(ok){
        setTx({symIn:fromSym,amtIn:String(amtInN),symOut:toSym,amtOut:amtOut||"0",hash:txHash,time,explorerUrl:`${ARC_EXPLORER}/tx/${txHash}`});
        showToast(true,"Transaction Confirmed ✓",`${amtInN} ${fromSym} sent`);
        setAmtIn(""); await refreshBalances();
      } else showToast(false,"Transaction Failed","Check explorer for details.");
    } catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg)) showToast(false,"Cancelled","Transaction rejected in wallet.");
      else showToast(false,"Error",msg.slice(0,140));
    } finally { setSwap(false); setStat(""); }
  }

  const swapBtnClass=!wallet.connected?"swap-btn connect-state":swapping||!amtInN||!supported?"swap-btn disabled-state":"swap-btn ready";
  const swapBtnLabel=!wallet.connected?"Connect Wallet":swapping?(swapStatus||"Processing…"):!amtInN?"Enter amount":!supported?`${fromSym}↔${toSym} not supported`:`Swap ${fromSym} → ${toSym}`;

  return (
    <>
    <div className="fade-in" style={{maxWidth:520,margin:"0 auto",padding:"20px 24px"}}>
      {/* Swap Panel */}
      <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:22,marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <span style={{fontSize:16,fontWeight:700}}>Swap Exchange</span>
          <button className="icon-btn" onClick={()=>setSS(s=>!s)}>⚙</button>
        </div>

        {showSettings&&(
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:16}}>
            <p style={{fontSize:12,color:"var(--text1)",marginBottom:8,fontFamily:"var(--mono)"}}>Slippage Tolerance</p>
            <div className="slip-row">
              {[0.1,0.5,1.0].map(v=><button key={v} className={`slip-opt${slippage===v?" active":""}`} onClick={()=>setSlip(v)}>{v}%</button>)}
              <input className="slip-custom" type="number" placeholder="%" min="0.01" max="50" step="0.1" onChange={e=>{const n=parseFloat(e.target.value);if(n>0&&n<=50)setSlip(n);}}/>
            </div>
            <p style={{fontSize:11,color:"var(--text2)",marginTop:8,fontFamily:"var(--mono)"}}>Current: <span style={{color:"var(--cyan)"}}>{slippage}%</span></p>
          </div>
        )}

        {wallet.connected&&amtInN>0&&!supported&&(
          <div style={{background:"rgba(224,65,90,0.08)",border:"1px solid rgba(224,65,90,0.2)",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"var(--red)",fontFamily:"var(--mono)"}}>
            ⚠ On-chain swap supports <strong>USDC ↔ EURC</strong> only.
          </div>
        )}

        {/* FROM */}
        <div className="token-box">
          <div className="box-header">
            <span className="box-label">Sell (From)</span>
            <span className="box-bal">Balance: <span className="box-bal-max" onClick={()=>wallet.connected&&setAmtIn(String(fromBal))}>{wallet.connected?fmtBal(fromSym,fromBal):"—"}</span></span>
          </div>
          <div className="box-row">
            <input className="amount-inp" type="number" placeholder="0.0" value={amtIn} onChange={e=>setAmtIn(e.target.value)} step="any"/>
            <div className="token-pill" onClick={()=>setTM("from")}>
              <div className="token-circle" style={{background:fromBg}}>{fromSym==="cirBTC"?"₿":fromSym.slice(0,2)}</div>
              <span className="token-sym-txt">{fromSym}</span><span className="chev">▾</span>
            </div>
          </div>
        </div>

        <div className="swap-arrow-wrap"><div className="swap-arrow" onClick={flip}>⇅</div></div>

        {/* TO */}
        <div className="token-box">
          <div className="box-header">
            <span className="box-label">Buy (To)</span>
            <span className="box-bal">Balance: {wallet.connected?fmtBal(toSym,toBal):"—"}</span>
          </div>
          <div className="box-row">
            <input className="amount-inp" type="number" placeholder="0.0" value={amtOut} readOnly style={{color:"var(--text1)"}}/>
            <div className="token-pill" onClick={()=>setTM("to")}>
              <div className="token-circle" style={{background:toBg}}>{toSym==="cirBTC"?"₿":toSym.slice(0,2)}</div>
              <span className="token-sym-txt">{toSym}</span><span className="chev">▾</span>
            </div>
          </div>
        </div>

        {amtInN>0&&<div className="rate-info"><span style={{fontFamily:"var(--mono)"}}>1 {fromSym} = {rate.toFixed(6)} {toSym}</span><span style={{color:impact>0.02?"var(--red)":"var(--cyan)",fontFamily:"var(--mono)"}}>Impact: {(impact*100).toFixed(2)}%</span></div>}

        {swapping&&swapStatus&&(
          <div style={{marginTop:10,padding:"10px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",display:"flex",alignItems:"center",gap:8}}>
            <span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>
            {swapStatus}
          </div>
        )}

        <button className={swapBtnClass} onClick={()=>{if(!wallet.connected){openModal();return;}if(!amtInN||!supported)return;setConf(true);}} disabled={swapping||(!wallet.connected?false:!amtInN||!supported)}>
          {swapping&&<span className="spinner"/>}{swapBtnLabel}
        </button>
      </div>

      {/* TX Feed */}
      <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:16,padding:"16px 18px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:lastTx?"var(--green)":"var(--text2)",animation:lastTx?"pulse 2s infinite":"none"}}/>
            <span style={{fontSize:13,fontWeight:700,color:"var(--text1)"}}>Recent Transaction</span>
          </div>
          {lastTx&&<a href={lastTx.explorerUrl} target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",textDecoration:"none"}}>View on Explorer ↗</a>}
        </div>
        {!lastTx ? (
          <p style={{fontSize:12,color:"var(--text2)",fontFamily:"var(--mono)",lineHeight:1.65}}>Your most recent transaction will appear here. Each new TX replaces the previous one.</p>
        ) : (
          <div style={{animation:"txIn 0.35s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:10,fontWeight:700,color:"var(--cyan)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}>TRANSFER EXECUTED</span>
              <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>{lastTx.time}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:TOKENS.find(t=>t.sym===lastTx.symIn)?.bg??"#888",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>{lastTx.symIn==="cirBTC"?"₿":lastTx.symIn.slice(0,2)}</div>
                <span style={{fontSize:15,fontWeight:700,fontFamily:"var(--mono)"}}>{lastTx.amtIn} {lastTx.symIn}</span>
              </div>
              <span style={{color:"var(--text2)",fontSize:16}}>→</span>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:TOKENS.find(t=>t.sym===lastTx.symOut)?.bg??"#888",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff",flexShrink:0}}>{lastTx.symOut==="cirBTC"?"₿":lastTx.symOut.slice(0,2)}</div>
                <span style={{fontSize:15,fontWeight:700,fontFamily:"var(--mono)",color:"var(--cyan)"}}>{lastTx.amtOut} {lastTx.symOut}</span>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>TX: {lastTx.hash.slice(0,10)}…{lastTx.hash.slice(-6)}</span>
              <span style={{fontSize:11,fontWeight:700,color:"var(--green)",fontFamily:"var(--mono)"}}>✓ Confirmed</span>
            </div>
          </div>
        )}
      </div>
    </div>

    {tokenModal&&<TokenSelectModal exclude={tokenModal==="from"?toSym:fromSym} onClose={()=>setTM(null)} onSelect={(sym,bg)=>{ if(tokenModal==="from"){setFromSym(sym);setFromBg(bg);}else{setToSym(sym);setToBg(bg);}setTM(null); }}/>}

    {confirmOpen&&(
      <div className="modal-backdrop" onClick={()=>setConf(false)}>
        <div className="modal-box fade-in" style={{maxWidth:380}} onClick={e=>e.stopPropagation()}>
          <div className="modal-head"><h2 className="modal-title">Confirm Swap</h2><button className="close-x" onClick={()=>setConf(false)}>×</button></div>
          <div style={{background:"var(--bg2)",borderRadius:12,padding:16,marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:fromBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff"}}>{fromSym==="cirBTC"?"₿":fromSym.slice(0,2)}</div>
              <div><p style={{fontSize:20,fontWeight:700,fontFamily:"var(--mono)"}}>{amtIn} {fromSym}</p><p style={{fontSize:11,color:"var(--text2)"}}>You send</p></div>
            </div>
            <div style={{color:"var(--text2)",fontSize:18,marginBottom:10,paddingLeft:4}}>↓</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:32,height:32,borderRadius:"50%",background:toBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff"}}>{toSym==="cirBTC"?"₿":toSym.slice(0,2)}</div>
              <div><p style={{fontSize:20,fontWeight:700,fontFamily:"var(--mono)",color:"var(--cyan)"}}>{amtOut} {toSym}</p><p style={{fontSize:11,color:"var(--text2)"}}>You receive (estimated)</p></div>
            </div>
          </div>
          <hr className="sep"/>
          <div className="confirm-row"><span className="ck">Min received</span><span className="cv">{minOut} {toSym}</span></div>
          <div className="confirm-row"><span className="ck">Slippage</span><span className="cv">{slippage}%</span></div>
          <div className="confirm-row"><span className="ck">Network fee</span><span className="cv">~0.0001 USDC</span></div>
          {wallet.chainId!==5042002&&<div style={{marginTop:10,padding:"8px 12px",background:"rgba(245,166,35,0.1)",border:"1px solid rgba(245,166,35,0.25)",borderRadius:8,fontSize:11,color:"var(--orange)",fontFamily:"var(--mono)"}}>⚠ Will switch to Arc Testnet (0x4cef52).</div>}
          <button className="swap-btn ready" style={{marginTop:14}} onClick={executeSwap}>Confirm &amp; Sign in Wallet</button>
        </div>
      </div>
    )}
    </>
  );
}
