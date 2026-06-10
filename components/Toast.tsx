"use client";
import { useEffect, useState } from "react";
export interface ToastMsg { id:number; ok:boolean; title:string; msg:string }
let _l: ((t:ToastMsg)=>void)[] = []; let _c=0;
export function showToast(ok:boolean, title:string, msg:string) {
  const t={id:++_c,ok,title,msg}; _l.forEach(f=>f(t));
}
export default function ToastContainer() {
  const [list,setList]=useState<ToastMsg[]>([]);
  useEffect(()=>{ const h=(t:ToastMsg)=>{ setList(p=>[...p,t]); setTimeout(()=>setList(p=>p.filter(x=>x.id!==t.id)),4000); }; _l.push(h); return ()=>{_l=_l.filter(f=>f!==h);}; },[]);
  return <div className="toast-wrap">{list.map(t=>(
    <div key={t.id} className="toast" style={{borderColor:t.ok?"rgba(0,200,150,0.3)":"rgba(224,65,90,0.3)"}}>
      <span className="toast-icon">{t.ok?"✅":"❌"}</span>
      <div><p className="toast-title" style={{color:t.ok?"var(--cyan)":"var(--red)"}}>{t.title}</p><p className="toast-msg">{t.msg}</p></div>
    </div>
  ))}</div>;
}
