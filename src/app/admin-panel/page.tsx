import { CompanyManager } from "@/AdminPanel/company-manager";
import { requireAdminSession } from "@/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function AdminPanelPage() {
  if (!await requireAdminSession()) redirect("/admin-panel/login");
  return <CompanyManager />;
}
