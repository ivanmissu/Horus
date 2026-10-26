"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Layers3, Sparkles, CirclePause, AlarmClock, ArrowUpRight, ChevronDown, ChevronRight, CalendarDays, SlidersHorizontal, CircleHelp, ChevronsUp, Equal, Clock3, X, ArrowDownUp, Check, Info, Route, ArrowRight, CircleDot, Pencil } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar, Badge, EmptyState, Modal, TeamIcon, Select } from "./ui";
import { canCreateRequirement, canMaintain, CYCLE_FILTER_LABELS, cycleOf, dateRangeLabel, daysOverdue, daysSince, endOfShanghaiWeek, expectedDateChangesFor, fullDate, isAnyOverdue, isHistoricalPendingArchive, isInFlight, isLateReleased, isMainInFlight, isNew, isOverdue, isOverdueOrLateReleased, isScheduled, LAUNCH_CYCLE_LABELS, launchCycleOf, PRIORITIES, requirementCode, shortDate, showNewBadge, startOfShanghaiWeek, todayString } from "@/lib/domain";
import type { FocusFilter, Requirement, RequirementDateChange, Team } from "@/lib/types";

export function PageHeading({ title, subtitle, actions, icon }: { title: string; subtitle: string; actions?: ReactNode; icon?: ReactNode }) {
  return <div className="page-heading"><div className="page-heading-copy">{icon}<div><h1>{title}</h1><p>{subtitle}</p></div></div><div className="page-heading-actions">{actions}</div></div>;
}
function CreateButton({ teamId = "" }: { teamId?: string }) {
  const { data, openCreate } = useWorkspace();
  if (teamId && !canMaintain(data.actor, teamId)) return null;
  if (!canCreateRequirement(data.actor)) return null;
  return <button className="button primary desktop-edit" onClick={() => openCreate(teamId)}><Plus size={17} />新建需求</button>;
}
function Metrics({ onSelect }: { onSelect: (filter: FocusFilter) => void }) {
  const { data } = useWorkspace();
  // 全部未归档含历史未归档：仅逾期口径继续含历史中的逾期上线，主在途计数剔除历史。
  const inFlightAll = data.requirements.filter(isInFlight);
  const historical = inFlightAll.filter(r => isHistoricalPendingArchive(r, data.now));
  const inFlight = inFlightAll.filter(r => isMainInFlight(r, data.now));
  const upcoming = inFlight.filter(r => isScheduled(r, data.now));
  const active = data.requirements.filter(r => r.status === "active" && !isScheduled(r, data.now));
  const fresh = data.requirements.filter(r => isNew(r, data.now));
  const freshArchived = fresh.filter(r => !!r.archivedAt).length;
  const blocked = active.filter(r => r.blocked);
  const overdueRequirements = inFlightAll.filter(r => r.status !== "cancelled" && !isScheduled(r, data.now) && isOverdueOrLateReleased(r, data.now));
  const overdue = overdueRequirements.filter(r => r.priority === "high");
  const overdueAll = overdueRequirements;
  const pendingArchive = inFlight.filter(r => r.status === "released").length;
  const inFlightFoot = [upcoming.length ? `含 ${upcoming.length} 项下周待启动` : "", pendingArchive ? `${pendingArchive} 项待归档` : "", historical.length ? `另有 ${historical.length} 项历史未归档` : ""].filter(Boolean).join(" · ") || (inFlight.length ? `${data.teams.length} 个团队正在协同推进` : "暂无在途需求");
  const overdueDuration = (r: Requirement) => daysOverdue(r.expectedDate!, isLateReleased(r) ? r.releasedAt || r.enteredAt : data.now);
  const stats = [
    { label: "全部在途", value: inFlight.length, icon: Layers3, color: "purple", foot: inFlightFoot, action: () => onSelect("all"), spark: "M2 23 11 20 20 22 29 13 38 15 47 9 56 11 65 3" },
    { label: "本周新建", value: fresh.length, icon: Sparkles, color: "blue", foot: freshArchived ? `本周一至今创建 · 含 ${freshArchived} 项已归档` : "本周一至今进入研发流程", action: () => onSelect("new"), spark: "M2 24 11 23 20 16 29 19 38 10 47 12 56 6 65 3" },
    { label: "存在卡点", value: blocked.length, icon: CirclePause, color: "orange", foot: `分布在 ${new Set(blocked.map(r => r.teamId)).size} 个团队，等待跟进`, action: () => onSelect("blocked") },
    { label: "高优逾期", value: overdue.length, icon: AlarmClock, color: "red", foot: overdue.length ? `最早已逾期 ${Math.max(...overdue.map(overdueDuration))} 天` : "暂无高优需求逾期", action: () => onSelect("overdue") },
    { label: "全部逾期", value: overdueAll.length, icon: CalendarDays, color: "rose", foot: overdueAll.length ? `最早逾期 ${Math.max(...overdueAll.map(overdueDuration))} 天 · 含 ${overdue.length} 项高优` : "暂无逾期需求", action: () => onSelect("overdue-all") },
  ];
  return <div className="metrics-grid">{stats.map(item => <button key={item.label} className={`metric-card metric-${item.color}`} onClick={item.action}><div className="metric-top"><span>{item.label}</span><span className={`metric-icon ${item.color}`}><item.icon size={19} strokeWidth={1.7} /></span></div><div className="metric-middle"><strong>{item.value.toString().padStart(2, "0")}</strong><span>项需求</span>{item.spark && <svg className="metric-spark" viewBox="0 0 68 30" fill="none"><path d={item.spark} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d={`${item.spark}L65 30H2Z`} fill="currentColor" opacity="0.055" /></svg>}</div><div className="metric-foot"><i /><span className="metric-foot-text">{item.foot}</span><ArrowUpRight size={12} /></div></button>)}</div>;
}
/** 「日期调整」标记的悬停文案：最近一次调整 + 累计次数。 */
function dateChangeHint(changes: RequirementDateChange[]) {
  const latest = changes[0];
  return [
    `期望日期调整：${fullDate(latest.fromDate)} → ${fullDate(latest.toDate)}`,
    `原因：${latest.reason}`,
    changes.length > 1 ? `共 ${changes.length} 次调整，最近一次由 ${latest.actorName} 修改` : `由 ${latest.actorName} 修改`,
  ].join("\n");
}
export function RequirementFlags({ requirement: r }: { requirement: Requirement }) {
  const { data } = useWorkspace();
  const team = data.teams.find(t => t.id === r.teamId);
  // 期望日期调整过的需求在所有列表（含归档历史）常驻标记，悬停可看最近原因。
  const changes = expectedDateChangesFor(data.dateChanges, r.id);
  const dateChanged = changes.length ? <span className="date-change-flag" title={dateChangeHint(changes)}><Badge tone="amber"><Pencil size={11} />日期调整</Badge></span> : null;
  if (r.status === "active" && isScheduled(r, data.now)) return <span className="flag-list"><Badge tone="purple" dot>下周待启动</Badge>{dateChanged}</span>;
  if (r.status === "released") return <span className="flag-list"><Badge tone="green"><Check size={11} />已上线</Badge>{isLateReleased(r) && <Badge tone={r.priority === "high" ? "red" : "rose"} dot>逾期上线</Badge>}{!r.archivedAt && <Badge tone="amber">{isHistoricalPendingArchive(r, data.now) ? "历史未归档" : "待归档"}</Badge>}{dateChanged}</span>;
  if (r.status === "cancelled") return <span className="flag-list"><Badge tone="neutral">已取消</Badge>{dateChanged}</span>;
  return <span className="flag-list">{showNewBadge(r, team?.stages, data.now) && <Badge tone="blue" dot>新建</Badge>}{r.blocked && <Badge tone="orange" dot>卡点</Badge>}{isAnyOverdue(r, data.now) && <Badge tone={isOverdue(r, data.now) ? "red" : "rose"} dot>{isOverdue(r, data.now) ? "高优逾期" : "逾期"}</Badge>}{dateChanged}</span>;
}
export function RequirementTable({ items, showTeam = false }: { items: Requirement[]; showTeam?: boolean }) {
  const { data, openDetail } = useWorkspace();
  if (!items.length) return <EmptyState title="没有匹配的需求" description="当前视图很清爽。你可以调整筛选条件，查看更多需求。" />;
  return <><div className="table-scroll"><table className="requirement-table"><colgroup><col className="col-title" /><col className="col-stage" /><col className="col-dwell" /><col className="col-owner" /><col className="col-date" /><col className="col-flags" /></colgroup><thead><tr><th>需求名称</th><th>当前阶段</th><th>阶段停留</th><th>负责人</th><th>{items.every(r => !!r.archivedAt) ? "归档日期" : "期望上线/完成日期"}</th><th>状态标记</th></tr></thead><tbody>{items.map(r => {
    const team = data.teams.find(t => t.id === r.teamId);
    const stage = team?.stages.find(s => s.id === r.stageId);
    const dwell = daysSince(r.enteredAt, r.archivedAt || data.now);
    const overdue = isAnyOverdue(r, data.now);
    const lateReleased = isLateReleased(r);
    const overdueDays = overdue ? daysOverdue(r.expectedDate!, data.now) : lateReleased ? daysOverdue(r.expectedDate!, r.releasedAt || r.enteredAt) : 0;
    return <tr key={r.id} onClick={() => openDetail(r.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") openDetail(r.id); }} aria-label={`查看需求：${r.title}`}><td><div className="requirement-title"><span className={`priority-mark ${r.priority}`} title={PRIORITIES[r.priority]}>{r.priority === "high" ? <ChevronsUp size={15} /> : r.priority === "medium" ? <Equal size={14} /> : <ChevronDown size={15} />}</span><span>{r.title}</span></div><div className="requirement-secondary"><span className="requirement-code">{requirementCode(r.id)}</span>{r.blocked ? <span className="block-reason" title={r.blockReason}><span>·</span>{r.blockReason}</span> : showTeam ? <span className="requirement-team-name">· {team?.name}</span> : null}</div></td><td><span className={`stage-label stage-${r.status === "released" ? "done" : team?.stages.findIndex(s => s.id === r.stageId) || 0}`}><span />{stage?.name || "原阶段已调整"}</span></td><td><span className={`dwell ${dwell >= 5 && r.status === "active" ? "long" : ""}`}>{dwell >= 5 && r.status === "active" && <Clock3 size={12} />}<strong>{dwell}</strong><span>天</span></span></td><td><span className="owner-cell"><Avatar name={r.owner} small /><span>{r.owner || "未指定"}</span></span></td><td><span className={`due-date ${overdue || lateReleased ? "overdue" : ""} ${!r.expectedDate && !r.archivedAt ? "missing" : ""}`}>{r.archivedAt ? r.archivedAt.slice(0, 10).replaceAll("-", ".") : r.expectedDate ? r.expectedDate.replaceAll("-", ".") : "未填期望上线/完成日期"}</span>{(overdue || lateReleased) && <span className="overdue-note">{lateReleased ? "逾期上线" : "逾期"} {overdueDays} 天</span>}</td><td className="flags-cell"><RequirementFlags requirement={r} /><ChevronRight className="row-chevron" size={14} /></td></tr>;
  })}</tbody></table></div><div className="mobile-requirements">{items.map(r => { const team = data.teams.find(t => t.id === r.teamId); return <button className="mobile-requirement" key={r.id} onClick={() => openDetail(r.id)}><div className="mobile-req-heading"><span className={`priority-mark ${r.priority}`}>{r.priority === "high" ? <ChevronsUp size={15} /> : <Equal size={14} />}</span><strong>{r.title}</strong><ChevronRight size={15} /></div><div className="mobile-req-middle"><span className="stage-label"><span />{team?.stages.find(s => s.id === r.stageId)?.name || "原阶段"}</span><span>停留 {daysSince(r.enteredAt, r.archivedAt || data.now)} 天</span><RequirementFlags requirement={r} /></div>{r.blocked && <p className="mobile-block"><CirclePause size={12} />{r.blockReason}</p>}<div className="mobile-req-footer"><span><Avatar name={r.owner} small />{r.owner || "未指定"}</span><span className={isOverdueOrLateReleased(r, data.now) ? "text-red" : ""}><CalendarDays size={12} />{!r.archivedAt ? r.expectedDate ? `${shortDate(r.expectedDate)} 期望上线/完成日期` : "未填期望上线/完成日期" : `${shortDate(r.archivedAt)} 归档`}</span></div></button>; })}</div></>;
}
function RequirementGroup({ team, items, scope = "started" }: { team: Team; items: Requirement[]; scope?: "started" | "upcoming" | "history" }) {
  const { data } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  const pms = data.members.filter(m => m.active && m.role === "pm" && m.teamIds.includes(team.id));
  const upcomingScope = scope === "upcoming";
  const historyScope = scope === "history";
  const allCount = data.requirements.filter(r => r.teamId === team.id && (historyScope ? isHistoricalPendingArchive(r, data.now) : isMainInFlight(r, data.now) && isScheduled(r, data.now) === upcomingScope)).length;
  const pendingArchive = scope !== "started" ? 0 : data.requirements.filter(r => r.teamId === team.id && r.status === "released" && !r.archivedAt && !isHistoricalPendingArchive(r, data.now)).length;
  return <section className={`requirement-group ${collapsed ? "collapsed" : ""}`}><div className="group-header"><button className="group-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}><ChevronDown className="group-chevron" size={15} /><TeamIcon team={team} /><h3>{team.name}</h3><span className="group-count">{items.length}</span><span className="group-pm">PM<span>{pms.map(m => m.name).join("、") || "待分配"}</span></span></button><div className="group-header-right"><span><strong>{allCount}</strong> 项{historyScope ? "历史未归档" : upcomingScope ? "下周待启动" : "在途"}{pendingArchive > 0 && <><span className="separator-dot">·</span><strong>{pendingArchive}</strong> 项待归档</>}{items.length !== allCount && <><span className="separator-dot">·</span>当前显示 <strong>{items.length}</strong> 项</>}</span><Link href={`/teams/${team.id}`}>团队详情<ChevronRight size={14} /></Link></div></div>{!collapsed && <RequirementTable items={items} />}</section>;
}
export function Dashboard() {
  const { data, refreshing, refresh, notify, query, setQuery } = useWorkspace();
  const [focus, setFocus] = useState<FocusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("");
  const [priority, setPriority] = useState("");
  const [owner, setOwner] = useState("");
  const [cycle, setCycle] = useState("");
  const [launch, setLaunch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rules, setRules] = useState(false);
  // 主列表与在途计数剔除历史未归档；逾期页签仍含历史中的逾期上线，历史页签单列历史。
  const inFlightAll = data.requirements.filter(isInFlight);
  const historical = inFlightAll.filter(r => isHistoricalPendingArchive(r, data.now));
  const inFlight = inFlightAll.filter(r => isMainInFlight(r, data.now));
  const upcoming = inFlight.filter(r => isScheduled(r, data.now));
  const active = data.requirements.filter(r => r.status === "active" && !isScheduled(r, data.now));
  const fresh = data.requirements.filter(r => isNew(r, data.now));
  const blocked = active.filter(r => r.blocked).length;
  const overdueRequirements = inFlightAll.filter(r => r.status !== "cancelled" && !isScheduled(r, data.now) && isOverdueOrLateReleased(r, data.now));
  const overdue = overdueRequirements.filter(r => r.priority === "high").length;
  const overdueAll = overdueRequirements.length;
  const pendingArchive = inFlight.filter(r => r.status === "released").length;
  const matchesFocus = (r: Requirement, filter: FocusFilter) => filter === "all" || filter === "new" && isNew(r, data.now) || filter === "blocked" && r.blocked || filter === "overdue" && r.priority === "high" && isOverdueOrLateReleased(r, data.now) || filter === "overdue-all" && isOverdueOrLateReleased(r, data.now) || filter === "history" && isHistoricalPendingArchive(r, data.now);
  const tabs: { id: FocusFilter; name: string; count: number; tone: string }[] = [
    { id: "all", name: "全部在途", count: inFlight.length, tone: "purple" },
    { id: "new", name: "本周新建", count: fresh.length, tone: "blue" },
    { id: "blocked", name: "存在卡点", count: blocked, tone: "orange" },
    { id: "overdue", name: "高优逾期", count: overdue, tone: "red" },
    { id: "overdue-all", name: "全部逾期", count: overdueAll, tone: "rose" },
    { id: "history", name: "历史未归档", count: historical.length, tone: "orange" },
  ];
  const matchesFilters = (r: Requirement) => (!teamFilter || r.teamId === teamFilter) && (!priority || r.priority === priority) && (!owner || r.owner === owner) && (!cycle || cycleOf(r, data.now) === cycle) && (!launch || launchCycleOf(r, data.now) === launch) && (!query || `${r.title} ${r.owner} ${requirementCode(r.id)}`.toLowerCase().includes(query.toLowerCase()));
  const pool = focus === "history" ? historical : focus === "overdue" || focus === "overdue-all" ? inFlightAll : inFlight;
  const items = pool.filter(r => focus === "history" || !isScheduled(r, data.now)).filter(r => matchesFocus(r, focus) && matchesFilters(r));
  const archivedFreshFiltered = focus === "new" ? fresh.filter(r => !!r.archivedAt && matchesFilters(r)).length : 0;
  // 下周待启动的需求单独分区，不参与本周新建/卡点/逾期等指标。
  const upcomingItems = focus === "all" ? upcoming.filter(matchesFilters) : [];
  const filtersActive = focus !== "all" || !!teamFilter || !!priority || !!owner || !!cycle || !!launch || !!query.trim();
  const clearFilters = () => { setFocus("all"); setPriority(""); setOwner(""); setTeamFilter(""); setCycle(""); setLaunch(""); setQuery(""); };
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "long" }).format(new Date(data.now));
  const weekStart = todayString(startOfShanghaiWeek(data.now));
  const weekEnd = todayString(endOfShanghaiWeek(data.now));
  return <div className="dashboard"><PageHeading title="工作台" subtitle="全部在途一页看清，关键风险自动浮现。" actions={<><span className="today-label"><CalendarDays size={14} />{dateLabel}</span><button className={`button icon-only refresh-button ${refreshing ? "refreshing" : ""}`} disabled={refreshing} onClick={() => refresh(true).catch(() => notify("同步失败，请稍后重试", "error"))} aria-label="刷新数据"><RefreshCw size={16} /></button><CreateButton /></>} /><Metrics onSelect={setFocus} />
    <section className="focus-section"><div className="section-heading"><div><h2>{focus === "history" ? "历史未归档" : "全部在途需求"}<span className="section-heading-dot" /></h2><span className="section-description">{focus === "history" ? "本周一 00:00 前已上线、尚未归档的需求" : "本周未归档需求，风险与待归档状态一眼看清"}</span></div><span className="date-range"><CalendarDays size={14} />本周新建窗口 <span>{dateRangeLabel(weekStart, weekEnd)}</span></span></div><div className="focus-toolbar"><div className="focus-tabs">{tabs.map(tab => <button key={tab.id} className={`focus-tab ${focus === tab.id ? "active" : ""}`} onClick={() => setFocus(tab.id)}>{tab.id !== "all" && <i className={tab.tone} />}{tab.name}<span>{tab.count}</span></button>)}</div><div className="focus-filter-actions"><Select value={teamFilter} onChange={setTeamFilter} variant="quiet" options={[{ value: "", label: "全部团队" }, ...data.teams.map(t => ({ value: t.id, label: t.name }))]} ariaLabel="按团队筛选" /><span className="filter-divider" /><button className={`filter-button ${filtersOpen || priority || owner || cycle || launch ? "active" : ""}`} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={15} />筛选{(priority || owner || cycle || launch) && <i />}</button></div></div>
      {filtersOpen && <div className="filter-panel"><span><SlidersHorizontal size={14} />精细筛选</span><Select value={cycle} onChange={setCycle} variant="small" options={[{ value: "", label: "全部需求周期" }, ...Object.entries(CYCLE_FILTER_LABELS).map(([key, label]) => ({ value: key, label }))]} ariaLabel="需求周期筛选" /><Select value={launch} onChange={setLaunch} variant="small" options={[{ value: "", label: "全部上线周期" }, ...Object.entries(LAUNCH_CYCLE_LABELS).map(([key, label]) => ({ value: key, label }))]} ariaLabel="上线周期筛选" /><Select value={priority} onChange={setPriority} variant="small" options={[{ value: "", label: "全部优先级" }, ...Object.entries(PRIORITIES).map(([key, label]) => ({ value: key, label }))]} ariaLabel="优先级筛选" /><Select value={owner} onChange={setOwner} variant="small" options={[{ value: "", label: "全部负责人" }, ...[...new Set(inFlight.map(r => r.owner).filter(Boolean))].map(name => ({ value: name as string, label: name as string }))]} ariaLabel="负责人筛选" /><button className="text-button" onClick={clearFilters}>重置筛选</button><button className="icon-button tiny filter-close" onClick={() => setFiltersOpen(false)} aria-label="收起筛选"><X size={15} /></button></div>}
      <div className="notice-strip"><Sparkles size={15} /><p>{blocked || overdueAll ? <>有 <strong>{blocked} 项需求</strong>遇到卡点，<strong>{overdueAll} 项需求</strong>逾期未上线或逾期上线{overdue > 0 && <>（含 <strong>{overdue} 项高优</strong>）</>}{pendingArchive > 0 && <>，另有 <strong>{pendingArchive} 项已上线待归档</strong></>}，建议优先跟进。</> : pendingArchive > 0 ? <>风险项已清空，另有 <strong>{pendingArchive} 项已上线待归档</strong>，确认后可归档。</> : <>所有需求都在有序推进，继续保持。</>}</p><button onClick={() => setRules(true)}>规则说明<CircleHelp size={13} /></button></div>
      <div className="requirement-groups">{data.teams.filter(t => items.some(r => r.teamId === t.id)).map(team => <RequirementGroup key={team.id} team={team} scope={focus === "history" ? "history" : "started"} items={items.filter(r => r.teamId === team.id)} />)}{!items.length && !upcomingItems.length && <div className="card"><EmptyState title={focus === "history" && !historical.length ? "暂无历史未归档" : archivedFreshFiltered ? "本周新建的需求均已归档" : filtersActive ? "没有匹配的需求" : "还没有在途需求"} description={focus === "history" && !historical.length ? "本周一前已上线的需求都已归档；本周上线的待归档仍在「全部在途」中。" : archivedFreshFiltered ? `当前筛选范围内有 ${archivedFreshFiltered} 项本周新建需求已完成上线并归档，可在归档历史中查看。` : filtersActive ? "当前筛选条件下没有匹配需求，试试调整筛选条件。" : "新建需求后会出现在这里，并按团队分组展示。"} action={filtersActive ? <button className="button" onClick={clearFilters}>清除筛选</button> : undefined} /></div>}</div><div className="list-footnote"><Check size={13} />{focus === "history" ? <>已展示 {items.length} 项历史未归档</> : filtersActive ? <>本周筛选出 {items.length} 项需求</> : <>已展示全部 {items.length} 项在途需求</>}<span>{focus === "history" ? "本周一 00:00 前上线 · 点击需求可在详情中归档" : archivedFreshFiltered > 0 ? `另有 ${archivedFreshFiltered} 项本周新建已归档 · 本周已上线未归档留主列表` : upcomingItems.length ? `另有 ${upcomingItems.length} 项下周待启动 · 本周已上线未归档留主列表` : "本周已上线未归档留主列表，更早上线的在「历史未归档」中"}</span></div>
      {upcomingItems.length > 0 && <div className="upcoming-section"><div className="section-heading"><div><h2>下周待启动<span className="section-heading-dot" /></h2><span className="section-description">创建时间设为下周一 09:00，届时自动进入在途列表</span></div><span className="date-range"><CalendarDays size={14} />共 <span>{upcomingItems.length}</span> 项</span></div><div className="requirement-groups">{data.teams.filter(t => upcomingItems.some(r => r.teamId === t.id)).map(team => <RequirementGroup key={team.id} team={team} scope="upcoming" items={upcomingItems.filter(r => r.teamId === team.id)} />)}</div></div>}
    </section>
    {rules && <Modal title="工作台如何展示需求？" description="全部在途一页看清，风险自动标记。" onClose={() => setRules(false)}><div className="rules-list"><div><Badge tone="purple">需求周期</Badge><p>新建需求时必选本周或下周。本周 = 立即创建；下周 = 创建时间记为下周一 09:00（北京时间）。下周需求在生效前显示为「下周待启动」，单独分区展示，不计入本周新建、卡点与逾期。</p></div><div><Badge tone="blue">本周新建</Badge><p>统计本周一 00:00（北京时间）起创建且未取消的需求（含已上线与已归档，不含已取消）；工作台列表仅展示未归档项，仅当需求仍处于「需求评审」阶段时显示蓝色「新建」标记。</p></div><div><Badge tone="orange">存在卡点</Badge><p>所有标记了卡点的在途需求，不受创建时间限制。</p></div><div><Badge tone="red">高优逾期</Badge><p>优先级为高，超过期望日期仍未上线的需求会标记高优逾期；已上线但实际日期晚于期望日期的需求标记为逾期上线，并计入工作台逾期数量。未填日期的需求不命中。</p></div><div><Badge tone="rose">全部逾期</Badge><p>不限优先级；超过期望日期仍未上线，或实际晚于期望日期上线，都会计入工作台全部逾期（含历史未归档中的逾期上线）。逾期上线需求保留「已上线」并增加「逾期上线」标记；归档后从工作台数量移除，但归档历史仍保留标记。钉钉摘要口径不变。</p></div><div><Badge tone="amber">待归档 / 历史未归档</Badge><p>本周内上线的待归档以「待归档」标记保留在主列表；实际上线时间早于本周一 00:00（北京时间）的会自动转入「历史未归档」页签，不再计入主在途计数，但其中的逾期上线仍计入高优/全部逾期。</p></div></div><div className="guide-note"><Info size={17} /><p>工作台默认列出本周在途需求（含本周已上线待归档，不含历史未归档），按团队分组、不分页；历史未归档可在上方页签中处理。已归档与已取消的需求不会出现在这里，可在归档历史中查询。</p></div></Modal>}
  </div>;
}
function sortRequirements(items: Requirement[], sort: string, now: string) {
  return [...items].sort((a, b) => sort === "date" ? (a.expectedDate || "9999").localeCompare(b.expectedDate || "9999") : sort === "priority" ? ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) : sort === "dwell" ? daysSince(b.enteredAt, now) - daysSince(a.enteredAt, now) : new Date(b.archivedAt || b.createdAt).getTime() - new Date(a.archivedAt || a.createdAt).getTime());
}
export function RequirementsPage({ archive = false }: { archive?: boolean }) {
  const { data, query } = useWorkspace();
  const [view, setView] = useState<"inflight" | "history">("inflight");
  const [teamId, setTeamId] = useState("");
  const [cycle, setCycle] = useState("");
  const [launch, setLaunch] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [sort, setSort] = useState("created");
  const mainCount = data.requirements.filter(r => isMainInFlight(r, data.now)).length;
  const historyCount = data.requirements.filter(r => isHistoricalPendingArchive(r, data.now)).length;
  const filtered = data.requirements.filter(r => (archive ? !!r.archivedAt : view === "history" ? isHistoricalPendingArchive(r, data.now) : isMainInFlight(r, data.now)) && (!teamId || r.teamId === teamId) && (!cycle || cycleOf(r, data.now) === cycle) && (!launch || launchCycleOf(r, data.now) === launch) && (!priority || r.priority === priority) && (!status || r.status === status) && (!owner || r.owner === owner) && (!query || `${r.title} ${r.owner} ${requirementCode(r.id)}`.toLowerCase().includes(query.toLowerCase())));
  const items = sortRequirements(filtered, sort, data.now);
  return <><PageHeading title={archive ? "归档历史" : "所有需求"} subtitle={archive ? "每一次交付都有记录，让已完成的工作有迹可循。" : "连接所有团队，掌握每一项在途需求的进展。"} actions={archive ? <Badge tone="neutral"><ArchiveIcon />归档记录只读</Badge> : <CreateButton />} /><div className="card all-requirements-card">{!archive && <div className="team-list-tabs"><button className={view === "inflight" ? "active" : ""} onClick={() => setView("inflight")}>在途需求<span>{mainCount}</span></button><button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>历史未归档<span>{historyCount}</span></button></div>}<div className="table-card-heading"><h2>{archive ? "已归档需求" : view === "history" ? "历史未归档" : "在途需求"}<span className="group-count">{items.length}</span></h2><span className="subtle">{archive ? "按归档时间倒序保留" : view === "history" ? "本周一 00:00 前已上线、尚未归档，点击可在详情中归档" : "点击需求查看详情与维护进展"}</span></div><div className="list-filterbar"><Select value={teamId} onChange={setTeamId} variant="small" options={[{ value: "", label: "全部团队" }, ...data.teams.map(t => ({ value: t.id, label: t.name }))]} ariaLabel="所属团队" /><Select value={cycle} onChange={setCycle} variant="small" options={[{ value: "", label: "全部需求周期" }, ...Object.entries(CYCLE_FILTER_LABELS).map(([k, v]) => ({ value: k, label: v }))]} ariaLabel="需求周期" /><Select value={launch} onChange={setLaunch} variant="small" options={[{ value: "", label: "全部上线周期" }, ...Object.entries(LAUNCH_CYCLE_LABELS).map(([k, v]) => ({ value: k, label: v }))]} ariaLabel="上线周期" /><Select value={priority} onChange={setPriority} variant="small" options={[{ value: "", label: "全部优先级" }, ...Object.entries(PRIORITIES).map(([k, v]) => ({ value: k, label: v }))]} ariaLabel="需求优先级" /><Select value={owner} onChange={setOwner} variant="small" options={[{ value: "", label: "全部负责人" }, ...[...new Set(data.requirements.map(r => r.owner).filter(Boolean))].map(n => ({ value: n as string, label: n as string }))]} ariaLabel="需求负责人" />{archive && <Select value={status} onChange={setStatus} variant="small" options={[{ value: "", label: "全部归档状态" }, { value: "released", label: "已上线" }, { value: "cancelled", label: "已取消" }]} ariaLabel="归档状态" />}<div className="sort-select"><ArrowDownUp size={14} /><Select value={sort} onChange={setSort} variant="quiet" options={[{ value: "created", label: archive ? "归档时间倒序" : "最新创建" }, { value: "date", label: "期望上线/完成日期" }, { value: "priority", label: "优先级从高到低" }, { value: "dwell", label: "阶段停留最长" }]} ariaLabel="排序" /></div></div><RequirementTable items={items} showTeam /><div className="table-bottom">共 {items.length} 项需求 · 全部已展示<span>数据更新于 {new Date(data.now).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" })}</span></div></div></>;
}
function ArchiveIcon() { return <Check size={12} />; }
export function TeamPage({ team }: { team: Team }) {
  const { data, query } = useWorkspace();
  const [view, setView] = useState<"inflight" | "history" | "archived">("inflight");
  const archived = view === "archived";
  const [stage, setStage] = useState("");
  const [cycle, setCycle] = useState("");
  const [launch, setLaunch] = useState("");
  const [priority, setPriority] = useState("");
  const [owner, setOwner] = useState("");
  const [blocked, setBlocked] = useState("");
  const [sort, setSort] = useState("created");
  const all = data.requirements.filter(r => r.teamId === team.id);
  // 在途/分布剔除历史未归档；逾期计数保留历史中的逾期上线（inFlightAll 含历史）。
  const historical = all.filter(r => isHistoricalPendingArchive(r, data.now));
  const inFlightAll = all.filter(isInFlight);
  const inFlight = all.filter(r => isMainInFlight(r, data.now));
  const archivedCount = all.filter(r => !!r.archivedAt).length;
  const distribution = team.stages.map(s => ({ ...s, count: inFlight.filter(r => r.stageId === s.id).length }));
  const max = Math.max(...distribution.map(s => s.count), 1);
  const items = sortRequirements(all.filter(r => (view === "archived" ? !!r.archivedAt : view === "history" ? isHistoricalPendingArchive(r, data.now) : isMainInFlight(r, data.now)) && (!stage || r.stageId === stage) && (!cycle || cycleOf(r, data.now) === cycle) && (!launch || launchCycleOf(r, data.now) === launch) && (!priority || r.priority === priority) && (!owner || r.owner === owner) && (!blocked || (blocked === "yes" ? r.blocked : !r.blocked)) && (!query || `${r.title} ${r.owner} ${requirementCode(r.id)}`.toLowerCase().includes(query.toLowerCase()))), sort, data.now);
  return <><PageHeading title={team.name} subtitle={team.description || "以关键里程碑为锚点，持续交付团队价值。"} icon={<TeamIcon team={team} />} actions={<>{data.actor.role === "owner" && <Link className="button desktop-edit" href={`/settings/stages?team=${team.id}`}><Route size={15} />阶段配置</Link>}<CreateButton teamId={team.id} /></>} /><div className="team-summary"><div className="team-pms"><span className="subtle">产品经理</span>{data.members.filter(m => m.active && m.teamIds.includes(team.id)).map(m => <span key={m.id}><Avatar name={m.name} small />{m.name}</span>)}</div><div className="team-summary-counts"><span><i className="purple" /><strong>{inFlight.length}</strong> 项在途</span><span><i className="orange" /><strong>{inFlight.filter(r => r.blocked).length}</strong> 项卡点</span><span><i className="rose" /><strong>{inFlightAll.filter(r => isOverdueOrLateReleased(r, data.now)).length}</strong> 项逾期</span><span><i className="red" /><strong>{inFlightAll.filter(r => isOverdue(r, data.now)).length}</strong> 项高优逾期</span></div></div>
    <section className="card distribution-card"><div className="table-card-heading"><div><h2>研发阶段分布<span className="small-label">在途需求</span></h2><p>看清节点分布，及时发现流程瓶颈</p></div><span className="subtle"><CircleDot size={13} />点击阶段可筛选需求</span></div><div className="stage-distribution" style={{ gridTemplateColumns: `repeat(${team.stages.length}, minmax(88px, 1fr))` }}>{distribution.map((s, index) => <button key={s.id} className={`distribution-stage ${stage === s.id ? "selected" : ""}`} onClick={() => { setStage(stage === s.id ? "" : s.id); setView("inflight"); }}><span className="distribution-bar-space"><span className={`distribution-bar ${!s.count ? "zero" : ""}`} style={{ height: `${s.count ? 22 + s.count / max * 72 : 3}px` }}><strong>{s.count}</strong></span></span><span className="distribution-stage-name">{s.name}</span><span className="distribution-stage-index">{String(index + 1).padStart(2, "0")}{index === team.stages.length - 1 && " · 本周待归档"}</span>{index < team.stages.length - 1 && <ChevronRight className="distribution-arrow" size={13} />}</button>)}</div></section>
    <section className="card team-list-card"><div className="team-list-tabs"><button className={view === "inflight" ? "active" : ""} onClick={() => { setView("inflight"); setStage(""); }}>在途需求<span>{inFlight.length}</span></button><button className={view === "history" ? "active" : ""} onClick={() => { setView("history"); setStage(""); setBlocked(""); }}>历史未归档<span>{historical.length}</span></button><button className={view === "archived" ? "active" : ""} onClick={() => { setView("archived"); setStage(""); setBlocked(""); }}>归档历史<span>{archivedCount}</span></button><span className="team-readonly-note"><Info size={12} />手机端仅支持浏览</span></div><div className="list-filterbar"><Select value={stage} onChange={setStage} variant="small" options={[{ value: "", label: "全部阶段" }, ...team.stages.map(s => ({ value: s.id, label: s.name }))]} ariaLabel="按阶段筛选" /><Select value={cycle} onChange={setCycle} variant="small" options={[{ value: "", label: "全部需求周期" }, ...Object.entries(CYCLE_FILTER_LABELS).map(([key, label]) => ({ value: key, label }))]} ariaLabel="按需求周期筛选" /><Select value={launch} onChange={setLaunch} variant="small" options={[{ value: "", label: "全部上线周期" }, ...Object.entries(LAUNCH_CYCLE_LABELS).map(([key, label]) => ({ value: key, label }))]} ariaLabel="按上线周期筛选" /><Select value={priority} onChange={setPriority} variant="small" options={[{ value: "", label: "全部优先级" }, ...Object.entries(PRIORITIES).map(([key, label]) => ({ value: key, label }))]} ariaLabel="按优先级筛选" /><Select value={owner} onChange={setOwner} variant="small" options={[{ value: "", label: "全部负责人" }, ...[...new Set(all.map(r => r.owner).filter(Boolean))].map(n => ({ value: n as string, label: n as string }))]} ariaLabel="按负责人筛选" />{view === "inflight" && <Select value={blocked} onChange={setBlocked} variant="small" options={[{ value: "", label: "全部卡点状态" }, { value: "yes", label: "存在卡点" }, { value: "no", label: "无卡点" }]} ariaLabel="按卡点筛选" />}<div className="sort-select"><ArrowDownUp size={14} /><Select value={sort} onChange={setSort} variant="quiet" options={[{ value: "created", label: archived ? "归档时间倒序" : "最新创建" }, { value: "date", label: "期望上线/完成最近" }, { value: "priority", label: "优先级从高到低" }, { value: "dwell", label: "阶段停留最长" }]} ariaLabel="排序" /></div>{(stage || cycle || launch || priority || owner || blocked) && <button className="text-button reset-filters" onClick={() => { setStage(""); setCycle(""); setLaunch(""); setPriority(""); setOwner(""); setBlocked(""); }}>重置</button>}</div><RequirementTable items={items} /><div className="table-bottom">共 {items.length} 项需求 · 全部已展示<span>{archived ? "归档记录保留，随时可查" : view === "history" ? "本周一前已上线，等待归档" : "向前推进，稳步交付"}<ArrowRight size={12} /></span></div></section>
  </>;
}
