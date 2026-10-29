"use client";

import QRCode from "qrcode";
import NextImage from "next/image";
import { useEffect, useState } from "react";
import { Button, Card, Loading, Notice, PageHeading } from "@/components/ui";

type Branch = { id: string; name: string; static_qr_secret: string; live_qr_secret: string };

export function LiveQr({ branchId, liveKey, compact = false }: { branchId: string; liveKey: string; compact?: boolean }) {
  const [image, setImage] = useState("");
  const [remaining, setRemaining] = useState(30);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let expiry = Date.now() + 30000;
    async function refresh() {
      try {
        const response = await fetch("/api/qr/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, liveKey }), cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load live QR.");
        const dataUrl = await QRCode.toDataURL(data.token, { width: compact ? 220 : 320, margin: 2, color: { dark: "#111111", light: "#ffffff" } });
        if (!active) return;
        setImage(dataUrl); setError(""); expiry = Date.now() + 30000;
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not load live QR."); }
    }
    void refresh();
    const interval = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) void refresh();
    }, 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [branchId, liveKey, compact]);
  return <div className="text-center">
    {error && <Notice error>{error}</Notice>}
    {image ? <NextImage src={image} alt="Rotating live check-in QR code" width={compact ? 220 : 320} height={compact ? 220 : 320} unoptimized className="mx-auto rounded bg-white" /> : <div className="grid aspect-square w-full place-items-center bg-[#c8c8c8] text-sm text-neutral-700">{error ? "QR unavailable" : "Preparing QR…"}</div>}
    <p className="mt-3 text-xs font-medium text-neutral-500">Refreshes in <span className="font-semibold tabular-nums text-black">{remaining}s</span></p>
  </div>;
}

export function QrCodesManager() {
  const [mode, setMode] = useState<"static" | "live">("static");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/branches").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load branches.");
      setBranches(data); setSelectedId(data[0]?.id ?? "");
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load branches.")).finally(() => setLoading(false));
  }, []);

  async function downloadStatic(branch: Branch) {
    try {
      const content = `xaadir://checkin?b=${branch.id}&t=${branch.static_qr_secret}`;
      const source = await QRCode.toDataURL(content, { width: 600, margin: 2 });
      const image = new Image(); image.src = source;
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Could not render QR image.")); });
      const canvas = document.createElement("canvas"); canvas.width = 700; canvas.height = 760;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create PNG.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 50, 20, 600, 600);
      context.fillStyle = "#111111"; context.textAlign = "center"; context.font = "bold 30px Poppins, Arial"; context.fillText(branch.name, 350, 690);
      const anchor = document.createElement("a"); anchor.href = canvas.toDataURL("image/png"); anchor.download = `${branch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-static-qr.png`; anchor.click();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not download static QR."); }
  }

  const branch = branches.find(item => item.id === selectedId) ?? branches[0];
  return <>
    <PageHeading eyebrow="Check-in setup" title="QR codes" description="Choose a static code to print or a live code that refreshes automatically." />
    {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
    {loading ? <Card><Loading /></Card> : !branch ? <Card><p className="text-sm text-neutral-500">Create a branch in Environment before generating QR codes.</p></Card> : <div className="mx-auto w-full max-w-3xl">
      {branches.length > 1 && <div className="mb-5 flex justify-center"><select aria-label="Choose branch" value={branch.id} onChange={event => setSelectedId(event.target.value)} className="min-w-52 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium shadow-sm">{branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
      <Card className="min-h-[470px] overflow-hidden px-5 py-8 sm:px-10 sm:py-10">
        <div role="tablist" aria-label="QR type" className="mx-auto mb-10 flex w-full max-w-[560px] rounded-[14px] bg-[#dedede] p-[7px]">
          {([["static", "Static QR"], ["live", "Live QR"]] as const).map(([value, label]) => <button key={value} id={`qr-tab-${value}`} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={`min-h-10 flex-1 rounded-[9px] px-3 text-sm font-medium transition sm:text-base ${mode === value ? "bg-[#222] text-white shadow-sm" : "bg-white text-neutral-800 hover:bg-neutral-50"}`}>{label}</button>)}
        </div>
        <section role="tabpanel" aria-labelledby={`qr-tab-${mode}`} className="mx-auto flex max-w-xl flex-col items-center text-center">
          <p className="mb-5 text-sm font-medium text-neutral-600">{branch.name}</p>
          {mode === "static" ? <><div className="grid h-[240px] w-[240px] place-items-center bg-[#c8c8c8] p-2 sm:h-[260px] sm:w-[260px]"><StaticQr branch={branch} /></div><p className="mt-4 text-xs text-neutral-500">Permanent check-in code</p><Button className="mt-5 min-w-48" onClick={() => void downloadStatic(branch)}>Download static QR</Button></> : <><div className="grid w-[240px] place-items-center bg-[#c8c8c8] p-2 sm:w-[260px]"><LiveQr branchId={branch.id} liveKey={branch.live_qr_secret} compact /></div><p className="mt-4 text-xs text-neutral-500">The code refreshes automatically for secure check-ins.</p><a className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs font-medium hover:bg-neutral-50" href={`/qr/live/${branch.id}?k=${encodeURIComponent(branch.live_qr_secret)}`} target="_blank" rel="noreferrer">Open live QR in new tab</a></>}
        </section>
      </Card>
    </div>}
  </>;
}

function StaticQr({ branch }: { branch: Branch }) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(`xaadir://checkin?b=${branch.id}&t=${branch.static_qr_secret}`, { width: 240, margin: 2 }).then(value => { if (active) setImage(value); });
    return () => { active = false; };
  }, [branch.id, branch.static_qr_secret]);
  return image ? <NextImage src={image} alt={`Permanent check-in QR for ${branch.name}`} width={240} height={240} unoptimized className="mx-auto w-[220px] bg-white" /> : <div className="h-[220px] w-[220px] animate-pulse bg-[#c8c8c8]" />;
}
