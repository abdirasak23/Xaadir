import { AdminShell } from "@/components/admin-shell";
import { HrStaffTimeline } from "@/components/hr-notes-manager";

export default async function HrStaffNotesPage({ params }: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await params;
  return <AdminShell><main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><HrStaffTimeline staffId={staffId} /></main></AdminShell>;
}