"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Code2, Layers3, ChartNoAxesCombined, Server, X, Inbox, LoaderCircle } from "lucide-react";
import type { Team } from "@/lib/types";

export function HorusLogo({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span className="brand-mark"><svg width="29" height="29" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6.5 17.5C13 10 24.5 10 33 17.5c-6.8 7.9-18.8 8.7-26.5 0Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/><circle cx="20.2" cy="17.7" r="4.3" fill="currentColor"/><path d="m11.2 22.3 1.8 8.1 5.1-4.2M24 23.2l5.4 4.9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>{!compact && <span className="brand-word">Horus<span className="brand-dot">.</span></span>}</span>;
}
export function TeamIcon({ team, small = false }: { team: Pick<Team, "color" | "icon">; small?: boolean }) {
  const Icon = team.icon === "layers" ? Layers3 : team.icon === "chart" ? ChartNoAxesCombined : team.icon === "server" ? Server : Code2;
  return <span className={`team-icon ${team.color} ${small ? "small" : ""}`}><Icon size={small ? 15 : 19} strokeWidth={1.8} /></span>;
}
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const color = name ? name.charCodeAt(0) % 5 : 0;
  return <span className={`avatar avatar-${color} ${small ? "small" : ""}`} aria-hidden="true">{name ? name[0] : "—"}</span>;
}
export function Badge({ tone = "neutral", children, dot = false }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={`badge ${tone}`}>{dot && <span className="badge-dot" />}{children}</span>;
}
export function EmptyState({ title = "这里暂时没有需求", description = "试试调整筛选条件，或创建一条新的需求。", action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={30} strokeWidth={1.5} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function Spinner() { return <LoaderCircle size={16} className="spin" />; }
export function Modal({ title, description, children, onClose, footer, wide = false, drawer = false, eyebrow }: { title: string; description?: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean; drawer?: boolean; eyebrow?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => panel.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]') || []).filter(el => el.offsetParent !== null);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(timer); document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);
  return <div className={`modal-backdrop ${drawer ? "drawer-backdrop" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={panel} className={`modal-panel ${wide ? "wide" : ""} ${drawer ? "drawer" : ""}`} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div>{eyebrow && <div className="modal-eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header><div className="modal-body">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}</div></div>;
}
