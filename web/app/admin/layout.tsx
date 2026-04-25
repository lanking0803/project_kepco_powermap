import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/");

  // /admin/api-manager 같은 로컬 한정 메뉴 노출용 플래그.
  // Vercel 배포본은 VERCEL=1 이라 false → 메뉴 자체가 안 보임.
  const isLocal =
    process.env.NODE_ENV === "development" && process.env.VERCEL !== "1";

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav email={user.email} isLocal={isLocal} />
      {children}
    </div>
  );
}
