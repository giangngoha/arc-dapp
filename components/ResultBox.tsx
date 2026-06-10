"use client";
interface Props { result: { success: boolean; data?: unknown; error?: string } | null; }
export default function ResultBox({ result }: Props) {
  if (!result) return null;
  const urls: string[] = [];
  const d = result.data as Record<string, unknown> | undefined;
  if (d) {
    if (typeof d.explorerUrl === "string") urls.push(d.explorerUrl);
    if (Array.isArray(d.steps)) {
      for (const s of d.steps as Record<string, unknown>[]) {
        if (typeof s.explorerUrl === "string") urls.push(s.explorerUrl);
        const sd = s.data as Record<string, unknown> | undefined;
        if (typeof sd?.explorerUrl === "string") urls.push(sd.explorerUrl as string);
      }
    }
  }
  return (
    <div className={`mt-4 rounded-xl border p-4 ${result.success ? "border-green-800 bg-green-950/30" : "border-red-800 bg-red-950/30"}`}>
      <p className={`font-semibold mb-2 ${result.success ? "text-green-400" : "text-red-400"}`}>
        {result.success ? "✅ Transaction Successful" : "❌ Error"}
      </p>
      {result.success ? (
        <div className="space-y-2">
          {urls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm underline">
              🔍 View on Explorer {urls.length > 1 ? `(step ${i + 1})` : ""}
            </a>
          ))}
          <details>
            <summary className="text-gray-500 text-xs cursor-pointer mt-2">View raw JSON</summary>
            <pre className="text-xs text-gray-300 overflow-auto max-h-60 bg-black/40 rounded p-3 mt-2">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </details>
        </div>
      ) : (
        <p className="text-red-300 text-sm font-mono break-all">{result.error}</p>
      )}
    </div>
  );
}
