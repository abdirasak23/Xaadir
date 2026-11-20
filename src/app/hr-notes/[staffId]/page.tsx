import { AdminShell } from "@/components/admin-shell";
import { HrStaffTimeline } from "@/components/hr-notes-manager";
export default async function HrStaffTimelinePage({ params }: { params: Promise<{ staffId: string }> }) { const { staffId } = await params; return <AdminShell><HrStaffTimeline staffId={staffId} /></AdminShell>; }
