"use client";

import Link from "next/link";
import Image from "next/image";
import xaadirLogo from "../../public/images/xaadirlogo.png";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { UserGroupIcon, Calendar03Icon, Edit01Icon, QrCode01Icon, Settings02Icon, Logout01Icon, Menu01Icon, ArrowUpRight01Icon, Money01Icon, WhatsappIcon, Calendar01Icon } from "@hugeicons/core-free-icons";

const links = [
  { href: "/staff", label: "Staff", icon: UserGroupIcon },
  { href: "/attendance", label: "Attendance", icon: Calendar03Icon },
  { href: "/schedule", label: "Schedule", icon: Calendar01Icon },
  { href: "/payroll", label: "Payroll", icon: Money01Icon },
  { href: "/leave", label: "Leave", icon: Calendar03Icon },
  { href: "/attendance/manual", label: "Manual entry", icon: Edit01Icon },
  { href: "/qr-codes", label: "QR codes", icon: QrCode01Icon },
  { href: "/environment", label: "Branches", icon: Settings02Icon },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    setDesktopSidebarOpen(window.localStorage.getItem("xaadir-sidebar-hidden") !== "true");
  }, []);
  const whatsappUrl = `https://wa.me/252906753517?text=${encodeURIComponent("Hi Xaadir, I need help with my workspace.")}`;
  function toggleNavigation() {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setDesktopSidebarOpen(current => {
        const next = !current;
        window.localStorage.setItem("xaadir-sidebar-hidden", String(!next));
        return next;
      });
      return;
    }
    setOpen(current => !current);
  }
  async function logout() { await fetch("/api/company-auth/logout", { method: "POST" }); router.replace("/login"); }
  return <div className="min-h-screen md:flex">
    {open && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col overflow-hidden border-r border-black/[.06] bg-white px-4 py-5 transition-all duration-200 md:sticky md:top-0 md:h-screen ${open ? "translate-x-0" : "-translate-x-full"} ${desktopSidebarOpen ? "md:ml-0 md:translate-x-0" : "md:-ml-[264px] md:-translate-x-full"}`}>
      <Link href="/staff" className="mb-6 flex h-16 shrink-0 items-center justify-start border-b border-black/[.06] px-3 pb-5" onClick={() => setOpen(false)} aria-label="Xaadir home">
        <span className="flex h-12 w-full items-center rounded-xl bg-white px-1">
          <Image src={xaadirLogo} alt="Xaadir" priority className="block h-auto max-h-12 w-[190px] object-contain object-left" />
        </span>
      </Link>
      <button type="button" onClick={() => setOpen(false)} className="absolute right-5 top-7 rounded-lg px-2 py-1.5 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 md:hidden" aria-label="Close navigation">Close</button>
      <div className="mb-3 shrink-0 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-neutral-400">Workspace</div>
      <nav aria-label="Workspace navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pb-3">
        {links.map(link => { const active = pathname === link.href || (link.href !== "/attendance" && pathname.startsWith(`${link.href}/`)); return <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium transition ${active ? "bg-black text-white shadow-sm" : "text-neutral-600 hover:bg-neutral-100 hover:text-black"}`}>
          <HugeiconsIcon icon={link.icon} size={19} strokeWidth={1.7} />{link.label}{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white" />}
        </Link>; })}
      </nav>
      <div className="mt-2 shrink-0 border-t border-black/[.06] pt-3">
        <a href={whatsappUrl} target="_blank" rel="noreferrer" className="mb-3 flex items-center gap-3 rounded-2xl bg-neutral-50 p-3.5 transition hover:bg-neutral-100">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-neutral-900 shadow-sm"><HugeiconsIcon icon={WhatsappIcon} size={19} /></span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">Need help?</span><span className="mt-0.5 block text-[10px] text-neutral-500">Chat with Xaadir support</span></span>
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} className="text-neutral-400" />
        </a>
        <div className="relative">
          {accountMenuOpen && <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-black/[.08] bg-white p-1.5 shadow-xl">
            <Link href="/hr-team" onClick={() => { setAccountMenuOpen(false); setOpen(false); }} className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 hover:text-black">
              <HugeiconsIcon icon={UserGroupIcon} size={17} /> Manage HR access
            </Link>
          </div>}
          <div className="flex items-center gap-2 rounded-xl px-1 py-1">
            <button onClick={() => setAccountMenuOpen(value => !value)} aria-expanded={accountMenuOpen} aria-label="Open account menu" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-neutral-50">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black text-xs font-semibold text-white">A</div>
              <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-400">Account</p><p className="truncate text-xs font-semibold">Workspace admin</p></div>
            </button>
            <button onClick={logout} aria-label="Log out" title="Log out" className="rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 hover:text-black"><HugeiconsIcon icon={Logout01Icon} size={18} /></button>
          </div>
        </div>
      </div>
    </aside>
    <main className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-black/[.05] bg-white/90 px-4 backdrop-blur-xl sm:px-5 md:px-6 lg:px-9">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3"><button className="shrink-0 rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 md:hidden" aria-label={open ? "Close menu" : "Open menu"} title={open ? "Close menu" : "Open menu"} onClick={() => setOpen(current => !current)}><HugeiconsIcon icon={Menu01Icon} size={20} /></button><button className="hidden shrink-0 rounded-lg p-2 text-neutral-600 hover:bg-neutral-100 md:block" aria-label={desktopSidebarOpen ? "Hide sidebar" : "Show sidebar"} title={desktopSidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={toggleNavigation}><HugeiconsIcon icon={Menu01Icon} size={20} /></button><span className="truncate text-xs font-medium text-neutral-500">Workspace <span className="mx-1.5 text-neutral-300">/</span><span className="text-neutral-800">{links.find(link => pathname === link.href || (link.href !== "/attendance" && pathname.startsWith(`${link.href}/`)))?.label ?? "Overview"}</span></span></div>
        <div className="hidden text-[11px] font-medium text-neutral-500 sm:block">Xaadir workspace</div>
      </header>
      <div className="mx-auto w-full max-w-[1480px] px-3 py-5 sm:px-5 sm:py-6 md:px-6 lg:px-9 lg:py-8">{children}</div>
    </main>
  </div>;
}
