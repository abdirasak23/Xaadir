"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Loading, Notice } from "@/components/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import { FingerPrintIcon, RefreshIcon, SmartphoneIcon, Clock01Icon, Shield01Icon } from "@hugeicons/core-free-icons";

type PanelView = "devices" | "suspicious";
type Device = {
  id: string;
  staff_id: string;
  device_id: string;
  device_name: string | null;
  approved: boolean;
  biometric_status: "none" | "active" | "invalidated";
  biometric_enrolled_at: string | null;
  staff: { full_name: string; staff_code: string } | null;
};
type SecurityEvent = { action: string; created_at: string; staff_name: string };

async function requestAdminDevices(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin-panel/devices", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load device information.");
  return data;
}

function fingerprintLabel(status: Device["biometric_status"], enrolledAt: string | null) {
  if (status === "active") {
    const enrolledDate = enrolledAt ? new Date(enrolledAt).toLocaleDateString() : null;
    return { label: enrolledDate ? `Active · ${enrolledDate}` : "Active", className: "bg-emerald-50 text-emerald-700" };
  }
  if (status === "invalidated") return { label: "Changed, needs approval", className: "bg-rose-50 text-rose-700" };
  return { label: "Not registered", className: "bg-neutral-100 text-neutral-600" };
}

function eventLabel(action: string) {
  if (action === "checkin.rejected:BIOMETRIC_CHANGED") return "Fingerprint changed";
  if (action === "checkin.rejected:BIOMETRIC_FAILED") return "Fingerprint failed";
  if (action === "biometric.invalidated") return "Key invalidated";
  if (action === "biometric.enroll_failed") return "Enrollment failed";
  return action;
}

export function DeviceManager({ view }: { view: PanelView }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDevices = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const data = await requestAdminDevices({ action: "list" });
      setDevices(Array.isArray(data.devices) ? data.devices : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load staff devices."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadEvents = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const data = await requestAdminDevices({ action: "suspicious", limit: 100 });
      const rows: SecurityEvent[] = Array.isArray(data.events) ? data.events : [];
      setEvents(rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load suspicious activity."); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    if (view === "devices") void loadDevices();
    else void loadEvents();
  }, [view, loadDevices, loadEvents]);

  async function approve(device: Device) {
    const confirmed = window.confirm("The staff must register their fingerprint again at the office. Approve re-enrollment?");
    if (!confirmed) return;
    setBusyDevice(device.id); setError(""); setNotice("");
    try {
      await requestAdminDevices({ action: "approve-reenrollment", device_row_id: device.id });
      setNotice(`Fingerprint re-enrollment approved for ${device.staff?.full_name ?? "this staff member"}.`);
      await loadDevices(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not approve fingerprint re-enrollment."); }
    finally { setBusyDevice(null); }
  }

  const isDevices = view === "devices";
  return <section className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-forest">Security management</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{isDevices ? "Staff Devices" : "Suspicious activity"}</h1><p className="mt-2 text-sm text-slate-500">{isDevices ? "Review approved devices and manage fingerprint re-enrollment." : "Recent rejected biometric check-ins and fingerprint security events."}</p></div><button onClick={() => void (isDevices ? loadDevices(true) : loadEvents(true))} disabled={refreshing || loading} className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"><HugeiconsIcon icon={RefreshIcon} size={16} />{refreshing ? "Refreshing…" : "Refresh"}</button></div>
    {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
    {notice && <div className="mb-5"><Notice>{notice}</Notice></div>}
    {loading ? <Card><Loading text={isDevices ? "Loading staff devices…" : "Loading suspicious activity…"} /></Card> : isDevices ? devices.length === 0 ? <Card><div className="py-12 text-center"><HugeiconsIcon icon={SmartphoneIcon} size={28} className="mx-auto text-neutral-300" /><p className="mt-3 text-sm font-medium">No staff devices found</p><p className="mt-1 text-xs text-neutral-500">Registered devices will appear here.</p></div></Card> : <div className="grid gap-4 md:grid-cols-2">{devices.map(device => {
      const fingerprint = fingerprintLabel(device.biometric_status, device.biometric_enrolled_at);
      return <Card key={device.id} className="border-neutral-100 p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100"><HugeiconsIcon icon={SmartphoneIcon} size={19} /></span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{device.device_name || "Unnamed device"}</h2><p className="mt-1 text-xs text-neutral-500">{device.staff?.full_name ?? "Unknown staff"}{device.staff?.staff_code ? ` · ${device.staff.staff_code}` : ""}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${device.approved ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>{device.approved ? "Approved" : "Not approved"}</span></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-medium ${fingerprint.className}`}><HugeiconsIcon icon={FingerPrintIcon} size={14} />Fingerprint · {fingerprint.label}</span>{(device.biometric_status === "active" || device.biometric_status === "invalidated") && <button onClick={() => void approve(device)} disabled={busyDevice === device.id} className="rounded-xl bg-black px-3.5 py-2 text-[11px] font-medium text-white hover:bg-neutral-800 disabled:opacity-50">{busyDevice === device.id ? "Approving…" : "Approve re-enrollment"}</button>}</div></Card>;
    })}</div> : events.length === 0 ? <Card><div className="py-12 text-center"><HugeiconsIcon icon={Shield01Icon} size={28} className="mx-auto text-neutral-300" /><p className="mt-3 text-sm font-medium">No suspicious activity</p><p className="mt-1 text-xs text-neutral-500">Biometric security events will appear here.</p></div></Card> : <Card className="p-0"><div className="divide-y divide-neutral-100">{events.map((event, index) => <article key={`${event.created_at}-${event.action}-${index}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><HugeiconsIcon icon={Clock01Icon} size={17} /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{eventLabel(event.action)}</p><p className="mt-0.5 text-xs text-neutral-500">{event.staff_name || "Unknown staff"}</p></div><time className="text-[11px] text-neutral-500">{new Date(event.created_at).toLocaleString()}</time></article>)}</div></Card>}
  </section>;
}
