"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Input, Loading, Notice, PageHeading } from "@/components/ui";

type HrAccount = { id: string; full_name: string; email: string; phone: string; must_change_password: boolean; created_at: string };
type IssuedCredentials = { full_name: string; email: string; phone: string; temporary_password: string };

export function HrTeamManager() {
  const [accounts, setAccounts] = useState<HrAccount[]>([]);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "" });
  const [credentials, setCredentials] = useState<IssuedCredentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/company-hr", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load the HR team.");
      setAccounts(Array.isArray(body) ? body : []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the HR team.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setCredentials(null);
    try {
      const response = await fetch("/api/company-hr", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create the HR login.");
      setCredentials({ ...body.hr, temporary_password: body.temporary_password });
      setForm({ full_name: "", email: "", phone: "" });
      setNotice("HR login created. Share the temporary password securely; it is shown only once.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the HR login.");
    } finally { setBusy(false); }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(`Xaadir HR login\nName: ${credentials.full_name}\nEmail: ${credentials.email}\nTemporary password: ${credentials.temporary_password}\nChange this password immediately after signing in.`);
      setNotice("Login details copied. Share them privately with the HR member.");
    } catch (reason) {
      setError(reason instanceof Error ? `Could not copy login details: ${reason.message}` : "Could not copy login details.");
    }
  }

  return <>
    <PageHeading eyebrow="Company workspace" title="HR team" description="Give trusted HR members their own sign-in to manage this company workspace." action={<span className="rounded-xl border border-black/[.06] bg-white px-3.5 py-2.5 text-xs font-medium text-neutral-600">{accounts.length} HR {accounts.length === 1 ? "account" : "accounts"}</span>} />
    {error && <div className="mb-4"><Notice error>{error}</Notice></div>}
    {notice && <div className="mb-4"><Notice>{notice}</Notice></div>}
    {credentials && <div className="mb-5"><Card className="border-emerald-200 bg-emerald-50/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Temporary login · share once</p><h2 className="mt-1 text-lg font-semibold">{credentials.full_name}</h2><p className="mt-1 text-xs leading-5 text-neutral-600">This HR member must change the temporary password at first sign-in. The password will not be shown again after you dismiss this panel.</p></div><Button type="button" onClick={() => void copyCredentials()} className="shrink-0">Copy login details</Button></div>
      <div className="mt-4 grid gap-3 rounded-xl border border-emerald-100 bg-white p-4 text-sm sm:grid-cols-3"><div><p className="text-[10px] text-neutral-400">Login email</p><p className="mt-1 break-all font-semibold">{credentials.email}</p></div><div><p className="text-[10px] text-neutral-400">Phone</p><p className="mt-1 font-semibold">{credentials.phone}</p></div><div><p className="text-[10px] text-neutral-400">Temporary password</p><p className="mt-1 break-all font-mono font-bold text-emerald-800">{credentials.temporary_password}</p></div></div>
      <button type="button" onClick={() => setCredentials(null)} className="mt-3 text-xs text-neutral-500 hover:text-black">Dismiss credentials</button>
    </Card></div>}
    <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
      <Card><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Add access</p><h2 className="mt-1 text-lg font-semibold">Create HR login</h2><p className="mb-5 mt-1 text-xs leading-5 text-neutral-500">Creates a separate Supabase Auth login linked to this company. The account can sign in at the usual Xaadir company login.</p>
        <form className="space-y-4" onSubmit={createAccount}>
          <Field label="Full name"><Input required maxLength={120} value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} /></Field>
          <Field label="Email · login"><Input type="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Phone"><Input type="tel" required minLength={6} maxLength={30} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="+252…" /></Field>
          <p className="rounded-xl bg-neutral-50 p-3 text-[11px] leading-5 text-neutral-500">All HR accounts have the same access to this company workspace. Only create accounts for trusted team members.</p>
          <Button className="w-full" disabled={busy}>{busy ? "Creating HR login…" : "Create HR login"}</Button>
        </form>
      </Card>
      <Card className="min-w-0 p-0"><div className="border-b border-neutral-100 p-5"><h2 className="font-semibold">Company HR accounts</h2><p className="mt-1 text-xs text-neutral-500">Each person signs in with their own email and password.</p></div>
        {loading ? <div className="p-5"><Loading text="Loading HR accounts…" /></div> : accounts.length === 0 ? <p className="p-8 text-center text-sm text-neutral-500">No HR logins found for this company.</p> : <div className="divide-y divide-neutral-100">{accounts.map((account, index) => <div key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{account.full_name}</p><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${index === 0 ? "bg-neutral-100 text-neutral-700" : "bg-indigo-50 text-indigo-700"}`}>{index === 0 ? "Original HR" : "HR member"}</span></div><p className="mt-1 break-all text-xs text-neutral-500">{account.email} <span className="mx-1 text-neutral-300">·</span> {account.phone}</p><p className="mt-1 text-[10px] text-neutral-400">Added {new Date(account.created_at).toLocaleDateString()} · {account.must_change_password ? "Password change required" : "Login active"}</p></div></div>)}</div>}
      </Card>
    </div>
  </>;
}
