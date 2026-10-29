"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserGroupIcon, Calendar03Icon, Edit01Icon, QrCode01Icon, Settings02Icon, Logout01Icon, Menu01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";

const links = [
  { href: "/staff", label: "Staff", icon: UserGroupIcon },
  { href: "/attendance", label: "Attendance", icon: Calendar03Icon },
  { href: "/attendance/manual", label: "Manual entry", icon: Edit01Icon },
  { href: "/qr-codes", label: "QR codes", icon: QrCode01Icon },
  { href: "/environment", label: "Environment", icon: Settings02Icon },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  async function logout() { await fetch("/api/company-auth/logout", { method: "POST" }); router.replace("/login"); }
  return <div className="min-h-screen md:flex">
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-black/[.06] bg-white px-4 py-5 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <Link href="/staff" className="mb-8 flex h-16 items-center justify-start border-b border-black/[.06] px-3 pb-5" onClick={() => setOpen(false)} aria-label="Xaadir home">
        <span className="flex h-12 w-full items-center rounded-xl bg-white px-1">
          <Image src="/images/xaadirlogo.png" alt="Xaadir" width={190} height={48} priority unoptimized className="block h-auto max-h-12 w-[190px] object-contain object-left" />
        </span>
      </Link>
      <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-neutral-400">Workspace</div>
      <nav className="space-y-1">
        {links.map(link => { const active = pathname === link.href || (link.href !== "/attendance" && pathname.startsWith(`${link.href}/`)); return <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition ${active ? "bg-black text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-100 hover:text-black"}`}>
          <HugeiconsIcon icon={link.icon} size={19} strokeWidth={1.7} />{link.label}{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
        </Link>; })}
      </nav>
      <div className="mt-auto">
        <div className="mb-4 rounded-2xl bg-neutral-50 p-4"><p className="text-xs font-semibold">Need a hand?</p><p className="mt-1 text-[11px] leading-5 text-neutral-500">Your workspace is ready for a productive day.</p><span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-neutral-700">Help centre <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} /></span></div>
        <div className="flex items-center gap-3 border-t border-black/[.06] px-2 pt-4">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</div>
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">Workspace admin</p><p className="text-[10px] text-neutral-500">Account settings</p></div>
          <button onClick={logout} aria-label="Log out" title="Log out" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-black"><HugeiconsIcon icon={Logout01Icon} size={18} /></button>
        </div>
      </div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-black/[.05] bg-white/90 px-5 backdrop-blur-xl md:px-9">
        <div className="flex items-center gap-3"><button className="rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><HugeiconsIcon icon={Menu01Icon} size={20} /></button><span className="text-xs font-medium text-neutral-500">Workspace <span className="mx-1.5 text-neutral-300">/</span><span className="text-neutral-800">{links.find(link => pathname === link.href || (link.href !== "/attendance" && pathname.startsWith(`${link.href}/`)))?.label ?? "Overview"}</span></span></div>
        <div className="hidden items-center gap-2 text-[11px] text-neutral-500 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />All systems operational</div>
      </header>
      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 md:px-9 md:py-8">{children}</div>
    </main>
  </div>;
}
