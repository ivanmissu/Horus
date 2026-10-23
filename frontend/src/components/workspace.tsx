"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ListTodo, Archive, BarChart3, Route, UsersRound, Bell, CircleHelp, Search, ChevronRight, ChevronDown, Plus, PanelLeftClose, PanelLeft, Menu, X, ArrowUpRight, LogIn, LogOut, CheckCircle2, AlertCircle, Info, Sparkles, Command, ShieldCheck } from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { Avatar, Badge, EmptyState, HorusLogo, Modal, TeamIcon } from "./ui";
import { Dashboard, RequirementsPage, TeamPage } from "./requirement-views";
import { StatsPage } from "./stats-views";
import { CreateRequirement, RequirementDetail } from "./requirement-dialogs";
import { MembersPage, NotificationsPage, StagesPage } from "./management";
import { isAnyOverdue, isInFlight, requirementCode, roleLabel } from "@/lib/domain";
import type { WorkspaceData } from "@/lib/types";
import { embeddedAuthHeaders, EMBEDDED_SESSION_KEY } from "@/lib/embedded-session";

export function Workspace({ initialData }: { initialData: WorkspaceData }) {
  return <WorkspaceProvider key={initialData.now} initialData={initialData}><WorkspaceShell /></WorkspaceProvider>;
}
function WorkspaceShell() {
  const { data, query, setQuery, detailId, openDetail, createFor, closeCreate, toast, notify } = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  const [mobileNav, setMobileNav] = useState(false);
  const [compact, setCompact] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState<"notifications" | "profile" | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const team = path.startsWith("/teams/") ? data.teams.find(t => t.id === path.split("/")[2]) : undefined;
  const title = path === "/" ? "工作台" : path === "/stats" ? "需求统计" : path === "/requirements" ? "所有需求" : path === "/archive" ? "归档历史" : team?.name || (path.endsWith("stages") ? "阶段模板" : path.endsWith("members") ? "成员与团队" : "通知设置");
  const active = data.requirements.filter(r => r.status === "active");
  const inFlight = data.requirements.filter(isInFlight);
  const alerts = active.filter(r => r.blocked || isAnyOverdue(r, data.now));
  const searchResults = query.trim() ? data.requirements.filter(r => `${r.title} ${r.owner} ${requirementCode(r.id)}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 7) : [];
  useEffect(() => {
    const handle = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  const navigate = () => { setMobileNav(false); setQuery(""); setMenu(null); };
  const navItems = [{ href: "/", label: "工作台", icon: LayoutDashboard }, { href: "/stats", label: "需求统计", icon: BarChart3 }, { href: "/requirements", label: "所有需求", icon: ListTodo }, { href: "/archive", label: "归档历史", icon: Archive }];
  const management = [{ href: "/settings/stages", label: "阶段模板", icon: Route }, { href: "/settings/members", label: "成员与团队", icon: UsersRound }, { href: "/settings/notifications", label: "通知设置", icon: Bell }];
  const logout = async () => { try {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json", ...(data.embeddedAuth ? embeddedAuthHeaders() : {}) }, body: JSON.stringify({ action: "logout" }) });
    if (data.embeddedAuth) { sessionStorage.removeItem(EMBEDDED_SESSION_KEY); window.location.replace("/login"); }
    else router.push("/login");
  } catch { notify("退出失败，请稍后重试", "error"); } };
  return <div className={`app-shell ${compact ? "nav-compact" : ""}`}>
    {mobileNav && <div className="sidebar-scrim" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
      <Link href="/" className="brand-link" onClick={navigate} aria-label="Horus 首页"><HorusLogo /><span className="brand-caption">研发进程，尽在掌握</span></Link>
      <button className="mobile-nav-close icon-button" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={20} /></button>
      <div className="workspace-switch"><span className="workspace-avatar">H</span><span className="nav-text"><strong>研发协作空间</strong><small>团队负责人工作空间</small></span><ShieldCheck size={15} className="workspace-shield" /></div>
      <nav className="main-nav" aria-label="主导航">{navItems.map(item => <Link key={item.href} href={item.href} className={`nav-item ${path === item.href ? "active" : ""}`} onClick={navigate} title={item.label}><item.icon size={18} strokeWidth={1.8} /><span className="nav-text">{item.label}</span>{item.href === "/" && <span className="nav-active-dot" />}</Link>)}</nav>
      <div className="nav-section-heading"><span>我的团队</span>{data.actor.role === "owner" && <Link href="/settings/members?newTeam=1" onClick={navigate} className="icon-button tiny desktop-edit" aria-label="创建团队"><Plus size={15} /></Link>}</div>
      <nav className="team-nav" aria-label="团队">{data.teams.map(item => <Link href={`/teams/${item.id}`} key={item.id} onClick={navigate} className={`nav-item team-nav-item ${team?.id === item.id ? "active" : ""}`} title={item.name}><TeamIcon team={item} small /><span className="nav-text">{item.name}</span><span className="nav-count">{inFlight.filter(r => r.teamId === item.id).length}</span></Link>)}</nav>
      {data.actor.role === "owner" && <><div className="nav-section-heading desktop-edit"><span>空间管理</span></div><nav className="management-nav desktop-edit" aria-label="空间管理">{management.map(item => <Link key={item.href} href={item.href} onClick={navigate} className={`nav-item ${path === item.href ? "active" : ""}`} title={item.label}><item.icon size={18} strokeWidth={1.7} /><span className="nav-text">{item.label}</span></Link>)}</nav></>}
      <div className="sidebar-bottom"><div className="sidebar-note"><div className="note-orbit"><span /><span /><span /><i /></div><Sparkles size={19} /><strong>少一点追问，多一点掌控。</strong><p>让团队的每一步，都清晰可见。</p><button onClick={() => setHelp(true)}>了解 Horus <ArrowUpRight size={13} /></button></div><div className="sidebar-footer"><span>Horus <small>V1.0</small></span><span className="system-status"><i />{data.preview ? "只读示例数据" : "系统运行正常"}</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="icon-button desktop-collapse" onClick={() => setCompact(!compact)} aria-label={compact ? "展开导航" : "收起导航"}>{compact ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}</button><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={21} /></button><span className="breadcrumb-root">工作空间</span><ChevronRight className="breadcrumb-chevron" size={13} /><span className="breadcrumb-current">{title}</span></div>
        <div className="topbar-right"><div className="global-search"><Search size={16} /><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 150)} placeholder="搜索需求、负责人…" aria-label="搜索需求、负责人" />{query ? <button className="search-clear" onClick={() => setQuery("")} aria-label="清空搜索"><X size={13} /></button> : <kbd><Command size={10} /> K</kbd>}
          {searchFocused && query.trim() && <div className="search-results"><div className="popover-label">搜索结果 <span>{searchResults.length ? `显示 ${searchResults.length} 项匹配` : ""}</span></div>{searchResults.length ? searchResults.map(r => <button key={r.id} onMouseDown={e => e.preventDefault()} onClick={() => { openDetail(r.id); setSearchFocused(false); searchRef.current?.blur(); }}><span className="search-result-icon"><ListTodo size={17} /></span><span><strong>{r.title}</strong><small>{requirementCode(r.id)} · {data.teams.find(t => t.id === r.teamId)?.name} · {r.owner || "未指定负责人"}</small></span><ChevronRight size={14} /></button>) : <div className="search-empty">没有找到相关需求，试试其他关键词</div>}</div>}
        </div><span className="topbar-divider" /><button className="icon-button help-button" onClick={() => setHelp(true)} aria-label="使用指南"><CircleHelp size={19} /></button><button className={`icon-button notification-button ${menu === "notifications" ? "selected" : ""}`} onClick={() => setMenu(menu === "notifications" ? null : "notifications")} aria-label="查看异常摘要"><Bell size={19} />{alerts.length > 0 && <i />}</button><span className="topbar-divider profile-divider" /><button className="profile-button" onClick={() => setMenu(menu === "profile" ? null : "profile")} aria-label="账号菜单"><Avatar name={data.actor.name} /><span><strong>{data.actor.name}</strong><small>{roleLabel(data.actor.role)}</small></span><ChevronDown size={13} /></button></div>
        {menu && <><div className="popover-dismiss" onClick={() => setMenu(null)} /><div className={`header-popover ${menu === "profile" ? "profile-popover" : ""}`}>{menu === "notifications" ? <><div className="popover-heading"><div><h3>需要你留意</h3><p>卡点与逾期需求的实时摘要</p></div><Badge tone="purple">{alerts.length} 项</Badge></div><div className="notification-list">{alerts.length ? alerts.map(r => <button key={r.id} onClick={() => { openDetail(r.id); setMenu(null); }}><span className={`notification-dot ${isAnyOverdue(r, data.now) ? "red" : "orange"}`} /><span><strong>{r.title}</strong><small>{r.blocked ? r.blockReason : `期望上线/完成 ${r.expectedDate}，当前仍在途`}</small></span><ChevronRight size={14} /></button>) : <div className="search-empty">暂无异常，团队正有序推进。</div>}</div>{data.actor.role === "owner" && <Link className="popover-footer" href="/settings/notifications" onClick={() => setMenu(null)}>设置钉钉每日摘要 <ArrowUpRight size={14} /></Link>}</> : <><div className="popover-heading"><Avatar name={data.actor.name} /><div><h3>{data.actor.name}</h3><p>{data.demo ? "当前正在体验演示工作空间" : `账号：${data.actor.username}`}</p></div></div><Link className="profile-menu-item" href="/login" onClick={() => setMenu(null)}><LogIn size={16} />{data.demo ? "登录成员账号" : "切换账号"}<ChevronRight size={14} /></Link>{!data.demo && <button className="profile-menu-item" onClick={logout}><LogOut size={16} />退出登录</button>}<div className="profile-footnote"><ShieldCheck size={13} />成员账号由团队负责人预先创建</div></>}</div></>}
      </header>
      <main className="page-content" key={path}>{data.preview && <div className="preview-banner" role="status">只读预览 · 当前显示示例数据，未连接数据库；登录、保存及钉钉发送均不可用。</div>}{path === "/" ? <Dashboard /> : path === "/stats" ? <StatsPage /> : path === "/requirements" ? <RequirementsPage /> : path === "/archive" ? <RequirementsPage archive /> : team ? <TeamPage team={team} /> : path.startsWith("/teams/") ? <EmptyState title="团队不存在" description="该团队链接无效，请从左侧导航选择团队。" /> : data.actor.role !== "owner" ? <EmptyState title="仅团队负责人可访问" description="如需调整空间配置，请联系你的团队负责人。" /> : path.endsWith("stages") ? <StagesPage /> : path.endsWith("members") ? <MembersPage /> : <NotificationsPage />}
        <footer className="page-footer"><span><span className="footer-eye">◉</span> 每一个节点，心中有数。</span><span>Horus · 轻量研发掌控</span></footer>
      </main>
    </div>
    {createFor !== null && <CreateRequirement teamId={createFor} onClose={closeCreate} />}
    {detailId !== null && <RequirementDetail key={detailId} id={detailId} onClose={() => openDetail(null)} />}
    {help && <Modal title="你好，欢迎来到 Horus" description="不追问每个细节，也能掌握每一步进展。" onClose={() => setHelp(false)}><div className="guide-intro"><HorusLogo compact /><p>Horus 把研发流程中的关键节点变成里程碑。每天花一分钟，让团队的进展与风险一目了然。</p></div><div className="guide-rule"><span className="rule-number blue">01</span><div><h3>本周新建</h3><p>本周一 00:00（北京时间）起创建、仍在推进中的需求会以蓝色标记高亮，也可点击标签单独查看。</p></div></div><div className="guide-rule"><span className="rule-number orange">02</span><div><h3>存在卡点</h3><p>不论创建时间，所有卡点需求都会高亮提示，并展示卡点原因。</p></div></div><div className="guide-rule"><span className="rule-number red">03</span><div><h3>逾期</h3><p>超过期望上线/完成日期仍未收尾的需求都会标记为逾期，其中高优先级计入「高优逾期」，优先进入你的视线。</p></div></div><div className="guide-note"><Info size={16} /><p>工作台默认列出全部未归档需求并按团队分组；本周新建、卡点、逾期以标记高亮，可一键筛选。阶段可向前跳过、不可回退；到达最后一个阶段标记上线，需在需求详情中手动归档。手机端提供只读浏览，数据维护请使用桌面端。</p></div>{data.demo && <div className="demo-note">{data.preview ? "当前为只读预览，示例数据不会保存。配置数据库后可使用完整功能。" : "当前为可交互演示空间，操作会保存到数据库。正式部署可开启强制账号登录。"}</div>}</Modal>}
    {toast && <div key={toast.id} role="status" className={`toast ${toast.type}`}>{toast.type === "success" ? <CheckCircle2 size={19} /> : toast.type === "error" ? <AlertCircle size={19} /> : <Info size={19} />}<span>{toast.message}</span></div>}
  </div>;
}
