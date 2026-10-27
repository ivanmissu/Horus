"use client";
import { useCallback, useEffect, useRef, useState, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Code2, Layers3, ChartNoAxesCombined, Server, X, Inbox, LoaderCircle, ChevronDown, CalendarDays, Clock3, ChevronLeft, ChevronRight, Check } from "lucide-react";
import type { Team } from "@/lib/types";
import { todayString } from "@/lib/domain";
import { buildMonthCells, canGoPreviousMonth } from "@/lib/calendar";
import { revealScrollTop } from "@/lib/scroll";

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

/**
 * 内联确认区（「标记不采纳」「标记卡点」「确认归档」等）挂在详情内容末尾，
 * 内容较长或屏幕较矮时它会落在可视区下方，点击按钮后看不出任何变化。
 * 这里在确认区挂载时把它滚进内容区可视范围，并把焦点交给里面第一个输入项，
 * 让「点一下就出现确认区」的行为在任何窗口高度下都成立。
 */
export function useRevealInlineAction() {
  const lastNode = useRef<HTMLElement | null>(null);
  return useCallback((node: HTMLElement | null) => {
    if (!node || lastNode.current === node) return;
    lastNode.current = node;
    // 等两帧：确认区需要先完成布局（文本域最小高度、提示文案换行），再计算滚动位置。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // 手机端这些确认区是 display:none，量不到位置就不做任何滚动。
      if (!node.isConnected || !node.offsetParent) return;
      const field = node.querySelector<HTMLElement>("textarea, input, select");
      // preventScroll：滚动位置统一由下面计算，避免焦点滚动与平滑滚动互相打断。
      field?.focus({ preventScroll: true });
      if (field instanceof HTMLTextAreaElement) {
        // 光标落在已有说明的末尾，直接接着写。
        field.setSelectionRange(field.value.length, field.value.length);
      }
      const scroller = node.closest<HTMLElement>(".modal-body");
      if (!scroller) { node.scrollIntoView({ block: "nearest" }); return; }
      if (!field) { node.tabIndex = -1; node.focus({ preventScroll: true }); }
      const scrollerRect = scroller.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const { scrollTop, changed } = revealScrollTop({
        boxTop: rect.top - scrollerRect.top + scroller.scrollTop,
        boxHeight: rect.height,
        viewHeight: scroller.clientHeight,
        maxTop: scroller.scrollHeight - scroller.clientHeight,
        currentTop: scroller.scrollTop,
      });
      if (!changed) return;
      const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scroller.scrollTo({ top: scrollTop, behavior: reduced ? "auto" : "smooth" });
    }));
  }, []);
}
export function Modal({ title, description, children, onClose, footer, wide = false, className = "", drawer = false, eyebrow }: { title: string; description?: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean; className?: string; drawer?: boolean; eyebrow?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => panel.current?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      const backdrops = document.querySelectorAll(".modal-backdrop");
      const topBackdrop = backdrops[backdrops.length - 1];
      if (topBackdrop && panel.current && !topBackdrop.contains(panel.current)) return;
      if (event.key === "Escape") {
        if (document.querySelector("[data-ui-portal]")) return;
        close.current();
      }
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
  return <div className={`modal-backdrop ${drawer ? "drawer-backdrop" : ""}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={panel} className={`modal-panel ${wide ? "wide" : ""} ${drawer ? "drawer" : ""} ${className}`.trim()} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div>{eyebrow && <div className="modal-eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header><div className="modal-body">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}</div></div>;
}

// ---------- Unified form controls: Select / DatePicker / TimePicker ----------

export type SelectOption = { value: string; label: string; disabled?: boolean };

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function useOnClickOutside(refs: React.RefObject<HTMLElement | null>[], handler: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      for (const r of refs) {
        const el = r.current;
        if (el && el.contains(target)) return;
      }
      // also ignore clicks inside any portal panel (they are children of body, not refs)
      // panels have data-ui-portal attribute
      const portal = (target as HTMLElement).closest?.("[data-ui-portal]");
      if (portal) return;
      handler();
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [refs, handler, enabled]);
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  id,
  ariaLabel,
  variant = "default",
  className = "",
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  variant?: "default" | "quiet" | "small";
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(() => {
    const idx = options.findIndex(o => o.value === value);
    return idx >= 0 ? idx : 0;
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const listId = useId();
  const selected = options.find(o => o.value === value) || null;

  useEffect(() => { if (open) { const idx = options.findIndex(o => o.value === value); setHighlight(idx >= 0 ? idx : 0); } }, [open, value, options]);

  useOnClickOutside([triggerRef, panelRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(options.length - 1, h + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
      else if (e.key === "Enter") { e.preventDefault(); const opt = options[highlight]; if (opt && !opt.disabled) { onChange(opt.value); setOpen(false); } }
      else if (e.key === "Home") { e.preventDefault(); setHighlight(0); }
      else if (e.key === "End") { e.preventDefault(); setHighlight(options.length - 1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, highlight, options, onChange]);

  // scroll highlighted into view
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const el = panelRef.current.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const panel = open && mounted && triggerRef.current ? (() => {
    const rect = triggerRef.current!.getBoundingClientRect();
    const gap = 7;
    const maxH = 280;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    const spaceBelow = viewportH - rect.bottom - gap - 12;
    const spaceAbove = rect.top - gap - 12;
    // decide placement
    let top = rect.bottom + gap;
    let maxHeight = Math.min(maxH, Math.max(160, spaceBelow));
    let place: "bottom" | "top" = "bottom";
    if (spaceBelow < 180 && spaceAbove > spaceBelow) {
      place = "top";
      maxHeight = Math.min(maxH, Math.max(160, spaceAbove));
      top = rect.top - gap - maxHeight;
      // fallback to fixed height calc: we will position panel and let CSS handle max-height
      // instead compute actual panel height approx
      // simpler: set top = rect.top - 8 and use bottom placement flipped via CSS
      // but we already have logic, just set top to rect.top - gap - maxHeight
      // if space small we still render below with scroll
    }
    const width = Math.max(rect.width, 172);
    // ensure we don't overflow right
    let left = rect.left;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    if (left + width > vw - 12) left = Math.max(12, vw - width - 12);

    return createPortal(
      <div
        ref={panelRef}
        data-ui-portal="select"
        role="listbox"
        id={listId}
        aria-label={ariaLabel}
        className={`ui-select-panel variant-${variant}`}
        style={{ position: "fixed", left, top, width, maxHeight, zIndex: 1300 }}
        data-placement={place}
      >
        <div className="ui-select-panel-inner">
          {options.length === 0 ? (
            <div className="ui-select-empty">暂无选项</div>
          ) : options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHighlighted = i === highlight;
            return (
              <button
                key={opt.value || `idx-${i}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-index={i}
                data-highlighted={isHighlighted ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
                disabled={!!opt.disabled}
                className={`ui-select-option ${isSelected ? "is-selected" : ""} ${isHighlighted ? "is-highlighted" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span className="ui-select-option-label">{opt.label}</span>
                {isSelected && <Check size={14} className="ui-select-check" />}
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        data-open={open ? "true" : "false"}
        data-variant={variant}
        className={`ui-select-trigger variant-${variant} ${className} ${disabled ? "is-disabled" : ""} ${open ? "is-open" : ""}`}
        style={style}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
      >
        <span className={`ui-select-value ${!selected ? "is-placeholder" : ""}`}>{selected ? selected.label : (placeholder || "请选择")}</span>
        <span className={`ui-select-chevron ${open ? "is-open" : ""}`} aria-hidden="true"><ChevronDown size={14} strokeWidth={1.9} /></span>
      </button>
      {panel}
    </>
  );
}

// ---- Date helpers ----
function parseISODate(s: string): Date | null {
  if (!s) return null;
  // expect YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  // guard against overflow like 2025-02-31
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
  return d;
}
function addMonths(d: Date, delta: number) { return new Date(d.getFullYear(), d.getMonth() + delta, 1); }

export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "选择日期",
  disabled = false,
  ariaLabel,
  className = "",
  style,
  variant = "default",
  min = null,
  clearable = true,
  minHint = "只能选择当天及以后",
}: {
  value: string; // YYYY-MM-DD or ""
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  variant?: "default" | "small" | "quiet";
  /** Inclusive earliest selectable day (YYYY-MM-DD). Earlier days render locked. */
  min?: string | null;
  /** Required fields must not offer a way back to an empty value. */
  clearable?: boolean;
  minHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const selectedDate = parseISODate(value);
  const [view, setView] = useState<Date>(() => selectedDate || new Date());

  useEffect(() => {
    if (open) {
      const sd = parseISODate(value);
      setView(sd || new Date());
    }
  }, [open, value]);

  useOnClickOutside([triggerRef, panelRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // “今天”按北京时间判定，与逾期/统计口径一致，不受访问者设备时区影响。
  const todayIso = todayString();
  const cells = buildMonthCells({ viewYear: view.getFullYear(), viewMonth: view.getMonth(), today: todayIso, min, selected: value || null });
  const previousEnabled = canGoPreviousMonth(view.getFullYear(), view.getMonth(), min);

  const display = value ? value.replaceAll("-", ".") : "";
  const hasValue = !!value;

  const panel = open && mounted && triggerRef.current ? (() => {
    const rect = triggerRef.current!.getBoundingClientRect();
    const gap = 7;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const panelW = 304;
    const panelH = 360;
    let left = rect.left;
    if (left + panelW > vw - 12) left = Math.max(12, vw - panelW - 12);
    let top = rect.bottom + gap;
    if (top + panelH > vh - 12) {
      // try above
      const above = rect.top - gap - panelH;
      if (above >= 12) top = above;
      else top = Math.max(12, vh - panelH - 12);
    }
    return createPortal(
      <div
        ref={panelRef}
        data-ui-portal="date"
        role="dialog"
        aria-label={ariaLabel || "选择日期"}
        className={`ui-date-panel variant-${variant}`}
        style={{ position: "fixed", left, top, width: panelW, zIndex: 1300 }}
      >
        <div className="ui-date-header">
          <button type="button" className="icon-button tiny" aria-label="上个月" disabled={!previousEnabled} title={!previousEnabled ? `可选日期不早于 ${min}` : undefined} onClick={() => setView(v => addMonths(v, -1))}><ChevronLeft size={16} /></button>
          <span className="ui-date-title">{view.getFullYear()}年 {String(view.getMonth() + 1).padStart(2, "0")}月</span>
          <button type="button" className="icon-button tiny" aria-label="下个月" onClick={() => setView(v => addMonths(v, 1))}><ChevronRight size={16} /></button>
        </div>
        <div className="ui-date-weekdays">
          {["一", "二", "三", "四", "五", "六", "日"].map(d => <span key={d}>{d}</span>)}
        </div>
        <div className="ui-date-grid">
          {cells.map((cell, idx) => (
            <button
              key={idx}
              type="button"
              className={`ui-date-cell ${!cell.isCurrentMonth ? "is-muted" : ""} ${cell.isToday ? "is-today" : ""} ${cell.isSelected ? "is-selected" : ""} ${cell.disabled ? "is-disabled" : ""}`}
              aria-label={cell.iso}
              aria-selected={cell.isSelected}
              disabled={cell.disabled}
              title={cell.disabled ? minHint : cell.iso}
              onClick={() => {
                onChange(cell.iso);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {cell.day}
            </button>
          ))}
        </div>
        <div className="ui-date-footer">
          <button type="button" className="text-button" onClick={() => { onChange(todayIso); setView(parseISODate(todayIso) || new Date()); setOpen(false); }}>今天</button>
          <span className="ui-date-footer-spacer" />
          {hasValue && clearable && <button type="button" className="button small" onClick={() => { onChange(""); setOpen(false); }}>清空</button>}
          <button type="button" className="button primary small" onClick={() => setOpen(false)}>确定</button>
        </div>
      </div>,
      document.body
    );
  })() : null;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        data-open={open ? "true" : "false"}
        className={`ui-date-trigger variant-${variant} ${className} ${disabled ? "is-disabled" : ""} ${open ? "is-open" : ""} ${hasValue ? "has-value" : ""}`}
        style={style}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
      >
        <CalendarDays size={15} className="ui-date-icon" />
        <span className={`ui-date-value ${!hasValue ? "is-placeholder" : ""}`}>{hasValue ? display : placeholder}</span>
        <span className="ui-date-actions">
          {hasValue && !disabled && clearable && (
            <span
              role="button"
              tabIndex={0}
              aria-label="清空日期"
              className="ui-clear"
              onClick={e => { e.stopPropagation(); onChange(""); }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
            >
              <X size={13} />
            </span>
          )}
          <span className={`ui-select-chevron ${open ? "is-open" : ""}`}><ChevronDown size={14} strokeWidth={1.9} /></span>
        </span>
      </button>
      {panel}
    </>
  );
}

// ---- TimePicker ----
function parseTime(s: string): { h: number; m: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}
function toTime(h: number, m: number) { return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }

export function TimePicker({
  value,
  onChange,
  id,
  placeholder = "选择时间",
  disabled = false,
  ariaLabel,
  className = "",
  style,
  variant = "default",
}: {
  value: string; // HH:MM
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  variant?: "default" | "small" | "quiet";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const parsed = parseTime(value);

  useOnClickOutside([triggerRef, panelRef], () => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const hasValue = !!parsed;

  const panel = open && mounted && triggerRef.current ? (() => {
    const rect = triggerRef.current!.getBoundingClientRect();
    const gap = 7;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const panelW = 264;
    const panelH = 316;
    let left = rect.left;
    if (left + panelW > vw - 12) left = Math.max(12, vw - panelW - 12);
    let top = rect.bottom + gap;
    if (top + panelH > vh - 12) {
      const above = rect.top - gap - panelH;
      if (above >= 12) top = above;
      else top = Math.max(12, vh - panelH - 12);
    }
    return createPortal(
      <div
        ref={panelRef}
        data-ui-portal="time"
        role="dialog"
        aria-label={ariaLabel || "选择时间"}
        className={`ui-time-panel variant-${variant}`}
        style={{ position: "fixed", left, top, width: panelW, zIndex: 1300 }}
      >
        <div className="ui-time-header">
          <span className="ui-time-title">选择时间</span>
          <span className="ui-time-hint">24 小时制 · 北京时间</span>
        </div>
        <div className="ui-time-body">
          <div className="ui-time-col">
            <div className="ui-time-col-head">时</div>
            <div className="ui-time-list">
              {hours.map(h => {
                const sel = parsed?.h === h;
                return (
                  <button
                    key={h}
                    type="button"
                    className={`ui-time-option ${sel ? "is-selected" : ""}`}
                    aria-selected={sel}
                    onClick={() => {
                      const mm = parsed?.m ?? 0;
                      onChange(toTime(h, mm));
                    }}
                  >
                    {String(h).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="ui-time-divider" />
          <div className="ui-time-col">
            <div className="ui-time-col-head">分</div>
            <div className="ui-time-list">
              {minutes.map(mm => {
                const sel = parsed?.m === mm;
                return (
                  <button
                    key={mm}
                    type="button"
                    className={`ui-time-option ${sel ? "is-selected" : ""}`}
                    aria-selected={sel}
                    onClick={() => {
                      const h = parsed?.h ?? 9;
                      onChange(toTime(h, mm));
                    }}
                  >
                    {String(mm).padStart(2, "0")}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="ui-time-footer">
          <button type="button" className="text-button" onClick={() => { const d = new Date(); onChange(toTime(d.getHours(), d.getMinutes())); setOpen(false); }}>现在</button>
          <span className="ui-time-footer-spacer" />
          {hasValue && <button type="button" className="button small" onClick={() => { onChange(""); setOpen(false); }}>清空</button>}
          <button type="button" className="button primary small" onClick={() => setOpen(false)}>确定</button>
        </div>
      </div>,
      document.body
    );
  })() : null;

  const display = hasValue ? value : "";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        data-open={open ? "true" : "false"}
        className={`ui-time-trigger variant-${variant} ${className} ${disabled ? "is-disabled" : ""} ${open ? "is-open" : ""} ${hasValue ? "has-value" : ""}`}
        style={style}
        onClick={() => { if (!disabled) setOpen(v => !v); }}
      >
        <Clock3 size={15} className="ui-time-icon" />
        <span className={`ui-time-value ${!hasValue ? "is-placeholder" : ""}`}>{hasValue ? display : placeholder}</span>
        <span className="ui-date-actions">
          {hasValue && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="清空时间"
              className="ui-clear"
              onClick={e => { e.stopPropagation(); onChange(""); }}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
            >
              <X size={13} />
            </span>
          )}
          <span className={`ui-select-chevron ${open ? "is-open" : ""}`}><ChevronDown size={14} strokeWidth={1.9} /></span>
        </span>
      </button>
      {panel}
    </>
  );
}
