"use client";
import { useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_EXPLORER, toUnits, encodeApprove } from "@/lib/contracts";

const CHAINS = [
  { id:"Arc_Testnet",      label:"Arc Testnet", sub:"Arc (0x4cef52)",  color:"#00b4d8", icon:"A", chainIdHex:"0x4cef52", usdc:"0x3600000000000000000000000000000000000000", messenger:"0xB1CF6A55845DBEe978e7e67a7D4Cf44B7D970df9", explorer:"https://testnet.arcscan.app", domain:9 },
  { id:"Ethereum_Sepolia", label:"Ethereum",    sub:"Sepolia Testnet", color:"#627EEA", icon:"Ξ", chainIdHex:"0xaa36a7", usdc:"0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", messenger:"0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5", explorer:"https://sepolia.etherscan.io", domain:0 },
  { id:"Avalanche_Fuji",   label:"Avalanche",   sub:"Fuji Testnet",    color:"#E84142", icon:"▲", chainIdHex:"0xa869",   usdc:"0x5425890298aed601595a70AB815c96711a31Bc65", messenger:"0xeb08f243E5d3FCFF26A9E38Ae5520A669f4019d0", explorer:"https://testnet.snowtrace.io", domain:1 },
];
type Chain = typeof CHAINS[0];

function encodeDepositForBurn(amount:bigint, destDomain:number, recipient:string, burnToken:string):string {
  const sel="0x6fd3504e";
  const amt=amount.toString(16).padStart(64,"0");
  const dom=destDomain.toString(16).padStart(64,"0");
  const rec=recipient.toLowerCase().replace("0x","").padStart(64,"0");
  const tok=burnToken.toLowerCase().replace("0x","").padStart(64,"0");
  return sel+amt+dom+rec+tok;
}

async function switchToChain(chain:Chain){
  const eth=(window as any).ethereum; if(!eth)throw new Error("No wallet.");
  let cur:string|undefined; try{cur=await eth.request({method:"eth_chainId"});}catch{}
  if(cur?.toLowerCase()===chain.chainIdHex.toLowerCase())return;
  try{ await eth.request({method:"wallet_switchEthereumChain",params:[{chainId:chain.chainIdHex}]}); }
  catch(e:any){
    if(e.code===4902){
      const names:Record<string,string>={"0xaa36a7":"Ethereum Sepolia","0xa869":"Avalanche Fuji Testnet","0x4cef52":"Arc Network Testnet"};
      const rpcs:Record<string,string[]>={"0xaa36a7":["https://rpc.sepolia.org"],"0xa869":["https://api.avax-test.network/ext/bc/C/rpc"],"0x4cef52":["https://rpc.testnet.arc.network"]};
      await eth.request({method:"wallet_addEthereumChain",params:[{chainId:chain.chainIdHex,chainName:names[chain.chainIdHex]??chain.label,nativeCurrency:{name:"ETH",symbol:"ETH",decimals:18},rpcUrls:rpcs[chain.chainIdHex]??[],blockExplorerUrls:[chain.explorer]}]});
    } else throw e;
  }
}

async function waitTxOnChain(hash:string,maxWait=90000):Promise<boolean>{
  const eth=(window as any).ethereum; const start=Date.now();
  while(Date.now()-start<maxWait){ await new Promise(r=>setTimeout(r,2500));
    try{ const r=await eth.request({method:"eth_getTransactionReceipt",params:[hash]}); if(r?.status)return r.status==="0x1"; }catch{} }
  return false;
}

function ChainCard({ chain,selected,onClick }:{ chain:Chain;selected:boolean;onClick:()=>void }){
  return (
    <button type="button" onClick={onClick} style={{flex:1,padding:"14px 8px",borderRadius:14,border:"1px solid",borderColor:selected?chain.color+"99":"var(--border)",background:selected?chain.color+"18":"var(--bg2)",cursor:"pointer",transition:"all 0.2s",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
      <div style={{width:36,height:36,borderRadius:"50%",background:selected?chain.color:"var(--bg3)",border:`2px solid ${selected?chain.color:"var(--border)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:800,color:"#fff",boxShadow:selected?`0 0 12px ${chain.color}44`:"none"}}>{chain.icon}</div>
      <span style={{fontSize:12,fontWeight:700,color:selected?"#fff":"var(--text1)"}}>{chain.label}</span>
      <span style={{fontSize:10,fontFamily:"var(--mono)",color:selected?chain.color:"var(--text2)"}}>{chain.sub}</span>
    </button>
  );
}

export default function BridgePage(){
  const { wallet, openModal } = useWallet();
  const [fromId, setFromId] = useState("Arc_Testnet");
  const [toId,   setToId]   = useState("Ethereum_Sepolia");
  const [amount, setAmount] = useState("");
  const [loading,setLoad]   = useState(false);
  const [status, setStat]   = useState("");
  const [result, setResult] = useState<{approveTx?:string;burnTx?:string;fromExplorer?:string;toLabel?:string;error?:string}|null>(null);
  const [srcBal, setSrcBal] = useState<number|null>(null);

  const from     = CHAINS.find(c=>c.id===fromId)!;
  const to       = CHAINS.find(c=>c.id===toId)!;
  const amtN     = parseFloat(amount)||0;
  const samePair = fromId===toId;
  const canBridge= wallet.connected&&amtN>0&&!samePair&&!loading;

  // Fetch USDC balance on source chain
  async function fetchSrcBal(){
    const eth=(window as any).ethereum; if(!eth||!wallet.connected)return;
    const pad=wallet.address.toLowerCase().replace("0x","").padStart(64,"0");
    try{ const r=await eth.request({method:"eth_call",params:[{to:from.usdc,data:"0x70a08231"+pad},"latest"]}); setSrcBal(r&&r!=="0x"?Number(BigInt(r))/1e6:0); }catch{}
  }

  async function handleBridge(){
    if(!wallet.connected){openModal();return;} if(!canBridge)return;
    setLoad(true); setStat(""); setResult(null);
    const eth=(window as any).ethereum;
    try{
      setStat(`Switching to ${from.label}…`);
      await switchToChain(from);
      await fetchSrcBal();
      const amtRaw=toUnits(amtN,6);
      // Step 1: Approve
      setStat(`Approving USDC on ${from.label} — confirm in wallet…`);
      const approveData=encodeApprove(from.messenger,amtRaw);
      const approveTx:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:from.usdc,data:approveData,gas:"0x186A0"}]});
      setStat("Waiting for approve confirmation…");
      const approveOk=await waitTxOnChain(approveTx);
      if(!approveOk)throw new Error("Approve failed.");
      // Step 2: Burn (CCTP depositForBurn)
      setStat(`Burning USDC on ${from.label} — confirm in wallet…`);
      const burnData=encodeDepositForBurn(amtRaw,to.domain,wallet.address,from.usdc);
      const burnTx:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:from.messenger,data:burnData,gas:"0x493E0"}]});
      setStat("Waiting for burn confirmation…");
      const burnOk=await waitTxOnChain(burnTx);
      if(burnOk){
        setResult({approveTx,burnTx,fromExplorer:from.explorer,toLabel:to.label});
        showToast(true,"Burn Confirmed ✓",`USDC burned on ${from.label}. Attest & mint on ${to.label} in ~5–15 min.`);
        setAmount("");
      } else {
        setResult({error:"Burn transaction reverted. Check USDC contract address for this chain."});
        showToast(false,"Bridge Failed","depositForBurn reverted.");
      }
    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg)) showToast(false,"Cancelled","Rejected in wallet.");
      else { setResult({error:msg.slice(0,200)}); showToast(false,"Bridge Error",msg.slice(0,120)); }
    }finally{setLoad(false);setStat("");}
  }

  return (
    <div className="fade-in" style={{maxWidth:520,margin:"0 auto",padding:"20px 24px"}}>
      <div style={{marginBottom:22}}><h1 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5,marginBottom:4}}>Bridge</h1><p style={{fontSize:13,color:"var(--text2)"}}>Cross-chain USDC · Circle CCTP v2 · Approve → Burn → Attest → Mint</p></div>

      <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:22}}>
        {/* FROM */}
        <div style={{marginBottom:12}}>
          <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:10}}>From</p>
          <div style={{display:"flex",gap:8}}>
            {CHAINS.map(c=><ChainCard key={c.id} chain={c} selected={fromId===c.id} onClick={()=>{if(c.id===toId)setToId(fromId);setFromId(c.id);setResult(null);setAmount("");setSrcBal(null);}}/>)}
          </div>
        </div>

        {/* Arrow flip */}
        <div style={{display:"flex",justifyContent:"center",margin:"10px 0"}}>
          <button onClick={()=>{setFromId(toId);setToId(fromId);setResult(null);setAmount("");setSrcBal(null);}} style={{width:36,height:36,borderRadius:10,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text1)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,transition:"all 0.25s"}} onMouseEnter={e=>{(e.currentTarget as HTMLButtonElement).style.transform="rotate(180deg)";(e.currentTarget as HTMLButtonElement).style.color="var(--cyan)";}} onMouseLeave={e=>{(e.currentTarget as HTMLButtonElement).style.transform="rotate(0deg)";(e.currentTarget as HTMLButtonElement).style.color="var(--text1)";}}>⇅</button>
        </div>

        {/* TO */}
        <div style={{marginBottom:20}}>
          <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:10}}>To</p>
          <div style={{display:"flex",gap:8}}>
            {CHAINS.map(c=><ChainCard key={c.id} chain={c} selected={toId===c.id} onClick={()=>{if(c.id===fromId)setFromId(toId);setToId(c.id);setResult(null);}}/>)}
          </div>
        </div>

        {/* Route */}
        <div style={{display:"flex",alignItems:"center",gap:12,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:8,height:8,borderRadius:"50%",background:from.color,boxShadow:`0 0 5px ${from.color}`}}/><span style={{fontSize:13,fontWeight:600}}>{from.label}</span></div>
          <div style={{flex:1,position:"relative",display:"flex",alignItems:"center"}}><div style={{flex:1,borderTop:"1px dashed var(--border2)"}}/><span style={{position:"absolute",left:"50%",transform:"translateX(-50%)",background:"var(--bg2)",padding:"0 8px",fontSize:10,fontWeight:700,color:"var(--cyan)",fontFamily:"var(--mono)"}}>CCTP</span></div>
          <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:8,height:8,borderRadius:"50%",background:to.color,boxShadow:`0 0 5px ${to.color}`}}/><span style={{fontSize:13,fontWeight:600}}>{to.label}</span></div>
        </div>

        {samePair&&<div style={{background:"rgba(224,65,90,0.08)",border:"1px solid rgba(224,65,90,0.22)",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"var(--red)",fontFamily:"var(--mono)"}}>⚠ Source and destination must be different.</div>}

        {/* Amount */}
        <div style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}>Amount (USDC)</p>
            {wallet.connected&&srcBal!==null&&<span style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",fontWeight:600,cursor:"pointer"}} onClick={()=>setAmount(srcBal.toFixed(2))}>MAX: {srcBal.toFixed(2)} on {from.label}</span>}
            {wallet.connected&&srcBal===null&&<span style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)",cursor:"pointer"}} onClick={fetchSrcBal}>Check balance ↗</span>}
          </div>
          <div className="token-box">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="number" placeholder="0.00" step="0.01" min="0.01" value={amount} onChange={e=>{setAmount(e.target.value);setResult(null);}} style={{flex:1,background:"none",border:"none",outline:"none",fontSize:28,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)",minWidth:0}}/>
              <div style={{display:"flex",alignItems:"center",gap:7,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:50,padding:"7px 14px 7px 8px",flexShrink:0}}>
                <div style={{width:22,height:22,borderRadius:"50%",background:"#2775CA",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>US</div>
                <span style={{fontSize:13,fontWeight:700}}>USDC</span>
              </div>
            </div>
            <div style={{fontSize:12,color:"var(--text2)",marginTop:8,fontFamily:"var(--mono)"}}>{amtN>0?`≈ $${amount} USD`:"$0.00"}</div>
          </div>
        </div>

        {/* Summary */}
        {amtN>0&&!samePair&&(
          <div className="fade-in" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",marginBottom:18}}>
            {[["You send",`${amount} USDC on ${from.label}`],["You receive",`${amount} USDC on ${to.label}`],["Steps","Approve → Burn → Attest → Mint"],["Est. time","~5–15 minutes"],["Protocol","Circle CCTP v2"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>{k}</span><span style={{color:k==="Protocol"?"var(--cyan)":"var(--text1)",fontWeight:600}}>{v}</span></div>
            ))}
          </div>
        )}

        {loading&&status&&<div style={{marginBottom:14,padding:"10px 14px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,fontSize:12,color:"var(--cyan)",fontFamily:"var(--mono)",display:"flex",alignItems:"center",gap:8}}><span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>{status}</div>}

        {!wallet.connected?(
          <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
        ):(
          <button disabled={!canBridge} onClick={handleBridge} className={canBridge?"swap-btn ready":"swap-btn disabled-state"} style={{margin:0}}>
            {loading&&<span className="spinner"/>}{loading?"Bridging…":`Bridge ${amtN>0?amount+" ":""}USDC →`}
          </button>
        )}
      </div>

      {/* Result */}
      {result&&(
        <div className="fade-in" style={{marginTop:14,background:"var(--bg1)",border:`1px solid ${result.error?"rgba(224,65,90,0.3)":"rgba(0,200,150,0.3)"}`,borderRadius:16,padding:"16px 18px"}}>
          {result.error?(
            <><p style={{fontWeight:700,fontSize:13,color:"var(--red)",marginBottom:8}}>❌ Bridge Failed</p><p style={{fontSize:12,color:"var(--text2)",fontFamily:"var(--mono)",lineHeight:1.65}}>{result.error}</p></>
          ):(
            <>
              <p style={{fontWeight:700,fontSize:13,color:"var(--green)",marginBottom:10}}>✅ Burn TX Confirmed</p>
              {result.burnTx&&<><div style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",fontFamily:"var(--mono)"}}><span style={{color:"var(--text2)"}}>Burn TX</span><span style={{color:"var(--text1)",fontWeight:600}}>{result.burnTx.slice(0,10)}…{result.burnTx.slice(-6)}</span></div><a href={`${result.fromExplorer}/tx/${result.burnTx}`} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,marginTop:10,color:"var(--cyan)",fontSize:12,fontFamily:"var(--mono)",textDecoration:"none"}}>🔍 View on Explorer ↗</a></>}
              <div style={{marginTop:12,padding:"10px 12px",background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.2)",borderRadius:8}}>
                <p style={{fontSize:12,color:"var(--orange)",fontFamily:"var(--mono)",lineHeight:1.65}}>⏳ Circle attesting burn event. USDC will be minted on <strong>{result.toLabel}</strong> in ~5–15 min. Track at: <a href="https://iris-api-sandbox.circle.com" target="_blank" rel="noopener noreferrer" style={{color:"var(--cyan)",textDecoration:"none"}}>iris-api-sandbox.circle.com ↗</a></p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}