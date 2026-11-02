"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Button, Input, Notice } from "@/components/ui";
import xaadirLogo from "../../../public/images/xaadirlogo.png";

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

  return <main className="grid min-h-screen place-items-center bg-neutral-100 px-4 py-10">
    <form onSubmit={submit} className="w-full max-w-md space-y-6 rounded-3xl border border-neutral-200/80 bg-white p-7 shadow-[0_24px_70px_rgba(0,0,0,.07)] sm:p-10">
      <div className="flex h-14 w-[190px] items-center"><Image src={xaadirLogo} alt="Xaadir" priority className="block h-auto w-full object-contain object-left" /></div>
      <div><h1 className="text-3xl font-bold tracking-tight">HR sign in</h1><p className="mt-2 text-sm text-neutral-500">Sign in to your Xaadir workspace.</p></div>
      {error && <Notice error>{error}</Notice>}
      <label className="block space-y-2"><span className="text-sm font-semibold">Work email</span><Input autoComplete="username" name="email" type="email" required /></label>
      <label className="block space-y-2"><span className="text-sm font-semibold">Password</span><Input autoComplete="current-password" name="password" type="password" required /></label>
      <div className="-mt-3 text-right"><Link className="text-sm font-semibold text-forest underline-offset-4 hover:underline" href="/forgot-password">Forgot password?</Link></div>
      <Button className="w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</Button>
    </form>
  </main>;
}

export default function CompanyLoginPage() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center text-sm text-slate-400">Loading sign in...</div>}><CompanyLoginForm /></Suspense>;
}
