import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/data";
import { AppError } from "@/lib/auth";
import type { WorkspaceData } from "@/lib/types";
import { Workspace } from "./workspace";
import { EmbeddedWorkspace } from "./embedded-workspace";

export async function WorkspacePage() {
  if (process.env.HORUS_EMBEDDED_PREVIEW === "true") return <EmbeddedWorkspace />;
  let initialData: WorkspaceData;
  try {
    initialData = await loadWorkspace();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    throw error;
  }
  return <Workspace initialData={initialData} />;
}
