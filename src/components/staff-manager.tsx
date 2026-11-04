"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Field, Input, Loading, Notice, PageHeading } from "@/components/ui";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon, SmartphoneIcon, RefreshIcon } from "@hugeicons/core-free-icons";

type Branch = { id: string; name: string };
type Shift = { start: string; end: string; day?: number };
type Staff = { id: string; full_name: string; staff_code: string; phone: string; email: string; job_title: string; branch_id: string; shift_start: string; shift_end: string; scheduled_shifts?: Shift[]; check_in_method: "biometric" | "selfie"; monthly_salary?: number; annual_leave_days: number; status: string; invite_status: string; branches?: { name: string } };
type LeaveRecord = { id: string; staff_id: string; leave_type: string; start_date: string; end_date: string; status: string; reason: string };
type HolidayRecord = { date: string; branch_id: string | null };
type StaffDeviceRequest = { id: string; device_name: string | null; status: "pending" | "approved" | "rejected"; requested_at: string; staff: { id: string; full_name: string; staff_code: string; branch_id: string; branches: { name: string } | null } };
type StaffRecoveryCode = { code: string; email: string; full_name: string; expires_at: string; text: string; link: string };
const weekDays = [{ day: 1, label: "Monday" }, { day: 2, label: "Tuesday" }, { day: 3, label: "Wednesday" }, { day: 4, label: "Thursday" }, { day: 5, label: "Friday" }, { day: 6, label: "Saturday" }, { day: 0, label: "Sunday" }];
const defaultShift: Shift = { start: "09:00", end: "17:00" };
const initialWeek = () => Object.fromEntries(weekDays.map(({ day }) => [day, [{ ...defaultShift }]])) as Record<number, Shift[]>;
const emptyForm = { full_name: "", staff_code: "", email: "", phone: "", job_title: "", branch_id: "", shift_start: "09:00", shift_end: "17:00", scheduled_shifts: [{ ...defaultShift }], schedule_mode: "same" as "same" | "weekly", weekly_shifts: initialWeek(), check_in_method: "biometric" as "biometric" | "selfie", monthly_salary: 0, annual_leave_days: 21 };

function StaffDeviceApprovals() {
  const [requests, setRequests] = useState<StaffDeviceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/staff-devices", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load devices.");
      setRequests(Array.isArray(body.requests) ? body.requests : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load devices.");
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function approve(device: StaffDeviceRequest) {
    if (!window.confirm(`Approve ${device.device_name || "this phone"} for ${device.staff.full_name}? This phone will be allowed to check in for this staff account.`)) return;
    setBusyId(device.id); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff-devices", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", request_id: device.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not approve this phone.");
      setNotice(`${device.device_name || "Phone"} approved for ${device.staff.full_name}. They can now tap Check again in the app.`);
      await load(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not approve this phone.");
    } finally { setBusyId(null); }
  }

  const pending = requests.filter(request => request.status === "pending");
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Device approvals</h2><p className="mt-1 text-xs text-neutral-500">Review phones that need permission to check in.</p></div><button onClick={() => void load(true)} disabled={refreshing || loading} className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50"><HugeiconsIcon icon={RefreshIcon} size={15} />{refreshing ? "Refreshing..." : "Refresh"}</button></div>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {loading ? <Card><Loading text="Loading device requests..." /></Card> : requests.length === 0 ? <Card><div className="py-12 text-center"><HugeiconsIcon icon={SmartphoneIcon} size={28} className="mx-auto text-neutral-300" /><p className="mt-3 text-sm font-medium">No device requests</p><p className="mt-1 text-xs text-neutral-500">Requests appear here when staff ask to use a new phone.</p></div></Card> : <>
      <div className="grid gap-3 sm:grid-cols-3"><Card><p className="text-xs text-neutral-500">Awaiting approval</p><p className="mt-2 text-2xl font-semibold">{pending.length}</p></Card><Card><p className="text-xs text-neutral-500">Approved requests</p><p className="mt-2 text-2xl font-semibold">{requests.filter(request => request.status === "approved").length}</p></Card><Card><p className="text-xs text-neutral-500">Total requests</p><p className="mt-2 text-2xl font-semibold">{requests.length}</p></Card></div>
      <div className="grid gap-3 lg:grid-cols-2">{requests.map(device => <Card key={device.id} className="border-neutral-100 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100"><HugeiconsIcon icon={SmartphoneIcon} size={19} /></span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{device.device_name || "Phone"}</h3><p className="mt-1 text-xs text-neutral-600">{device.staff.full_name} · {device.staff.staff_code}</p><p className="mt-1 text-[11px] text-neutral-400">{device.staff.branches?.name || "Branch not set"} · Requested {new Date(device.requested_at).toLocaleString()}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium ${device.status === "approved" ? "bg-emerald-50 text-emerald-700" : device.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{device.status === "approved" ? "Approved" : device.status === "rejected" ? "Rejected" : "Pending"}</span></div>{device.status === "pending" && <div className="mt-4 flex justify-end border-t border-neutral-100 pt-3"><button onClick={() => void approve(device)} disabled={busyId === device.id} className="rounded-xl bg-black px-4 py-2.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50">{busyId === device.id ? "Approving..." : "Approve phone"}</button></div>}</Card>)}</div>
    </>}
  </section>;
}

export function StaffManager() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [holidays, setHolidays] = useState<HolidayRecord[]>([]);
  const [leaveProfile, setLeaveProfile] = useState<Staff | null>(null);
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [invite, setInvite] = useState<{ code: string; text: string; link: string } | null>(null);
  const [staffRecovery, setStaffRecovery] = useState<StaffRecoveryCode | null>(null);
  const [recoveryBusyId, setRecoveryBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<"staff" | "devices">("staff");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [branchResponse, staffResponse, leaveResponse] = await Promise.all([fetch("/api/branches"), fetch(`/api/staff?q=${encodeURIComponent(search)}&branch=${encodeURIComponent(branchFilter)}`), fetch("/api/leave")]);
      const branchData = await branchResponse.json(), staffData = await staffResponse.json(), leaveData = await leaveResponse.json();
      if (!branchResponse.ok || !staffResponse.ok || !leaveResponse.ok) setError(branchData.error ?? staffData.error ?? leaveData.error ?? "Could not load staff.");
      else {
        setBranches(branchData);
        setStaff(staffData);
        setLeaveRecords(leaveData.leaves ?? []);
        setHolidays(leaveData.holidays ?? []);
        setForm(current => ({
          ...current,
          branch_id: current.branch_id || branchData[0]?.id || "",
        }));
        setError("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load staff.");
    } finally { setLoading(false); }
  }, [search, branchFilter]);
  useEffect(() => { void load(); }, [load]);
  const hasBranches = branches.length > 0;
  const filtered = useMemo(() => staff, [staff]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setFormError(""); setMessage("");
    const scheduled = form.schedule_mode === "weekly"
      ? weekDays.flatMap(({ day }) => (form.weekly_shifts[day] ?? []).map(({ start, end }) => ({ day, start, end })))
      : form.scheduled_shifts;
    if (!scheduled.length) { setFormError("Add at least one scheduled shift before saving."); setBusy(false); return; }
    const requestBody = { ...form, shift_start: scheduled[0].start, shift_end: scheduled[0].end, scheduled_shifts: scheduled };
    try {
      const response = await fetch(editing ? `/api/staff/${editing}` : "/api/staff", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) });
      const body = await response.json();
      if (!response.ok) { setFormError(body.error ?? "Could not save staff. Your entries are still here; correct the highlighted schedule and try again."); setError(""); }
      else {
        setMessage(editing ? "Staff profile updated." : `Account created for ${body.email}. Initial password: "Xd" + the last 4 digits of their phone number.`);
        setForm({ ...emptyForm, branch_id: branches[0]?.id ?? "" }); setEditing(null); setFormOpen(false); setFormError(""); await load();
      }
    } catch (reason) {
      setFormError(`${reason instanceof Error ? reason.message : "Could not save staff."} Your entries are still here. Please try again.`);
    } finally { setBusy(false); }
  }
  function edit(person: Staff) {
    setEditing(person.id);
    const shifts = person.scheduled_shifts?.length ? person.scheduled_shifts : [{ start: person.shift_start.slice(0, 5), end: person.shift_end.slice(0, 5) }];
    const isWeekly = shifts.some(shift => shift.day !== undefined);
    const weekly_shifts = initialWeek();
    if (isWeekly) {
      for (const day of weekDays) weekly_shifts[day.day] = shifts.filter(shift => shift.day === day.day).map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }));
    }
    const dailyShifts = isWeekly ? [{ ...defaultShift }] : shifts.map(({ start, end }) => ({ start: start.slice(0, 5), end: end.slice(0, 5) }));
    setForm({ ...emptyForm, full_name: person.full_name, staff_code: person.staff_code, email: person.email, phone: person.phone, job_title: person.job_title, branch_id: person.branch_id, shift_start: dailyShifts[0].start, shift_end: dailyShifts[dailyShifts.length - 1].end, scheduled_shifts: dailyShifts, schedule_mode: isWeekly ? "weekly" : "same", weekly_shifts, check_in_method: person.check_in_method ?? "biometric", monthly_salary: person.monthly_salary ?? 0, annual_leave_days: person.annual_leave_days ?? 21 });
    setFormError("");
    setFormOpen(true);
  }
  async function deactivate(person: Staff) {
    if (!window.confirm(`Deactivate ${person.full_name}?`)) return;
    try {
      const response = await fetch(`/api/staff/${person.id}`, { method: "DELETE" }), body = await response.json();
      if (!response.ok) setError(body.error ?? "Could not deactivate staff."); else await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not deactivate staff.");
    }
  }
  async function sendInvite(person: Staff) {
    setError(""); setMessage("");
    try {
      const response = await fetch(`/api/staff/${person.id}/invite`, { method: "POST" }), body = await response.json();
      if (!response.ok) { setError(body.error ?? "Could not send invite."); return; }
      const text = `Welcome to Xaadir! Company: Xaadir. Branch: ${body.branch_name}. Staff code: ${person.staff_code}. Invite code: ${body.invite_code}. Login email: ${person.email}.`;
      setInvite({ code: body.invite_code, text, link: `https://wa.me/?text=${encodeURIComponent(text)}` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send invite.");
    }
  }

  async function issueStaffRecovery(person: Staff) {
    if (!window.confirm(`Issue a one-time password reset code for ${person.full_name}? Any previous unused reset code will stop working. The new code expires in 30 minutes.`)) return;
    setError(""); setMessage(""); setStaffRecovery(null); setRecoveryBusyId(person.id);
    try {
      const response = await fetch(`/api/staff/${person.id}/recovery-code`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not issue staff recovery code.");
      const text = `Xaadir password reset code for ${body.full_name}: ${body.code}. It expires at ${new Date(body.expires_at).toLocaleString()}. Enter this code in Forgot password in the Xaadir app.`;
      setStaffRecovery({ ...body, text, link: `https://wa.me/?text=${encodeURIComponent(text)}` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not issue staff recovery code.");
    } finally { setRecoveryBusyId(null); }
  }

  async function copyStaffRecovery() {
    if (!staffRecovery) return;
    try {
      await navigator.clipboard.writeText(staffRecovery.text);
      setMessage("Staff reset code copied. Share it with the staff member through a trusted channel.");
    } catch (reason) {
      setError(reason instanceof Error ? `Could not copy reset code: ${reason.message}` : "Could not copy reset code.");
    }
  }

  return <><PageHeading eyebrow="People directory" title="Your team" description="Manage your people, their roles and branch details in one place." action={tab === "staff" ? <div className="flex items-center gap-3"><span className="rounded-xl border border-black/[.06] bg-white px-3.5 py-2.5 text-xs font-medium text-neutral-600">{staff.length} team members</span><Button onClick={() => { setEditing(null); setForm({ ...emptyForm, branch_id: branches[0]?.id ?? "" }); setFormError(""); setFormOpen(true); }}><HugeiconsIcon icon={Add01Icon} size={17} />Add staff</Button></div> : null} />
    {error && <Notice error>{error}</Notice>}{message && <div className="mb-4"><Notice>{message}</Notice></div>}
    <div className="mb-5 inline-flex gap-1 rounded-xl bg-neutral-100 p-1" role="tablist" aria-label="Staff management"><button type="button" role="tab" aria-selected={tab === "staff"} onClick={() => setTab("staff")} className={`rounded-lg px-4 py-2 text-xs font-medium ${tab === "staff" ? "bg-white text-black shadow-sm" : "text-neutral-500 hover:text-black"}`}>Staff</button><button type="button" role="tab" aria-selected={tab === "devices"} onClick={() => setTab("devices")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium ${tab === "devices" ? "bg-white text-black shadow-sm" : "text-neutral-500 hover:text-black"}`}><HugeiconsIcon icon={SmartphoneIcon} size={15} />Device approvals</button></div>
    {tab === "devices" ? <StaffDeviceApprovals /> : <>
    {invite && <div className="mb-5"><Card><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Invite code: <span className="font-mono text-forest">{invite.code}</span></p><p className="mt-1 text-xs text-slate-500">Valid for 7 days. Share the one-time activation details securely.</p></div><div className="flex gap-2"><a className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold" href={`https://wa.me/?text=${encodeURIComponent(invite.text)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a><button className="text-sm text-slate-400" onClick={() => setInvite(null)}>Dismiss</button></div></div></Card></div>}
    {staffRecovery && <div className="mb-5"><Card className="border-amber-200 bg-amber-50/60"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-amber-800">Staff password reset code · share securely</p><h2 className="mt-1 text-base font-semibold">{staffRecovery.full_name}</h2><p className="mt-1 text-xs text-slate-600">Give this code to the staff member so they can set a new password in the mobile app. It expires in 30 minutes and works once.</p><div className="mt-3 inline-flex flex-wrap items-center gap-3 rounded-xl border border-amber-100 bg-white px-4 py-3"><code className="text-xl font-bold tracking-[.2em]">{staffRecovery.code}</code><span className="text-xs text-slate-500">{staffRecovery.email} · expires {new Date(staffRecovery.expires_at).toLocaleString()}</span></div></div><div className="flex shrink-0 gap-2"><button type="button" onClick={() => void copyStaffRecovery()} className="rounded-xl bg-black px-4 py-2.5 text-xs font-semibold text-white hover:bg-neutral-800">Copy reset details</button><a className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold" href={staffRecovery.link} target="_blank" rel="noreferrer">Share on WhatsApp</a><button type="button" aria-label="Dismiss reset code" className="rounded-xl px-2 text-sm text-slate-500 hover:bg-white" onClick={() => setStaffRecovery(null)}>Dismiss</button></div></div></Card></div>}
    <div className="grid items-start gap-6">
      {formOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget) setFormOpen(false); }}><Card className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-b-none sm:rounded-[20px]">
      <div className="mb-5 flex items-start justify-between"><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Team directory</p><h2 className="text-xl font-semibold">{editing ? "Edit team member" : "Add a team member"}</h2><p className="mt-1 text-xs text-slate-500">{editing ? "Update employee details." : "Creates a staff login account automatically."}</p></div><button onClick={() => setFormOpen(false)} aria-label="Close" className="rounded-lg p-2 hover:bg-neutral-100"><HugeiconsIcon icon={Cancel01Icon} size={18} /></button></div>
      <Card>{formError && <div className="mb-4"><Notice error>{formError}</Notice></div>}<h2 className="mb-1 text-lg font-bold">{editing ? "Edit staff" : "Add staff"}</h2><p className="mb-5 text-xs text-slate-500">{editing ? "Update employee details." : "Creates a Supabase login account automatically."}</p>
        {!hasBranches && <div className="mb-4"><Notice error>Add a branch in Environment before creating staff.</Notice></div>}
        <form className="space-y-4" onSubmit={save}>
          <Field label="Full name"><Input required value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Staff code"><Input required placeholder="e.g. stf-9908" value={form.staff_code} onChange={event => setForm({ ...form, staff_code: event.target.value })} /></Field><Field label="Phone"><Input required value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></Field></div>
          <Field label="Personal email"><Input type="email" required value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Job title"><Input required value={form.job_title} onChange={event => setForm({ ...form, job_title: event.target.value })} /></Field>
          <Field label="Branch"><select required value={form.branch_id} onChange={event => setForm({ ...form, branch_id: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-forest"><option value="" disabled>Select a branch</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
          <Field label="Check-in method"><select value={form.check_in_method} onChange={event => setForm({ ...form, check_in_method: event.target.value as "biometric" | "selfie" })} className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-forest"><option value="biometric">Fingerprint / face recognition</option><option value="selfie">Selfie</option></select><span className="mt-1 block text-[11px] text-neutral-500">Choose the verification method this staff member should use in the mobile app.</span></Field>
          <Field label="Monthly salary"><Input type="number" min="0" step="0.01" required value={form.monthly_salary} onChange={event => setForm({ ...form, monthly_salary: Number(event.target.value) })} /><span className="mt-1 block text-[11px] text-neutral-500">Base monthly pay used for late and unexcused absence deductions.</span></Field>
          <div className="rounded-2xl border border-neutral-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-sm font-semibold">Work schedule</p><p className="mt-1 text-xs text-neutral-500">Overnight shifts are supported. Counted lateness starts after 5 minutes.</p></div>
              <div className="inline-flex rounded-lg bg-neutral-100 p-1"><button type="button" onClick={() => setForm({ ...form, schedule_mode: "same" })} className={`rounded-md px-3 py-1.5 text-xs font-medium ${form.schedule_mode === "same" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>Same each day</button><button type="button" onClick={() => setForm(current => ({ ...current, schedule_mode: "weekly", weekly_shifts: Object.fromEntries(weekDays.map(({ day }) => [day, current.weekly_shifts[day]?.length ? current.weekly_shifts[day] : current.scheduled_shifts.map(shift => ({ ...shift }))])) }))} className={`rounded-md px-3 py-1.5 text-xs font-medium ${form.schedule_mode === "weekly" ? "bg-white text-black shadow-sm" : "text-neutral-500"}`}>By day</button></div>
            </div>
            {form.schedule_mode === "same" ? <div className="mt-4 space-y-2">{form.scheduled_shifts.map((shift, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-xl bg-neutral-50 p-3"><Field label={`Shift ${index + 1} starts`}><Input type="time" required value={shift.start} onChange={event => { const scheduled_shifts = form.scheduled_shifts.map((item, i) => i === index ? { ...item, start: event.target.value } : item); setForm({ ...form, scheduled_shifts, shift_start: scheduled_shifts[0].start, shift_end: scheduled_shifts[scheduled_shifts.length - 1].end }); }} /></Field><Field label="Ends"><Input type="time" required value={shift.end} onChange={event => { const scheduled_shifts = form.scheduled_shifts.map((item, i) => i === index ? { ...item, end: event.target.value } : item); setForm({ ...form, scheduled_shifts, shift_start: scheduled_shifts[0].start, shift_end: scheduled_shifts[scheduled_shifts.length - 1].end }); }} /></Field><button type="button" disabled={form.scheduled_shifts.length === 1} onClick={() => { const scheduled_shifts = form.scheduled_shifts.filter((_, i) => i !== index); setForm({ ...form, scheduled_shifts, shift_start: scheduled_shifts[0].start, shift_end: scheduled_shifts[scheduled_shifts.length - 1].end }); }} className="mb-2 rounded-lg px-2 py-2 text-xs font-medium text-rose-600 disabled:opacity-30">Remove</button></div>)}<button type="button" disabled={form.scheduled_shifts.length >= 8} onClick={() => setForm({ ...form, scheduled_shifts: [...form.scheduled_shifts, { start: "15:00", end: "21:00" }] })} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs font-semibold hover:bg-neutral-50 disabled:opacity-40">+ Add shift</button></div> : <div className="mt-4 space-y-3">{weekDays.map(({ day, label }) => <div key={day} className="rounded-xl bg-neutral-50 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">{label}</p><button type="button" disabled={(form.weekly_shifts[day] ?? []).length >= 8} onClick={() => setForm({ ...form, weekly_shifts: { ...form.weekly_shifts, [day]: [...(form.weekly_shifts[day] ?? []), { start: "09:00", end: "17:00" }] } })} className="text-xs font-semibold text-neutral-600 hover:text-black disabled:opacity-40">+ Add shift</button></div>{(form.weekly_shifts[day] ?? []).length ? <div className="space-y-2">{form.weekly_shifts[day].map((shift, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border border-neutral-200 bg-white p-2"><Field label={`Shift ${index + 1} starts`}><Input type="time" required value={shift.start} onChange={event => setForm({ ...form, weekly_shifts: { ...form.weekly_shifts, [day]: form.weekly_shifts[day].map((item, i) => i === index ? { ...item, start: event.target.value } : item) } })} /></Field><Field label="Ends"><Input type="time" required value={shift.end} onChange={event => setForm({ ...form, weekly_shifts: { ...form.weekly_shifts, [day]: form.weekly_shifts[day].map((item, i) => i === index ? { ...item, end: event.target.value } : item) } })} /></Field><button type="button" onClick={() => setForm({ ...form, weekly_shifts: { ...form.weekly_shifts, [day]: form.weekly_shifts[day].filter((_, i) => i !== index) } })} className="mb-2 rounded-lg px-2 py-2 text-xs font-medium text-rose-600">Remove</button></div>)}</div> : <p className="text-[11px] text-neutral-400">No shift scheduled · day off</p>}</div>)}</div>}
            <input type="hidden" value={form.shift_start} readOnly /><input type="hidden" value={form.shift_end} readOnly />
          </div>
          <Field label="Annual leave days per year"><Input type="number" min="0" max="365" required value={form.annual_leave_days} onChange={event => setForm({ ...form, annual_leave_days: Number(event.target.value) })} /></Field>
          <Button className="w-full" disabled={busy || !hasBranches}>{busy ? "Saving..." : editing ? "Save changes" : "Create staff account"}</Button>
          <button type="button" className="w-full text-sm text-slate-500" onClick={() => { setEditing(null); setForm({ ...emptyForm, branch_id: branches[0]?.id ?? "" }); setFormOpen(false); }}>Cancel</button>
        </form>
      </Card></Card></div>}
      <Card className="min-w-0 p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">Team directory</h2><p className="mt-1 text-xs text-slate-500">Search by name, code or email.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Input placeholder="Search staff..." value={search} onChange={event => setSearch(event.target.value)} /><select aria-label="Filter by branch" className="rounded-xl border border-slate-200 px-3 py-2 text-sm" value={branchFilter} onChange={event => setBranchFilter(event.target.value)}><option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div></div>
        {loading ? <Loading /> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-400">No staff members yet.</div> :
          <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr>{["Staff member", "Contact", "Branch", "Check-in method", "Leave balance", "Status", "Invite", "Actions"].map(item => <th key={item} className="px-4 py-3 font-semibold">{item}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(person => { const year = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Mogadishu", year: "numeric" }).format(new Date()); const annualUsed = leaveRecords.filter(item => item.staff_id === person.id && item.status === "approved" && item.leave_type === "annual" && item.start_date.startsWith(year)).reduce((total, item) => { const d = new Date(`${item.start_date}T00:00:00Z`), end = new Date(`${item.end_date}T00:00:00Z`); let count = 0; while (d <= end) { const date = d.toISOString().slice(0, 10); if (d.getUTCDay() !== 5 && !holidays.some(h => h.date === date && (h.branch_id === null || h.branch_id === person.branch_id))) count++; d.setUTCDate(d.getUTCDate() + 1); } return total + count; }, 0); const allowance = person.annual_leave_days ?? 21; const method = person.check_in_method ?? "biometric"; return <tr key={person.id} className="hover:bg-slate-50/70"><td className="px-4 py-4"><p className="font-semibold">{person.full_name}</p><p className="text-xs text-slate-400">{person.staff_code} · {person.job_title}</p></td><td className="px-4 py-4 text-xs leading-5 text-slate-500">{person.phone}<br />{person.email}</td><td className="px-4 py-4 text-xs">{person.branches?.name ?? "—"}</td><td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${method === "selfie" ? "bg-violet-50 text-violet-700" : "bg-neutral-100 text-neutral-700"}`}>{method === "selfie" ? "Selfie" : "Fingerprint / face"}</span></td><td className="px-4 py-4"><button onClick={() => setLeaveProfile(person)} className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100">{Math.max(0, allowance - annualUsed)} / {allowance} days</button></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${person.status === "active" ? "bg-emerald-50 text-forest" : "bg-slate-100 text-slate-500"}`}>{person.status}</span></td><td className="px-4 py-4 text-xs capitalize text-slate-500">{person.invite_status}</td><td className="px-4 py-4"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><button onClick={() => void sendInvite(person)} className="font-semibold text-forest hover:underline">Invite</button>{person.status === "active" && person.invite_status === "accepted" && <button disabled={recoveryBusyId === person.id} onClick={() => void issueStaffRecovery(person)} className="whitespace-nowrap font-semibold text-neutral-700 hover:text-black disabled:opacity-50">{recoveryBusyId === person.id ? "Issuing code…" : "Reset password"}</button>}<button onClick={() => edit(person)} className="text-slate-500 hover:text-ink">Edit</button>{person.status === "active" && <button onClick={() => void deactivate(person)} className="text-rose-600 hover:underline">Deactivate</button>}</div></td></tr>; })}</tbody></table></div>}
      </Card>
    </div>
    </>}
    {tab === "staff" && leaveProfile && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={event => { if (event.target === event.currentTarget) setLeaveProfile(null); }}><Card className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-b-none sm:rounded-[20px]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Leave history</p><h2 className="mt-1 text-lg font-semibold">{leaveProfile.full_name}</h2><p className="mt-1 text-xs text-neutral-500">Annual allowance: {leaveProfile.annual_leave_days ?? 21} days. Edit this in the staff profile.</p></div><button onClick={() => setLeaveProfile(null)} className="rounded-lg px-3 py-2 text-sm hover:bg-neutral-100">Close</button></div><div className="mt-5 space-y-2">{leaveRecords.filter(item => item.staff_id === leaveProfile.id).slice(0, 8).map(item => <div key={item.id} className="rounded-xl bg-neutral-50 p-3"><div className="flex justify-between gap-3"><span className="text-sm font-medium capitalize">{item.leave_type} · {item.status}</span><span className="text-xs text-neutral-500">{item.start_date} – {item.end_date}</span></div><p className="mt-1 text-xs text-neutral-500">{item.reason}</p></div>)}{leaveRecords.every(item => item.staff_id !== leaveProfile.id) && <p className="py-5 text-center text-sm text-neutral-400">No leave history yet.</p>}</div></Card></div>}
  </>;
}
