"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, getBal } from "@/components/WalletProvider";
import { showToast } from "@/components/Toast";
import { ARC_RPC, ARC_EXPLORER, CONTRACTS } from "@/lib/contracts";

// ─── Constants ────────────────────────────────────────────────────────────────
// TODO: replace with your deployed MultiSend address after running forge deploy
const MULTISEND_ADDR = "0xEBe3Edb9E6a13a7B03a38F34A907cA74a19f99d8";

const BUILTIN = [
  { sym:"USDC",   name:"USD Coin",       bg:"#2775CA", addr:CONTRACTS.USDC,   dec:6 },
  { sym:"EURC",   name:"Euro Coin",      bg:"#2B5EDD", addr:CONTRACTS.EURC,   dec:6 },
  { sym:"cirBTC", name:"Circle Bitcoin", bg:"#F7931A", addr:CONTRACTS.cirBTC, dec:8 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
      const j=await res.json(); const r=j.result;
      if(r?.blockNumber) return r.status==="0x1"||r.status===1;
    }catch{}
  }
  return false;
}

async function rpcEthCall(to:string, data:string):Promise<string>{
  const res=await fetch(ARC_RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to,data},"latest"]})});
  return (await res.json()).result??"0x";
}

// ERC-20 encode helpers
function encodeTransfer(to:string, amount:bigint):string{
  return "0xa9059cbb"+to.toLowerCase().replace("0x","").padStart(64,"0")+amount.toString(16).padStart(64,"0");
}
function encodeApprove(spender:string, amount:bigint):string{
  return "0x095ea7b3"+spender.toLowerCase().replace("0x","").padStart(64,"0")+amount.toString(16).padStart(64,"0");
}
function encodeAllowance(owner:string, spender:string):string{
  return "0xdd62ed3e"+owner.toLowerCase().replace("0x","").padStart(64,"0")+spender.toLowerCase().replace("0x","").padStart(64,"0");
}

// MultiSend ABI encode: multiTransfer(address token, address[] recipients, uint256[] amounts)
function encodeMultiTransfer(token:string, recipients:string[], amounts:bigint[]):string{
  // keccak256("multiTransfer(address,address[],uint256[])") = 0x1ca0a28d
  const sel = "1ca0a28d";
  const n = recipients.length;
  // ABI encoding for (address, address[], uint256[]):
  // slot0: token (static)
  // slot1: offset to recipients array = 3 * 32 = 96
  // slot2: offset to amounts array = 96 + 32 + n*32
  // then: recipients length + n addresses
  // then: amounts length + n amounts
  const tokenPad  = token.toLowerCase().replace("0x","").padStart(64,"0");
  const offsetRec = (96).toString(16).padStart(64,"0");
  const offsetAmt = (96 + 32 + n * 32).toString(16).padStart(64,"0");
  const lenPad    = n.toString(16).padStart(64,"0");
  const recHex    = recipients.map(r=>r.toLowerCase().replace("0x","").padStart(64,"0")).join("");
  const amtHex    = amounts.map(a=>a.toString(16).padStart(64,"0")).join("");
  return "0x" + sel + tokenPad + offsetRec + offsetAmt + lenPad + recHex + lenPad + amtHex;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface BulkRow {
  address: string;
  amount:  string;
  // validation
  addrErr?: string;
  amtErr?:  string;
  // execution
  status: "idle"|"sending"|"success"|"failed";
  txHash?: string;
}

type SendTab = "single"|"bulk";

// ─── Main component ───────────────────────────────────────────────────────────
export default function SendPage(){
  const { wallet, openModal, refreshBalances } = useWallet();
  const [tab, setTab] = useState<SendTab>("single");

  // ── Single send state ──────────────────────────────────────────────────────
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

  // ── Bulk send state ────────────────────────────────────────────────────────
  const [bulkSym,    setBulkSym]   = useState("USDC");
  const [bulkInput,  setBulkInput] = useState("");
  const [bulkRows,   setBulkRows]  = useState<BulkRow[]>([]);
  const [bulkStatus, setBulkStat]  = useState("");
  const [bulkRunning,setBulkRun]   = useState(false);
  const [bulkDone,   setBulkDone]  = useState(false);
  const bulkCancelRef = useRef(false);

  // ── Single token helpers ───────────────────────────────────────────────────
  const isCustom   = selSym==="CUSTOM";
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

  // ── Bulk token helpers ─────────────────────────────────────────────────────
  const bulkTok    = BUILTIN.find(t=>t.sym===bulkSym)!;
  const bulkBal    = wallet.connected ? getBal(wallet.balances,bulkSym) : 0;
  const bulkDec    = bulkTok?.dec??6;
  const validRows  = bulkRows.filter(r=>!r.addrErr&&!r.amtErr&&r.address&&r.amount);
  const totalBulk  = validRows.reduce((s,r)=>s+parseFloat(r.amount),0);
  const canMultiSend = wallet.connected && validRows.length>0 && !bulkRunning;

  // Custom token lookup (single send)
  useEffect(()=>{
    if(!custAddr||!isAddr(custAddr)){setCustInfo(null);return;}
    setFetching(true);
    const pad=custAddr.toLowerCase().replace("0x","").padStart(64,"0");
    async function rc(data:string):Promise<string> {
      const r=await fetch(ARC_RPC,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:custAddr,data},"latest"]})});
      return (await r.json()).result??"0x";
    }
    Promise.all([
      rc("0x95d89b41"),
      rc("0x313ce567"),
      wallet.connected ? rc("0x70a08231"+pad) : Promise.resolve("0x"),
    ]).then(([symHex,decHex,balHex])=>{
      const sym=parseAbiStr(symHex)||custAddr.slice(0,6)+"…";
      const dec=decHex&&decHex!=="0x"?parseInt(decHex,16):18;
      const b=balHex&&balHex!=="0x"?Number(BigInt(balHex))/10**dec:0;
      setCustInfo({sym,dec}); setCustBal(b);
    }).catch(()=>setCustInfo(null)).finally(()=>setFetching(false));
  },[custAddr,wallet.connected,wallet.address]);

  // ── Parse bulk input ───────────────────────────────────────────────────────
  function parseBulkInput(raw:string){
    const lines = raw.split("\n").map(l=>l.trim()).filter(l=>l.length>0);
    const rows:BulkRow[] = lines.map(line=>{
      // Accept: "0xAddr, 10" or "0xAddr 10" or "0xAddr\t10"
      const parts = line.split(/[\s,\t]+/);
      const addr   = parts[0]?.trim()??"";
      const amt    = parts[1]?.trim()??"";
      const addrErr = !addr ? "Missing address" : !isAddr(addr) ? "Invalid address" : undefined;
      const amtErr  = !amt  ? "Missing amount"  : isNaN(parseFloat(amt))||parseFloat(amt)<=0 ? "Invalid amount" : undefined;
      return { address:addr, amount:amt, addrErr, amtErr, status:"idle" as const };
    });
    setBulkRows(rows);
  }

  // ── Single send handler ────────────────────────────────────────────────────
  async function handleSend(){
    if(!wallet.connected){openModal();return;} if(!canSend)return;
    setSend(true); setStat(""); setTx(null);
    const eth=(window as any).ethereum;
    try{
      await switchToArc();
      const amtRaw=BigInt(Math.floor(amtN*10**activeDec));
      setStat(`Send ${amtN} ${activeSym} — confirm in wallet…`);
      const txHash:string=await eth.request({method:"eth_sendTransaction",params:[{from:wallet.address,to:activeAddr,data:encodeTransfer(recipient.trim(),amtRaw),gas:"0x186A0"}]});
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

  // ── Bulk send handler (1 signature via MultiSend contract) ─────────────────
  async function handleBulkSend(){
    if(!wallet.connected){openModal();return;}
    if(!canMultiSend)return;
    bulkCancelRef.current=false;
    setBulkRun(true); setBulkDone(false); setBulkStat("");
    const eth=(window as any).ethereum;

    try{
      await switchToArc();

      const recipients = validRows.map(r=>r.address.trim());
      const amounts    = validRows.map(r=>BigInt(Math.round(parseFloat(r.amount)*10**bulkDec)));
      const totalRaw   = amounts.reduce((s,a)=>s+a,0n);

      // 1. Check allowance
      setBulkStat("Checking allowance…");
      const allowHex = await rpcEthCall(bulkTok.addr, encodeAllowance(wallet.address, MULTISEND_ADDR));
      const currentAllow = allowHex&&allowHex!=="0x" ? BigInt(allowHex) : 0n;

      if(currentAllow < totalRaw){
        setBulkStat(`Approving ${(Number(totalRaw)/10**bulkDec).toFixed(bulkDec>=8?8:2)} ${bulkSym} — confirm in wallet…`);
        const approveTx:string = await eth.request({
          method:"eth_sendTransaction",
          params:[{from:wallet.address, to:bulkTok.addr, data:encodeApprove(MULTISEND_ADDR,totalRaw), gas:"0x186A0"}]
        });
        setBulkStat("Waiting for approval…");
        const ok = await waitTx(approveTx);
        if(!ok) throw new Error("Approve transaction failed.");
        setBulkStat("Approved ✓");
      } else {
        setBulkStat("Allowance sufficient ✓");
        await new Promise(r=>setTimeout(r,400));
      }

      if(bulkCancelRef.current) return;

      // 2. Single multiTransfer call
      setBulkStat(`Sending to ${recipients.length} addresses — confirm in wallet…`);
      const data = encodeMultiTransfer(bulkTok.addr, recipients, amounts);
      const txHash:string = await eth.request({
        method:"eth_sendTransaction",
        params:[{from:wallet.address, to:MULTISEND_ADDR, data, gas:("0x"+Math.min(300000+recipients.length*30000,8000000).toString(16))}]
      });

      setBulkStat("Waiting for confirmation…");
      // Optimistically mark all as "sending"
      setBulkRows(prev=>prev.map((r,i)=>validRows[i]?{...r,status:"sending"}:r));

      const ok = await waitTx(txHash, 120000);

      if(ok){
        setBulkRows(prev=>prev.map((r,i)=>validRows[i]?{...r,status:"success",txHash}:r));
        setBulkStat(`✅ All ${recipients.length} transfers confirmed!`);
        setBulkDone(true);
        showToast(true,"Bulk Send Complete ✓",`${totalBulk.toFixed(2)} ${bulkSym} sent to ${recipients.length} addresses`);
        await refreshBalances();
      } else {
        setBulkRows(prev=>prev.map((r,i)=>validRows[i]?{...r,status:"failed"}:r));
        setBulkStat("❌ Transaction reverted — all transfers rolled back.");
        showToast(false,"Bulk Send Failed","Transaction reverted on-chain.");
      }

    }catch(err:any){
      const msg=err?.message||String(err);
      if(msg.includes("4001")||/reject|denied|cancel/i.test(msg)){
        showToast(false,"Cancelled","Rejected in wallet.");
        setBulkStat("Cancelled.");
        setBulkRows(prev=>prev.map(r=>({...r,status:"idle"})));
      } else {
        showToast(false,"Bulk Send Error",msg.slice(0,100));
        setBulkStat("Error: "+msg.slice(0,200));
        setBulkRows(prev=>prev.map((r,i)=>validRows[i]?{...r,status:"failed"}:r));
      }
    }finally{
      setBulkRun(false);
    }
  }

  function resetBulk(){
    setBulkRows([]); setBulkInput(""); setBulkStat(""); setBulkDone(false);
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fade-in" style={{maxWidth:480,margin:"0 auto",padding:"20px 24px"}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:26,fontWeight:800,letterSpacing:-0.5}}>Send Tokens</h1>
      </div>

      {/* Tab switcher */}
      <div style={{display:"flex",gap:4,background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:12,padding:4,marginBottom:20}}>
        {(["single","bulk"] as SendTab[]).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{flex:1,padding:"8px 0",borderRadius:9,border:"none",background:tab===t?"var(--bg3)":"transparent",color:tab===t?"var(--text0)":"var(--text2)",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"var(--mono)",transition:"all 0.2s"}}>
            {t==="single"?"Single Send":"Bulk Send"}
          </button>
        ))}
      </div>

      {/* ══ SINGLE SEND ══════════════════════════════════════════════════════ */}
      {tab==="single" && (
        <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:22}}>
          {/* Token selector */}
          <div style={{marginBottom:18,position:"relative"}}>
            <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:8}}>Token</p>
            <button onClick={()=>setShowDrop(!showDrop)}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"10px 14px",cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:28,height:28,borderRadius:"50%",background:activeBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff"}}>{activeSym.slice(0,2)}</div>
                <div style={{textAlign:"left"}}>
                  <div style={{fontWeight:700,fontSize:14}}>{activeSym}</div>
                  <div style={{fontSize:11,color:"var(--text2)",fontFamily:"var(--mono)"}}>Balance: {fmtBal}</div>
                </div>
              </div>
              <span style={{color:"var(--text2)",fontSize:12}}>▾</span>
            </button>
            {showDrop&&(
              <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,zIndex:100,overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
                {BUILTIN.map(t=>(
                  <button key={t.sym} onClick={()=>{setSelSym(t.sym);setShowDrop(false);}}
                    style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:selSym===t.sym?"var(--bg3)":"transparent",border:"none",cursor:"pointer",textAlign:"left"}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:t.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff"}}>{t.sym.slice(0,2)}</div>
                    <div><div style={{fontWeight:700,fontSize:13}}>{t.sym}</div><div style={{fontSize:11,color:"var(--text2)"}}>{t.name}</div></div>
                  </button>
                ))}
                <div style={{borderTop:"1px solid var(--border)",padding:"10px 14px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"var(--text2)",marginBottom:6,fontFamily:"var(--mono)"}}>CUSTOM TOKEN</div>
                  <input placeholder="0x contract address…" value={custAddr}
                    onChange={e=>{setCustAddr(e.target.value);setSelSym("CUSTOM");}}
                    style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"7px 10px",fontSize:12,color:"var(--text0)",fontFamily:"var(--mono)",boxSizing:"border-box"}}/>
                  {fetching&&<div style={{fontSize:11,color:"var(--text2)",marginTop:4}}>Looking up…</div>}
                  {custInfo&&<div style={{fontSize:11,color:"var(--green)",marginTop:4,fontFamily:"var(--mono)"}}>✓ {custInfo.sym} ({custInfo.dec} dec) · bal: {custBal.toFixed(custInfo.dec>=8?8:2)}</div>}
                  {selSym==="CUSTOM"&&custAddr&&!isAddr(custAddr)&&<div style={{fontSize:11,color:"var(--red)",marginTop:4}}>Invalid address</div>}
                  {selSym==="CUSTOM"&&custInfo&&<button onClick={()=>setShowDrop(false)} style={{marginTop:6,padding:"5px 14px",borderRadius:8,border:"none",background:"var(--cyan)",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer"}}>Use {custInfo.sym}</button>}
                </div>
              </div>
            )}
          </div>

          {/* Recipient */}
          <div style={{marginBottom:16}}>
            <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:8}}>Recipient</p>
            <input placeholder="0x address…" value={recipient} onChange={e=>setRecip(e.target.value)}
              style={{width:"100%",background:"var(--bg2)",border:`1px solid ${recipient&&!validAddr?"var(--red)":"var(--border)"}`,borderRadius:12,padding:"12px 14px",fontSize:14,color:"var(--text0)",fontFamily:"var(--mono)",boxSizing:"border-box"}}/>
            {recipient&&!validAddr&&<p style={{fontSize:11,color:"var(--red)",marginTop:4,fontFamily:"var(--mono)"}}>Invalid address</p>}
          </div>

          {/* Amount */}
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}>Amount</p>
              {wallet.connected&&<span style={{fontSize:11,color:"var(--cyan)",fontFamily:"var(--mono)",fontWeight:600,cursor:"pointer"}} onClick={()=>setAmt(fmtBal)}>MAX: {fmtBal}</span>}
            </div>
            <div className="token-box">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="number" placeholder="0.00" value={amount} onChange={e=>setAmt(e.target.value)}
                  style={{flex:1,background:"none",border:"none",outline:"none",fontSize:28,fontWeight:700,color:"var(--text0)",fontFamily:"var(--mono)",minWidth:0}}/>
                <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:50,padding:"6px 12px",fontWeight:700,fontSize:13,flexShrink:0}}>{activeSym}</div>
              </div>
              <div style={{fontSize:12,color:"var(--text2)",marginTop:8,fontFamily:"var(--mono)"}}>
                {amtN>0 ? (activeSym==="USDC"||activeSym==="EURC" ? `≈ $${amtN.toFixed(2)}` : `${amtN} ${activeSym}`) : "$0.00"}
              </div>
            </div>
          </div>

          {/* Button */}
          {!wallet.connected
            ? <button onClick={openModal} className="swap-btn connect-state">Connect Wallet</button>
            : <button disabled={!canSend} onClick={handleSend} className={canSend?"swap-btn ready":"swap-btn disabled-state"} style={{margin:0}}>
                {sending&&<span className="spinner"/>}
                {sending?status||"Sending…":`Send ${amtN>0?amount+" ":""}${activeSym}`}
              </button>
          }

          {/* Last TX */}
          {lastTx&&(
            <div className="fade-in" style={{marginTop:14,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px"}}>
              <p style={{fontSize:11,fontWeight:700,color:"var(--green)",marginBottom:6}}>✓ Last Transaction</p>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"var(--mono)",marginBottom:4}}>
                <span style={{color:"var(--text2)"}}>Amount</span><span>{lastTx.amt} {lastTx.sym}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"var(--mono)",marginBottom:4}}>
                <span style={{color:"var(--text2)"}}>To</span><span>{lastTx.to.slice(0,10)}…{lastTx.to.slice(-6)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"var(--mono)"}}>
                <span style={{color:"var(--text2)"}}>TX</span>
                <a href={`${ARC_EXPLORER}/tx/${lastTx.hash}`} target="_blank" rel="noopener noreferrer" style={{color:"var(--cyan)",textDecoration:"none"}}>{lastTx.hash.slice(0,10)}…{lastTx.hash.slice(-6)} ↗</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ BULK SEND ════════════════════════════════════════════════════════ */}
      {tab==="bulk" && (
        <div>

          <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:22}}>
            {/* Token selector */}
            <div style={{marginBottom:16}}>
              <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)",marginBottom:8}}>Token</p>
              <div style={{display:"flex",gap:8}}>
                {BUILTIN.map(t=>(
                  <button key={t.sym} onClick={()=>setBulkSym(t.sym)}
                    style={{flex:1,padding:"10px 0",borderRadius:12,border:"1px solid",borderColor:bulkSym===t.sym?t.bg+"99":"var(--border)",background:bulkSym===t.sym?t.bg+"18":"var(--bg2)",cursor:"pointer",transition:"all 0.2s"}}>
                    <div style={{fontSize:12,fontWeight:700,color:bulkSym===t.sym?"#fff":"var(--text1)"}}>{t.sym}</div>
                    <div style={{fontSize:10,color:"var(--text2)",fontFamily:"var(--mono)",marginTop:2}}>
                      {wallet.connected?getBal(wallet.balances,t.sym).toFixed(t.dec>=8?8:2):"—"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Input textarea */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <p style={{fontSize:10,fontWeight:700,color:"var(--text2)",textTransform:"uppercase",letterSpacing:"0.8px",fontFamily:"var(--mono)"}}>Recipients</p>
                <span style={{fontSize:10,color:"var(--text2)",fontFamily:"var(--mono)"}}>one per line · address, amount</span>
              </div>
              <textarea
                rows={7}
                placeholder={"0xA1c...6a8, 10\n0xD77...a19, 25.5\n0xG6b...a75, 10"}
                value={bulkInput}
                onChange={e=>{setBulkInput(e.target.value);parseBulkInput(e.target.value);setBulkDone(false);}}
                disabled={bulkRunning}
                style={{width:"100%",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 14px",fontSize:12,color:"var(--text0)",fontFamily:"var(--mono)",resize:"vertical",boxSizing:"border-box",lineHeight:1.7,outline:"none"}}
              />
            </div>

            {/* Preview table */}
            {bulkRows.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <p style={{fontSize:11,fontWeight:700,color:"var(--text2)",fontFamily:"var(--mono)"}}>
                    {validRows.length}/{bulkRows.length} valid · Total: <strong style={{color:"var(--text0)"}}>{totalBulk.toFixed(bulkDec>=8?8:2)} {bulkSym}</strong>
                  </p>
                  {wallet.connected&&totalBulk>bulkBal&&(
                    <span style={{fontSize:10,color:"var(--red)",fontFamily:"var(--mono)"}}>⚠ Insufficient balance</span>
                  )}
                </div>
                <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
                  {bulkRows.map((row,i)=>{
                    const hasErr=row.addrErr||row.amtErr;
                    const isDone=row.status==="success";
                    const isFail=row.status==="failed";
                    const isSending=row.status==="sending";
                    return (
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",borderRadius:9,background:isDone?"rgba(0,200,150,0.07)":isFail?"rgba(224,65,90,0.07)":hasErr?"rgba(224,65,90,0.05)":"var(--bg2)",border:`1px solid ${isDone?"rgba(0,200,150,0.25)":isFail?"rgba(224,65,90,0.25)":hasErr?"rgba(224,65,90,0.2)":"var(--border)"}`}}>
                        {/* Status icon */}
                        <div style={{width:18,flexShrink:0,textAlign:"center",fontSize:13}}>
                          {isDone?"✓":isFail?"✗":isSending?<span className="spinner" style={{borderTopColor:"var(--cyan)",width:12,height:12}}/>:hasErr?"!":i+1}
                        </div>
                        {/* Address */}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:12,fontFamily:"var(--mono)",color:hasErr?"var(--red)":"var(--text1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {row.address||<em style={{color:"var(--text2)"}}>missing</em>}
                          </div>
                          {row.addrErr&&<div style={{fontSize:10,color:"var(--red)"}}>{row.addrErr}</div>}
                        </div>
                        {/* Amount */}
                        <div style={{fontSize:12,fontFamily:"var(--mono)",color:row.amtErr?"var(--red)":"var(--text0)",flexShrink:0,textAlign:"right"}}>
                          {row.amount||"—"} {!row.amtErr&&bulkSym}
                          {row.amtErr&&<div style={{fontSize:10,color:"var(--red)"}}>{row.amtErr}</div>}
                        </div>
                        {/* TX link */}
                        {isDone&&row.txHash&&(
                          <a href={`${ARC_EXPLORER}/tx/${row.txHash}`} target="_blank" rel="noopener noreferrer"
                            style={{fontSize:10,color:"var(--green)",fontFamily:"var(--mono)",textDecoration:"none",flexShrink:0}}>↗</a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Summary */}
            {validRows.length>0&&(
              <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:"10px 14px",marginBottom:16}}>
                {[
                  ["Recipients",    `${validRows.length} addresses`],
                  ["Total amount",  `${totalBulk.toFixed(bulkDec>=8?8:2)} ${bulkSym}`],
                  ["Transactions",  "1 (via MultiSend contract)"],
                  ["Signatures",    "1 approve + 1 send"],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",fontFamily:"var(--mono)"}}>
                    <span style={{color:"var(--text2)"}}>{k}</span>
                    <span style={{color:k==="Transactions"||k==="Signatures"?"var(--green)":"var(--text1)",fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Status */}
            {bulkStatus&&(
              <div style={{marginBottom:14,fontSize:12,fontFamily:"var(--mono)",color:bulkDone?"var(--green)":bulkStatus.startsWith("❌")?"var(--red)":"var(--cyan)",display:"flex",alignItems:"center",gap:8}}>
                {bulkRunning&&<span className="spinner" style={{borderTopColor:"var(--cyan)"}}/>}
                {bulkStatus}
              </div>
            )}

            {/* Buttons */}
            <div style={{display:"flex",gap:10}}>
              {!wallet.connected
                ? <button onClick={openModal} className="swap-btn connect-state" style={{flex:1}}>Connect Wallet</button>
                : <>
                    <button
                      disabled={!canMultiSend||totalBulk>bulkBal}
                      onClick={handleBulkSend}
                      className={canMultiSend&&totalBulk<=bulkBal?"swap-btn ready":"swap-btn disabled-state"}
                      style={{flex:1,margin:0}}>
                      {bulkRunning&&<span className="spinner"/>}
                      {bulkRunning?"Sending…":bulkDone?"Send Again":`Send to ${validRows.length} addresses`}
                    </button>
                    {(bulkRows.length>0||bulkDone)&&(
                      <button onClick={resetBulk} disabled={bulkRunning}
                        style={{padding:"0 16px",borderRadius:14,border:"1px solid var(--border)",background:"var(--bg2)",color:"var(--text2)",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"var(--mono)"}}>
                        Clear
                      </button>
                    )}
                  </>
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
}