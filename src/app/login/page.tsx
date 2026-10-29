"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Notice } from "@/components/ui";

function CompanyLoginForm() {
  const router = useRouter();
  const query = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/company-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Could not sign in.");
        setBusy(false);
        return;
      }
      router.replace(result.must_change_password ? "/change-password" : query.get("next") || "/staff");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen bg-white md:grid-cols-[1fr_1fr]">
    <section className="hidden flex-col justify-between bg-forest p-12 text-white md:flex">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 text-xl font-bold">X</span><span className="text-xl font-bold">xaadir</span></div>
      <div className="max-w-lg"><p className="mb-4 text-xs font-bold uppercase tracking-[.22em] text-emerald-100">People, in sync</p><h1 className="text-5xl font-bold leading-tight tracking-tight">A clearer view of your team.</h1><p className="mt-5 text-lg leading-8 text-emerald-50/80">Simple staff administration and attendance, all in one calm workspace.</p></div>
      <p className="text-sm text-emerald-50/60">XAADIR · COMPANY WORKSPACE</p>
    </section>
    <section className="flex items-center justify-center px-6 py-12">
      <form onSubmit={submit} className="w-full max-w-sm space-y-6">
        <div className="md:hidden"><span className="text-xl font-bold text-forest">xaadir</span></div>
        <div><p className="text-sm font-semibold text-forest">Welcome back</p><h2 className="mt-2 text-3xl font-bold tracking-tight">Company sign in</h2><p className="mt-2 text-sm text-slate-500">Sign in with the company HR email and password.</p></div>
        {error && <Notice error>{error}</Notice>}
        <label className="block space-y-2"><span className="text-sm font-semibold">Work email</span><Input autoComplete="username" name="email" type="email" required /></label>
        <label className="block space-y-2"><span className="text-sm font-semibold">Password</span><Input autoComplete="current-password" name="password" type="password" required /></label>
        <Button className="w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<span aria-hidden>→</span></Button>
        <p className="text-center text-xs text-slate-400">New accounts must change their temporary password.</p>
      </form>
    </section>
  </main>;
}

export default function CompanyLoginPage() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-400">Loading sign in...</div>}><CompanyLoginForm /></Suspense>;
}
