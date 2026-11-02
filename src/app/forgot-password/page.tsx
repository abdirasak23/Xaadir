"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import xaadirLogo from "../../../public/images/xaadirlogo.png";

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_type: "hr", email: form.get("email"), code: form.get("code"), password: form.get("password"), password_confirm: form.get("password_confirm") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not reset password.");
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset password.");
    } finally { setBusy(false); }
  }

  return <main className="grid min-h-screen bg-[#f6f7f8] md:grid-cols-[1fr_1fr]">
    <section className="hidden flex-col justify-between bg-black p-12 text-white md:flex">
      <div className="flex h-[70px] w-[240px] items-center rounded-2xl bg-white px-4"><Image src={xaadirLogo} alt="Xaadir" priority className="h-auto w-full object-contain" /></div>
      <div className="max-w-lg"><p className="mb-4 text-xs font-bold uppercase tracking-[.22em] text-neutral-300">Secure account access</p><h1 className="text-5xl font-bold leading-tight tracking-tight">Back to your team.</h1><p className="mt-5 text-lg leading-8 text-neutral-300">Use a one-time recovery code to choose a new password.</p></div>
      <p className="text-sm text-neutral-500">XAADIR · ACCOUNT RECOVERY</p>
    </section>
    <section className="flex items-center justify-center px-5 py-10 sm:px-8">
      <div className="w-full max-w-md rounded-3xl border border-neutral-100 bg-white p-6 shadow-sm sm:p-9">
        <div className="mb-6 flex h-14 w-44 items-center rounded-xl border border-neutral-100 px-3 md:hidden"><Image src={xaadirLogo} alt="Xaadir" priority className="h-auto w-full object-contain" /></div>
        <p className="text-sm font-semibold text-neutral-500">Account recovery</p><h2 className="mt-1 text-3xl font-bold tracking-tight">Set a new password</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">Enter your HR email and the one-time code issued by the developer administrator.</p>
        {done ? <div className="mt-6 space-y-4"><Notice>Password updated. You can now sign in to the HR panel.</Notice><Link href="/login" className="block text-center text-sm font-semibold underline">Go to sign in</Link></div> : <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <Notice error>{error}</Notice>}
          <label className="block space-y-2"><span className="text-sm font-semibold">HR email</span><Input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
          <label className="block space-y-2"><span className="text-sm font-semibold">One-time recovery code</span><Input name="code" autoComplete="one-time-code" required maxLength={128} /></label>
          <p className="-mt-2 text-xs leading-5 text-slate-500">Ask your developer administrator to issue a recovery code. It expires after 30 minutes and can be used once.</p>
          <label className="block space-y-2"><span className="text-sm font-semibold">New password</span><Input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          <label className="block space-y-2"><span className="text-sm font-semibold">Confirm new password</span><Input name="password_confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          <p className="text-xs text-slate-500">Use at least 12 characters, including uppercase, lowercase, and a number.</p>
          <Button className="w-full" disabled={busy}>{busy ? "Updating password…" : "Update password"}</Button>
          <p className="text-center text-sm text-slate-500"><Link href="/login" className="font-semibold text-black underline-offset-4 hover:underline">Back to sign in</Link></p>
        </form>}
      </div>
    </section>
  </main>;
}
