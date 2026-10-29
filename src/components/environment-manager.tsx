"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { MapPicker } from "@/components/map-picker";
import { Button, Card, Field, Input, Loading, Notice, PageHeading } from "@/components/ui";

type Wifi = { id?: string; ssid: string; bssid: string };
type Branch = { id: string; name: string; lat: number; lng: number; radius_m: number; public_ip: string | null; wifi: Wifi[] };

export function EnvironmentManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [branchName, setBranchName] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [lat, setLat] = useState(0), [lng, setLng] = useState(0);
  const [radius, setRadius] = useState(100), [publicIp, setPublicIp] = useState("");
  const [wifi, setWifi] = useState<Wifi[]>([]);
  const [ssid, setSsid] = useState(""), [bssid, setBssid] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async (preferred?: string) => {
    try {
      const response = await fetch("/api/branches"), body = await response.json();
      if (!response.ok) { setError(body.error ?? "Could not load branches."); setLoading(false); return; }
      setBranches(body);
      const id = preferred || selectedId || body[0]?.id || "";
      setSelectedId(id);
      const selected = body.find((branch: Branch) => branch.id === id) ?? body[0];
      if (selected) applyBranch(selected);
      setLoading(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load branches.");
      setLoading(false);
    }
  }, [selectedId]);
  function applyBranch(branch: Branch) {
    setBranchName(branch.name); setLat(branch.lat); setLng(branch.lng); setRadius(branch.radius_m);
    setPublicIp(branch.public_ip ?? ""); setWifi(branch.wifi ?? []);
  }
  useEffect(() => { void load(); }, [load]);
  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      const response = await fetch("/api/branches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newBranchName }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "Branch could not be created."); return; }
      setNewBranchName(""); await load(body.id); setNotice("Branch added. Set its map location and save the environment.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Branch could not be created.");
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/branches", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, name: branchName, lat, lng, radius_m: radius, public_ip: publicIp, wifi }) });
      const body = await response.json();
      if (!response.ok) setError(body.error ?? "Settings could not be saved.");
      else { setNotice("Branch environment saved."); await load(selectedId); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally { setBusy(false); }
  }
  function addWifi() {
    const normalized = bssid.trim().toUpperCase();
    if (!ssid.trim() || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized)) { setError("Enter an SSID and a valid BSSID (AA:BB:CC:DD:EE:FF)."); return; }
    if (wifi.some(item => item.bssid.toLowerCase() === normalized.toLowerCase())) { setError("That BSSID is already registered."); return; }
    setWifi([...wifi, { ssid: ssid.trim(), bssid: normalized }]); setSsid(""); setBssid(""); setError("");
  }

  return <><PageHeading eyebrow="Configuration" title="Environment" description="Set trusted locations and Wi-Fi networks for each branch." />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}{notice && <div className="mb-4"><Notice>{notice}</Notice></div>}
    {loading ? <Card><Loading /></Card> : <div className="grid items-start gap-6 xl:grid-cols-[320px_1fr]">
      <Card><h2 className="text-lg font-bold">Branches</h2><p className="mt-1 text-xs text-slate-500">Each branch has its own check-in rules and QR codes.</p>
        <div className="mt-5 space-y-2">{branches.map(branch => <button key={branch.id} onClick={() => { setSelectedId(branch.id); applyBranch(branch); setError(""); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm ${selectedId === branch.id ? "bg-mint font-semibold text-forest" : "hover:bg-slate-50"}`}><span>{branch.name}</span><span>›</span></button>)}</div>
        <form className="mt-6 border-t border-slate-100 pt-5" onSubmit={createBranch}><Field label="Add a branch"><Input required placeholder="e.g. Hargeisa HQ" value={newBranchName} onChange={event => setNewBranchName(event.target.value)} /></Field><Button className="mt-3 w-full">Add branch</Button></form>
      </Card>
      {selectedId ? <Card><div className="mb-5"><h2 className="text-lg font-bold">Branch setup</h2><p className="mt-1 text-xs text-slate-500">Choose the office location and check-in verification options.</p></div>
        <form onSubmit={save} className="space-y-6">
          <Field label="Branch name"><Input required value={branchName} onChange={event => setBranchName(event.target.value)} /></Field>
          <div><div className="mb-3 flex items-center justify-between"><div><span className="text-sm font-semibold text-neutral-800">Office location</span><p className="mt-0.5 text-xs text-neutral-500">Place the pin or enter the coordinates.</p></div><span className="rounded-lg bg-neutral-100 px-2.5 py-1.5 text-[10px] font-medium text-neutral-600">{lat.toFixed(5)}, {lng.toFixed(5)}</span></div><MapPicker lat={lat} lng={lng} onChange={(newLat, newLng) => { setLat(newLat); setLng(newLng); }} /><div className="mt-3 grid grid-cols-2 gap-3"><Field label="Latitude"><Input type="number" step="any" value={lat} onChange={event => setLat(Number(event.target.value))} /></Field><Field label="Longitude"><Input type="number" step="any" value={lng} onChange={event => setLng(Number(event.target.value))} /></Field></div></div>
          <Field label={`Allowed check-in radius · ${radius}m`}><input aria-label="Allowed check-in radius" type="range" min="25" max="2000" step="25" value={radius} onChange={event => setRadius(Number(event.target.value))} className="w-full accent-forest" /></Field>
          <div className="grid gap-6 md:grid-cols-2"><Field label="Office public IP (optional)"><Input placeholder="203.0.113.10" value={publicIp} onChange={event => setPublicIp(event.target.value)} /></Field>
            <div><p className="mb-2 text-xs font-semibold text-slate-600">Allowed Wi-Fi networks</p><div className="flex gap-2"><Input placeholder="SSID" value={ssid} onChange={event => setSsid(event.target.value)} /><Input placeholder="AA:BB:CC:DD:EE:FF" value={bssid} onChange={event => setBssid(event.target.value)} /></div><Button type="button" className="mt-2 w-full bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={addWifi}>Add network</Button>
              <div className="mt-3 space-y-2">{wifi.map((network, index) => <div key={`${network.bssid}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"><span><b>{network.ssid}</b><span className="ml-2 text-slate-400">{network.bssid}</span></span><button type="button" onClick={() => setWifi(wifi.filter((_, itemIndex) => itemIndex !== index))} className="text-rose-600">Remove</button></div>)}</div></div>
          </div>
          <p className="rounded-xl bg-emerald-50 px-4 py-3 text-xs text-emerald-800">BSSID can also be registered from the Flutter app later.</p>
          <Button disabled={busy}>{busy ? "Saving..." : "Save environment"}</Button>
        </form>
      </Card> : <Card><p className="text-sm text-slate-500">Add your first branch to configure its environment.</p></Card>}
    </div>}
  </>;
}
