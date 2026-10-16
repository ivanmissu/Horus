import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/data";
import { AppError } from "@/lib/auth";
import type { WorkspaceData } from "@/lib/types";
import { Workspace } from "./workspace";

export async function WorkspacePage() {
  let initialData: WorkspaceData;
  try {
    initialData = await loadWorkspace();
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    throw error;
  }
  return <Workspace initialData={initialData} />;
}
