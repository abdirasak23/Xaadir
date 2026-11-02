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
  const [bssid, setBssid] = useState("");
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
      setNewBranchName(""); await load(body.id); setNotice("Branch added. Set its location and save.");
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
      else { setNotice("Branch settings saved."); await load(selectedId); }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally { setBusy(false); }
  }
  function addWifi() {
    const normalized = bssid.trim().toUpperCase();
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalized)) { setError("Enter a valid BSSID (AA:BB:CC:DD:EE:FF)."); return; }
    if (wifi.some(item => item.bssid.toLowerCase() === normalized.toLowerCase())) { setError("That BSSID is already registered."); return; }
    if (wifi.length >= 50) { setError("A branch can have up to 50 Wi-Fi networks."); return; }
    setWifi([...wifi, { ssid: `${branchName.trim() || "Office"} Wi-Fi`, bssid: normalized }]); setBssid(""); setError("");
  }

  return <><PageHeading eyebrow="Workspace setup" title="Branches" description="Manage branch locations and check-in requirements." />
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
            <section aria-labelledby="wifi-networks-heading" className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 id="wifi-networks-heading" className="text-sm font-semibold text-neutral-900">Allowed Wi-Fi networks</h3><p className="mt-1 text-xs leading-5 text-slate-500">Add every office access point. Each network is matched by its BSSID.</p></div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{wifi.length}/50</span>
              </div>
              <div className="mt-4"><Field label="Access point BSSID"><Input placeholder="AA:BB:CC:DD:EE:FF" value={bssid} onChange={event => setBssid(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addWifi(); } }} /></Field></div>
              <Button type="button" disabled={wifi.length >= 50} className="mt-3 w-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={addWifi}>Add Wi-Fi network</Button>
              <div className="mt-4 space-y-2">
                {wifi.length ? wifi.map((network, index) => <div key={`${network.bssid}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800">{network.ssid}</p><p className="mt-0.5 font-mono text-[11px] text-slate-500">{network.bssid}</p></div>
                  <button type="button" aria-label={`Remove ${network.ssid}`} onClick={() => { setWifi(wifi.filter((_, itemIndex) => itemIndex !== index)); setError(""); }} className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50">Remove</button>
                </div>) : <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">No Wi-Fi networks added yet. You can add more than one access point.</p>}
              </div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Changes apply after you save.</p>
            </section>
          </div>
          <Button disabled={busy}>{busy ? "Saving..." : "Save branch settings"}</Button>
        </form>
      </Card> : <Card><p className="text-sm text-slate-500">Add your first branch to configure its environment.</p></Card>}
    </div>}
  </>;
}
