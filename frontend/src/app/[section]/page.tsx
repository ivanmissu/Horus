import { notFound } from "next/navigation";
import { WorkspacePage } from "@/components/workspace-page";
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!["requirements", "archive"].includes(section)) notFound();
  return <WorkspacePage />;
}
