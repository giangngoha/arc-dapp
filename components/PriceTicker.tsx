"use client";
import { useState, useEffect } from "react";
import { fetchPythPrices, fmtPrice, type PythPrices } from "@/lib/pyth";

const REFRESH_MS = 15000; // refresh every 15 seconds

export default function PriceTicker() {
  const [prices, setPrices] = useState<PythPrices | null>(null);
  const [loading, setLoading]  = useState(true);
  const [lastUpdate, setLast]  = useState<Date | null>(null);
  const [flash, setFlash]      = useState<Record<string, "up"|"down"|null>>({});
  const prevRef = { BTC: 0, EUR: 0 };

  useEffect(() => {
    async function load() {
      const p = await fetchPythPrices();
      setPrices(prev => {
        // Flash animation when price changes
        const f: Record<string, "up"|"down"|null> = {};
        if (prev?.BTC_USD?.price && p.BTC_USD?.price) {
          f.BTC = p.BTC_USD.price > prev.BTC_USD.price ? "up" : p.BTC_USD.price < prev.BTC_USD.price ? "down" : null;
        }
        if (prev?.EUR_USD?.price && p.EUR_USD?.price) {
          f.EUR = p.EUR_USD.price > prev.EUR_USD.price ? "up" : p.EUR_USD.price < prev.EUR_USD.price ? "down" : null;
        }
        if (Object.values(f).some(Boolean)) {
          setFlash(f);
          setTimeout(() => setFlash({}), 800);
        }
        return p;
      });
      setLast(new Date());
      setLoading(false);
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg0)", padding: "5px 24px", display: "flex", gap: 20, alignItems: "center" }}>
        {["cirBTC", "EURC"].map(s => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "var(--mono)", color: "var(--text2)" }}>
            <span style={{ fontWeight: 700, color: "var(--text1)" }}>{s}</span>
            <span style={{ color: "var(--text2)" }}>loading…</span>
          </div>
        ))}
      </div>
    );
  }

  const btc = prices?.BTC_USD;
  const eur = prices?.EUR_USD;

  const items = [
    {
      sym: "cirBTC",
      color: "#F7931A",
      label: "BTC/USD",
      price: btc?.price ?? null,
      decimals: 2,
    },
    {
      sym: "EURC",
      color: "#2B5EDD",
      label: "EUR/USD",
      price: eur?.price ?? null,
      decimals: 4,
    },
    {
      sym: "USDC",
      color: "#2775CA",
      label: "USD",
      price: 1,
      decimals: 2,
      fixed: true,
    },
  ];

  return (
    <div style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--bg0)",
      padding: "5px 24px",
      display: "flex",
      alignItems: "center",
      gap: 24,
      overflowX: "auto",
      scrollbarWidth: "none",
    }}>
      {/* Pyth badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0, marginRight: 4 }}>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#00e5ff", animation: "pulse 2s infinite" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--mono)", fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.8px" }}>
          Pyth live
        </span>
      </div>

      {/* Price items */}
      {items.map(item => {
        const flashDir = item.sym === "cirBTC" ? flash.BTC : item.sym === "EURC" ? flash.EUR : null;
        const priceColor = flashDir === "up" ? "var(--green)" : flashDir === "down" ? "var(--red)" : "var(--text0)";

        return (
          <div key={item.sym} style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            {/* Token dot */}
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: item.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 800, color: "#fff" }}>
              {item.sym === "cirBTC" ? "₿" : item.sym.slice(0, 2)}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text1)", fontFamily: "var(--mono)" }}>
              {item.sym}
            </span>
            <span style={{
              fontSize: 11, fontFamily: "var(--mono)", fontWeight: 600,
              color: priceColor,
              transition: "color 0.3s",
            }}>
              {item.fixed
                ? "$1.0000"
                : item.price != null
                  ? fmtPrice(item.price, { decimals: item.decimals })
                  : "—"}
            </span>
          </div>
        );
      })}

      {/* Spacer + last update */}
      <div style={{ marginLeft: "auto", flexShrink: 0 }}>
        {lastUpdate && (
          <span style={{ fontSize: 9, fontFamily: "var(--mono)", color: "var(--text2)" }}>
            updated {lastUpdate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}