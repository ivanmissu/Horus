import { redirect } from "next/navigation";
import { loadWorkspace } from "@/lib/data";
import { AppError } from "@/lib/auth";
import { Workspace } from "./workspace";

export async function WorkspacePage() {
  try {
    const data = await loadWorkspace();
    return <Workspace initialData={data} />;
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    throw error;
  }
}
