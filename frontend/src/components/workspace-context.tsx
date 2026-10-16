"use client";
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceData } from "@/lib/types";

type MutationResult = { ok: boolean; id?: number | string; sent?: boolean; message?: string };
type Toast = { id: number; message: string; type: "success" | "error" | "info" };
type Context = {
  data: WorkspaceData; busy: boolean; refreshing: boolean; query: string; setQuery: (value: string) => void;
  detailId: number | null; openDetail: (id: number | null) => void;
  createFor: string | null; openCreate: (teamId?: string) => void; closeCreate: () => void;
  refresh: (showToast?: boolean) => Promise<void>;
  mutate: (action: string, values?: Record<string, unknown>, success?: string) => Promise<MutationResult>;
  toast: Toast | null; notify: (message: string, type?: Toast["type"]) => void;
};
const WorkspaceContext = createContext<Context | null>(null);
export function WorkspaceProvider({ initialData, children }: { initialData: WorkspaceData; children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [detailId, openDetail] = useState<number | null>(null);
  const [createFor, setCreateFor] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => { setData(initialData); }, [initialData]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = useCallback((message: string, type: Toast["type"] = "success") => setToast({ id: Date.now(), message, type }), []);
  const refresh = useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) router.push("/login"); throw new Error(result.error); }
      setData(result);
      if (showToast) notify("已同步最新数据");
    } finally { setRefreshing(false); }
  }, [notify, router]);
  const mutate = useCallback(async (action: string, values: Record<string, unknown> = {}, success?: string) => {
    setBusy(true);
    try {
      if (window.matchMedia("(max-width: 768px)").matches) throw new Error("手机端为只读浏览，请在电脑端维护数据");
      const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 401) router.push("/login"); throw new Error(result.error); }
      await refresh();
      if (success || result.message) notify(result.message || success, result.sent === false ? "info" : "success");
      return result as MutationResult;
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败，请重试", "error");
      throw error;
    } finally { setBusy(false); }
  }, [notify, refresh, router]);
  return <WorkspaceContext.Provider value={{ data, busy, refreshing, query, setQuery, detailId, openDetail, createFor, openCreate: (id = "") => setCreateFor(id), closeCreate: () => setCreateFor(null), refresh, mutate, toast, notify }}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is required");
  return context;
}
