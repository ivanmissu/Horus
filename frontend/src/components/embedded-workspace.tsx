"use client";
import { useEffect, useState } from "react";
import { embeddedAuthHeaders, EMBEDDED_SESSION_KEY } from "@/lib/embedded-session";
import type { WorkspaceData } from "@/lib/types";
import { Workspace } from "./workspace";

/** Server rendering cannot access sessionStorage inside a cross-site iframe. */
export function EmbeddedWorkspace() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!sessionStorage.getItem(EMBEDDED_SESSION_KEY)) {
      window.location.replace("/login");
      return;
    }
    let cancelled = false;
    fetch("/api/workspace", { headers: embeddedAuthHeaders(), cache: "no-store" })
      .then(async response => {
        if (response.status === 401) {
          sessionStorage.removeItem(EMBEDDED_SESSION_KEY);
          window.location.replace("/login");
          return null;
        }
        if (!response.ok) throw new Error("无法加载工作台，请稍后重试");
        return response.json() as Promise<WorkspaceData>;
      })
      .then(result => { if (result && !cancelled) setData(result); })
      .catch(() => { if (!cancelled) setError("无法加载工作台，请刷新页面重试"); });
    return () => { cancelled = true; };
  }, []);
  if (error) return <main className="page-content" role="alert">{error}</main>;
  if (!data) return <main className="page-content" role="status">正在加载工作台…</main>;
  return <Workspace initialData={data} />;
}
