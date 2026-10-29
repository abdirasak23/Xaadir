"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Notice } from "@/components/ui";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/company-auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "Could not change password."); setBusy(false); return; }
      router.replace("/staff");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change password.");
      setBusy(false);
    }
  }
  async function logout() {
    await fetch("/api/company-auth/logout", { method: "POST" });
    router.replace("/login");
  }
  return <main className="grid min-h-screen place-items-center bg-canvas p-5">
    <Card className="w-full max-w-md">
      <p className="text-xs font-bold uppercase tracking-widest text-forest">One-time account setup</p>
      <h1 className="mt-2 text-2xl font-bold">Choose a new password</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">For security, replace your temporary password before opening your company workspace.</p>
      {error && <div className="mt-5"><Notice error>{error}</Notice></div>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="New password"><Input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></Field>
        <Field label="Confirm new password"><Input name="confirm" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></Field>
        <Button className="w-full" disabled={busy}>{busy ? "Updating..." : "Update password"}</Button>
      </form>
      <button onClick={() => void logout()} className="mt-4 w-full text-sm text-slate-500">Sign out</button>
    </Card>
  </main>;
}
