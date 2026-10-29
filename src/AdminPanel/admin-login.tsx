"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export function AdminPanelLogin() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Could not sign in."); setBusy(false); return; }
      router.replace("/admin-panel");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return <main className="grid min-h-screen place-items-center bg-canvas p-5">
    <Card className="w-full max-w-md">
      <div className="mb-7 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-950 font-bold text-white">X</span><div><p className="font-bold">Xaadir</p><p className="text-xs text-slate-500">Developer control panel</p></div></div>
      <p className="text-xs font-bold uppercase tracking-widest text-forest">God mode</p>
      <h1 className="mt-2 text-2xl font-bold">Admin sign in</h1>
      <p className="mt-2 text-sm text-slate-500">Register and provision company workspaces.</p>
      {error && <div className="mt-5"><Notice error>{error}</Notice></div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Admin username"><Input name="username" autoComplete="username" required /></Field>
        <Field label="Admin password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Button className="w-full" disabled={busy}>{busy ? "Signing in..." : "Continue"}</Button>
      </form>
    </Card>
  </main>;
}
