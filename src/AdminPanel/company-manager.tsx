"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Loading, Notice, PageHeading } from "@/components/ui";
import { DeviceManager } from "@/AdminPanel/device-manager";

type AdminView = "companies" | "devices" | "suspicious";

type Company = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  company_admins: { full_name: string; email: string; phone: string }[];
};
type Credentials = { company: string; fullName: string; email: string; phone: string; password: string };

export function CompanyManager() {
  const router = useRouter();
  const [view, setView] = useState<AdminView>("companies");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({ company_name: "", full_name: "", email: "", phone: "" });
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin-panel/companies", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load companies.");
      setCompanies(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load companies.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setCredentials(null);
    try {
      const response = await fetch("/api/admin-panel/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create company.");
      setCredentials({
        company: result.company.name,
        fullName: result.company_admin.full_name,
        email: result.company_admin.email,
        phone: result.company_admin.phone,
        password: result.temporary_password,
      });
      setForm({ company_name: "", full_name: "", email: "", phone: "" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create company.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/admin-panel/login");
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      await navigator.clipboard.writeText(
        `Xaadir company: ${credentials.company}\nHR login: ${credentials.email}\nTemporary password: ${credentials.password}\nChange this temporary password after signing in.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? `Could not copy login details: ${reason.message}` : "Could not copy login details.");
    }
  }

  return <main className="min-h-screen">
    <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-emerald-950/5 bg-white/95 px-5 backdrop-blur md:px-10">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-950 font-bold text-white">X</span><div><p className="font-bold">Xaadir control</p><p className="text-[11px] text-slate-500">Developer admin</p></div></div>
      <button onClick={() => void signOut()} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Log out</button>
    </header>
    <div className="mx-auto max-w-6xl px-5 pt-6 md:px-10"><div role="tablist" aria-label="Admin panel sections" className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-neutral-100 p-1">{([["companies","Companies"],["devices","Staff Devices"],["suspicious","Suspicious activity"]] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={view===key} onClick={()=>setView(key)} className={`rounded-lg px-3 py-2 text-xs font-medium transition sm:px-4 ${view===key?"bg-white text-black shadow-sm":"text-neutral-500 hover:text-black"}`}>{label}</button>)}</div></div>
    {view === "companies" ? <div className="mx-auto max-w-6xl px-5 py-8 md:px-10 md:py-12">
      <PageHeading eyebrow="Platform administration" title="Companies" description="Create company workspaces and issue the first HR login. Company HR teams manage their own branches and staff." action={<span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-forest">{companies.length} companies</span>} />
      {error && <div className="mb-5"><Notice error>{error}</Notice></div>}
      {credentials && <div className="mb-6"><Card className="border-emerald-200 bg-emerald-50/50">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-forest">Company created · share once</p><h2 className="mt-1 text-xl font-bold">{credentials.company}</h2><p className="mt-2 text-sm text-slate-600">Give these initial credentials to the HR contact. The temporary password is shown only in this response, and they must change it at first sign-in.</p></div><Button onClick={() => void copyCredentials()} className="shrink-0">Copy login details</Button></div>
        <dl className="mt-5 grid gap-3 rounded-xl border border-emerald-100 bg-white p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-slate-400">HR contact</dt><dd className="mt-1 font-semibold">{credentials.fullName}</dd></div><div><dt className="text-xs text-slate-400">Login email</dt><dd className="mt-1 font-semibold">{credentials.email}</dd></div><div><dt className="text-xs text-slate-400">Phone</dt><dd className="mt-1 font-semibold">{credentials.phone}</dd></div><div><dt className="text-xs text-slate-400">Temporary password</dt><dd className="mt-1 font-mono font-bold text-forest">{credentials.password}</dd></div></dl>
        <button onClick={() => setCredentials(null)} className="mt-3 text-xs text-slate-500">Dismiss credentials</button>
      </Card></div>}
      <div className="grid items-start gap-6 lg:grid-cols-[390px_1fr]">
        <Card><p className="text-xs font-bold uppercase tracking-widest text-forest">New workspace</p><h2 className="mt-1 text-lg font-bold">Register a company</h2><p className="mb-5 mt-1 text-xs leading-5 text-slate-500">Creates the company and its first HR Supabase Auth account.</p>
          <form onSubmit={createCompany} className="space-y-4">
            <Field label="Company name"><Input required maxLength={120} value={form.company_name} onChange={event => setForm({ ...form, company_name: event.target.value })} placeholder="Example Company Ltd" /></Field>
            <Field label="HR full name"><Input required maxLength={120} value={form.full_name} onChange={event => setForm({ ...form, full_name: event.target.value })} /></Field>
            <Field label="HR email (login)"><Input type="email" required maxLength={254} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="HR phone"><Input type="tel" required minLength={6} maxLength={30} value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} placeholder="+252..." /></Field>
            <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Temporary password rule: <b>Xd</b> followed by the last 4 digits of the HR phone number. Only the Supabase Auth password hash is stored.</p>
            <Button className="w-full" disabled={busy}>{busy ? "Creating company..." : "Create company and HR login"}</Button>
          </form>
        </Card>
        <Card className="min-w-0 p-0"><div className="border-b border-slate-100 p-5"><h2 className="font-bold">Registered companies</h2><p className="mt-1 text-xs text-slate-500">Company workspace and assigned HR login.</p></div>
          {loading ? <Loading /> : companies.length === 0 ? <p className="p-8 text-center text-sm text-slate-400">No companies registered yet.</p> :
            <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">HR contact</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Created</th></tr></thead><tbody className="divide-y divide-slate-100">{companies.map(company => { const admin = company.company_admins?.[0]; return <tr key={company.id}><td className="px-4 py-4 font-semibold">{company.name}</td><td className="px-4 py-4"><p>{admin?.full_name ?? "—"}</p><p className="text-xs text-slate-400">{admin?.email}</p></td><td className="px-4 py-4"><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-forest">{company.status}</span></td><td className="px-4 py-4 text-xs text-slate-500">{new Date(company.created_at).toLocaleDateString()}</td></tr>; })}</tbody></table></div>}
        </Card>
      </div>
    </div> : <DeviceManager view={view} />}
  </main>;
}
