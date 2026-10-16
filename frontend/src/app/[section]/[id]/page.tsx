import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params;
  if (section !== "teams" && !(section === "settings" && ["stages", "members", "notifications"].includes(id))) notFound();
  return <WorkspacePage />;
}
