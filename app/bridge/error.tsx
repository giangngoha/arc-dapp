"use client";
import { useEffect } from "react";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div style={{ maxWidth: 480, margin: "60px auto", padding: "0 24px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
      <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, fontFamily: "var(--mono)", lineHeight: 1.6 }}>
        {error?.message ?? "An unexpected error occurred."}
      </p>
      <button onClick={reset} style={{ padding: "10px 24px", borderRadius: 10, border: "1px solid rgba(0,229,255,0.3)", background: "rgba(0,229,255,0.08)", color: "var(--cyan)", fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        Try again
      </button>
    </div>
  );
}
