"use client";
import { useState, type FormEvent } from "react";
import { ArrowDownUp, ArrowRight, Ban, CalendarDays, Check, ChevronDown, ChevronRight, ChevronsUp, CircleCheck, CircleSlash, Clock3, Copy, Equal, FileText, Flag, Info, Lightbulb, Pencil, Plus, RotateCcw, Rocket, ShieldCheck, Target, UserRound } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Avatar, Badge, DatePicker, EmptyState, Modal, Select, Spinner, TeamIcon, useRevealInlineAction } from "./ui";
import { PageHeading } from "./requirement-views";
import { canCreatePoolItem, canDecidePoolTeam, canMaintain, canMaintainPoolTeam, DEFAULT_PRIORITY, DEFAULT_REQUIREMENT_CYCLE, PRIORITIES, REQUIREMENT_CYCLES, requirementCode, shortDate, todayString } from "@/lib/domain";
import type { PoolItem, PoolItemStatus, Team } from "@/lib/types";

const STATUS_TONES: Record<PoolItemStatus, string> = { pending: "blue", accepted: "green", rejected: "neutral" };
const STATUS_ICONS: Record<PoolItemStatus, typeof CircleCheck> = { pending: Clock3, accepted: CircleCheck, rejected: CircleSlash };
const PRIORITY_ORDER: Record<PoolItem["priority"], number> = { high: 0, medium: 1, low: 2 };
const STATUS_TABS: { value: "" | PoolItemStatus; label: string }[] = [
  { value: "pending", label: "待评估" },
  { value: "accepted", label: "已采纳" },
  { value: "rejected", label: "不采纳" },
  { value: "", label: "全部" },
];
const SORT_OPTIONS = [
  { value: "created", label: "最新提报" },
  { value: "priority", label: "优先级从高到低" },
  { value: "date", label: "期望实现时间最近" },
];

function PriorityMark({ priority }: { priority: PoolItem["priority"] }) {
  return <span className={`priority-mark ${priority}`} title={PRIORITIES[priority]}>{priority === "high" ? <ChevronsUp size={15} /> : priority === "medium" ? <Equal size={14} /> : <ChevronDown size={15} />}</span>;
}
function PoolStatusBadge({ status }: { status: PoolItemStatus }) {
  const Icon = STATUS_ICONS[status];
  return <Badge tone={STATUS_TONES[status]}><Icon size={11} />{status === "pending" ? "待评估" : status === "accepted" ? "已采纳" : "不采纳"}</Badge>;
}
function teamOf(teams: Team[], teamId: string) { return teams.find(team => team.id === teamId); }

export function PoolPage() {
  const { data, query } = useWorkspace();
  const [status, setStatus] = useState<"" | PoolItemStatus>("pending");
  const [teamId, setTeamId] = useState("");
  const [priority, setPriority] = useState("");
  const [submitter, setSubmitter] = useState("");
  const [sort, setSort] = useState("created");
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [convertId, setConvertId] = useState<number | null>(null);
  const items = data.pool;
  const counts = { pending: items.filter(i => i.status === "pending").length, accepted: items.filter(i => i.status === "accepted").length, rejected: items.filter(i => i.status === "rejected").length };
  const maintainableTeams = data.teams.filter(team => canMaintainPoolTeam(data.actor, team.id));
  const canCreate = canCreatePoolItem(data.actor) && maintainableTeams.length > 0;
  const submitters = [...new Set(items.map(item => item.submitter).filter(Boolean))];
  const filtered = items.filter(item =>
    (!status || item.status === status) && (!teamId || item.teamId === teamId) && (!priority || item.priority === priority) &&
    (!submitter || item.submitter === submitter) &&
    (!query || `${item.title} ${item.submitter} ${item.businessValue} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())));
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "priority") return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.createdAt.localeCompare(a.createdAt);
    if (sort === "date") return (a.expectedDate || "9999-12-31").localeCompare(b.expectedDate || "9999-12-31");
    return b.createdAt.localeCompare(a.createdAt);
  });
  const converted = convertId !== null ? items.find(item => item.id === convertId) : undefined;
  // 转为正式需求时先收起池条目抽屉，避免与随后打开的需求详情抽屉叠在一起。
  const startConvert = (id: number) => { setDetailId(null); setConvertId(id); };
  const tabCount = (value: "" | PoolItemStatus) => value ? counts[value] : items.length;
  return <>
    <PageHeading
      title="需求池"
      subtitle="沉淀业务负责人的期望与待评估需求，筛选后再进入研发流程。"
      icon={<span className="team-icon purple pool-heading-icon"><Lightbulb size={22} strokeWidth={1.7} /></span>}
      actions={canCreate ? <button className="button primary desktop-edit" onClick={() => setCreating(true)}><Plus size={17} />新建需求池条目</button> : undefined}
    />
    <div className="notice-strip"><Lightbulb size={15} /><p>需求池独立于工作台、需求统计与钉钉摘要；条目被采纳后可一键转为正式需求，从团队流程的第一个阶段开始推进。</p></div>
    <div className="card all-requirements-card">
      <div className="team-list-tabs">
        {STATUS_TABS.map(tab => <button key={tab.value || "all"} className={status === tab.value ? "active" : ""} onClick={() => setStatus(tab.value)}>{tab.label}<span>{tabCount(tab.value)}</span></button>)}
        <span className="pool-tabs-note"><Info size={12} />业务负责人可提报与修改自己的需求，筛选结论由产品经理确认</span>
      </div>
      <div className="table-card-heading">
        <h2>{status ? STATUS_TABS.find(tab => tab.value === status)?.label : "全部条目"}<span className="group-count">{sorted.length}</span></h2>
        <span className="subtle">点击条目查看详情{query.trim() ? " · 已按顶部搜索关键词过滤" : ""}</span>
      </div>
      <div className="list-filterbar">
        <Select value={teamId} onChange={setTeamId} variant="small" options={[{ value: "", label: "全部团队" }, ...data.poolTeams.map(team => ({ value: team.id, label: team.name }))]} ariaLabel="所属团队" />
        <Select value={priority} onChange={setPriority} variant="small" options={[{ value: "", label: "全部优先级" }, ...Object.entries(PRIORITIES).map(([key, label]) => ({ value: key, label }))]} ariaLabel="优先级" />
        <Select value={submitter} onChange={setSubmitter} variant="small" options={[{ value: "", label: "全部提报人" }, ...submitters.map(name => ({ value: name, label: name }))]} ariaLabel="提报人" />
        <div className="sort-select"><ArrowDownUp size={14} /><Select value={sort} onChange={setSort} variant="quiet" options={SORT_OPTIONS} ariaLabel="排序" /></div>
        {(teamId || priority || submitter) && <button className="text-button reset-filters" onClick={() => { setTeamId(""); setPriority(""); setSubmitter(""); }}>重置</button>}
      </div>
      <PoolTable items={sorted} teams={data.poolTeams} onOpen={setDetailId} onConvert={startConvert} />
      <div className="table-bottom">共 {sorted.length} 项 · 全部已展示<span>进入研发流程前，先在这里对齐价值与优先级<ArrowRight size={12} /></span></div>
    </div>
    {creating && <CreatePoolItem teams={maintainableTeams} onClose={() => setCreating(false)} />}
    {detailId !== null && <PoolDetail key={detailId} id={detailId} onClose={() => setDetailId(null)} onConvert={startConvert} />}
    {converted && <ConvertPoolItem item={converted} onClose={() => setConvertId(null)} />}
  </>;
}

function PoolTable({ items, teams, onOpen, onConvert }: { items: PoolItem[]; teams: Team[]; onOpen: (id: number) => void; onConvert: (id: number) => void }) {
  const { data } = useWorkspace();
  const canCreate = canCreatePoolItem(data.actor) && data.teams.some(team => canMaintainPoolTeam(data.actor, team.id));
  if (!items.length) return <EmptyState title="需求池里还没有匹配的条目" description={canCreate ? "业务期望与待评估需求会先沉淀在这里，确认价值后再进入研发流程。" : "业务期望与待评估需求会先沉淀在这里，等待产品经理评估。"} />;
  return <>
    <div className="table-scroll">
      <table className="requirement-table pool-table">
        <colgroup><col className="col-title" /><col className="col-stage" /><col className="col-dwell" /><col className="col-owner" /><col className="col-date" /><col className="col-flags" /></colgroup>
        <thead><tr><th>需求名称</th><th>所属团队</th><th>优先级</th><th>提报人</th><th>期望实现时间</th><th>状态</th></tr></thead>
        <tbody>{items.map(item => {
          const team = teamOf(teams, item.teamId);
          const convertible = item.status === "pending" && canDecidePoolTeam(data.actor, item.teamId);
          return <tr key={item.id} onClick={() => onOpen(item.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onOpen(item.id); }} aria-label={`查看需求池条目：${item.title}`}>
            <td><div className="requirement-title"><PriorityMark priority={item.priority} /><span>{item.title}</span></div><div className="requirement-secondary">{item.businessValue ? <span className="pool-secondary-text" title={item.businessValue}><span>·</span>{item.businessValue}</span> : <span className="pool-secondary-text"><span>·</span>{item.description || "还没有补充需求描述"}</span>}</div></td>
            <td>{team ? <span className="owner-cell"><TeamIcon team={team} small /><span>{team.name}</span></span> : <span className="subtle">团队已删除</span>}</td>
            <td><span className="pool-priority-label">{PRIORITIES[item.priority]}</span></td>
            <td><span className="owner-cell"><Avatar name={item.submitter} small /><span>{item.submitter || "未填写"}</span></span></td>
            <td><span className={`due-date ${!item.expectedDate ? "missing" : ""}`}>{item.expectedDate ? item.expectedDate.replaceAll("-", ".") : "未填写期望时间"}</span></td>
            <td className="flags-cell"><span className="pool-row-actions"><PoolStatusBadge status={item.status} />{convertible ? <button className="text-button pool-convert-button" onClick={event => { event.stopPropagation(); onConvert(item.id); }}><Rocket size={12} />转为需求</button> : <ChevronRight className="row-chevron" size={14} />}</span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="mobile-requirements">{items.map(item => {
      const team = teamOf(teams, item.teamId);
      return <button className="mobile-requirement" key={item.id} onClick={() => onOpen(item.id)}>
        <div className="mobile-req-heading"><PriorityMark priority={item.priority} /><strong>{item.title}</strong><ChevronRight size={15} /></div>
        <div className="mobile-req-middle"><span className="stage-label"><span />{team?.name || "团队已删除"}</span><span>{PRIORITIES[item.priority]}</span><PoolStatusBadge status={item.status} /></div>
        <div className="mobile-req-footer"><span><Avatar name={item.submitter} small />{item.submitter || "未填写提报人"}</span><span><CalendarDays size={12} />{item.expectedDate ? `${shortDate(item.expectedDate)} 期望实现` : "未填写期望时间"}</span></div>
      </button>;
    })}</div>
  </>;
}

function CreatePoolItem({ teams, onClose }: { teams: Team[]; onClose: () => void }) {
  const { data, busy, mutate } = useWorkspace();
  const [form, setForm] = useState({ teamId: teams[0]?.id || "", title: "", description: "", priority: DEFAULT_PRIORITY, submitter: data.actor.name, expectedDate: "", businessValue: "", note: "" });
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const today = todayString(data.now);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try { await mutate("createPoolItem", form, "已加入需求池，等待评估"); onClose(); } catch { /* 保留表单便于修正 */ }
  };
  return <Modal title="新建需求池条目" description="记录一个尚未进入研发流程的业务期望，评估后再决定是否转正式需求。" onClose={onClose}
    footer={<><span className="form-footer-note"><Lightbulb size={13} />需求池不影响工作台与统计</span><button className="button" onClick={onClose}>取消</button><button className="button primary" type="submit" form="create-pool-item" disabled={busy || !form.teamId || !form.title.trim()}>{busy ? <Spinner /> : <Check size={16} />}加入需求池</button></>}>
    <form id="create-pool-item" className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="pool-team">所属团队 <em>*</em></label><Select id="pool-team" value={form.teamId} onChange={value => set("teamId", value)} options={teams.map(team => ({ value: team.id, label: team.name }))} placeholder="选择团队" ariaLabel="所属团队" /></div>
        <div className="form-field"><label htmlFor="pool-priority">优先级</label><Select id="pool-priority" value={form.priority} onChange={value => set("priority", value)} options={Object.entries(PRIORITIES).map(([key, label]) => ({ value: key, label }))} ariaLabel="优先级" /></div>
      </div>
      <div className="form-field"><label htmlFor="pool-title">需求名称 <em>*</em></label><input id="pool-title" autoComplete="off" required maxLength={120} placeholder="用一句话描述业务期望实现的功能" value={form.title} onChange={event => set("title", event.target.value)} /><span className="field-counter">{form.title.length} / 120</span></div>
      <div className="form-field"><label htmlFor="pool-description">需求描述<span>选填</span></label><textarea id="pool-description" rows={3} maxLength={2000} placeholder="补充业务背景、使用场景或关键诉求…" value={form.description} onChange={event => set("description", event.target.value)} /></div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="pool-submitter">提报人</label><input id="pool-submitter" maxLength={40} placeholder="默认当前账号" value={form.submitter} onChange={event => set("submitter", event.target.value)} /></div>
        <div className="form-field"><label htmlFor="pool-expected">期望实现时间<span>选填</span></label><DatePicker id="pool-expected" value={form.expectedDate} onChange={value => set("expectedDate", value)} placeholder="选择今天及以后" min={today} ariaLabel="期望实现时间" /><small className="field-help">业务期望的落地时间，不早于今天；不确定可留空。</small></div>
      </div>
      <div className="form-field"><label htmlFor="pool-value">业务价值说明<span>选填</span></label><textarea id="pool-value" rows={3} maxLength={2000} placeholder="例如：预计每周减少 6 小时人工操作，或支撑某类客户的签约诉求…" value={form.businessValue} onChange={event => set("businessValue", event.target.value)} /></div>
      <div className="form-field"><label htmlFor="pool-note">备注<span>选填</span></label><textarea id="pool-note" rows={2} maxLength={1000} placeholder="补充信息，如依赖、约束或已沟通结论…" value={form.note} onChange={event => set("note", event.target.value)} /></div>
      <div className="form-information"><Info size={16} /><div>需求池条目<strong>不会进入工作台、需求统计或钉钉摘要</strong>。<p>评估通过后可一键转为正式需求：选择期望上线/完成日期后，需求将从团队流程的第一个阶段开始。</p></div></div>
    </form>
  </Modal>;
}

function PoolDetail({ id, onClose, onConvert }: { id: number; onClose: () => void; onConvert: (id: number) => void }) {
  const { data, busy, mutate, openDetail, notify } = useWorkspace();
  const item = data.pool.find(entry => entry.id === id);
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const revealAction = useRevealInlineAction();
  const [decisionNote, setDecisionNote] = useState(item?.decisionNote || "");
  const [form, setForm] = useState({ teamId: "", title: "", description: "", priority: DEFAULT_PRIORITY, submitter: "", expectedDate: "", businessValue: "", note: "" });
  if (!item) return null;
  const team = teamOf(data.poolTeams, item.teamId) ?? teamOf(data.teams, item.teamId);
  const maintainableTeams = data.teams.filter(entry => canMaintainPoolTeam(data.actor, entry.id));
  const canEdit = item.status === "pending" && canMaintainPoolTeam(data.actor, item.teamId);
  const canDecide = canDecidePoolTeam(data.actor, item.teamId);
  const linkedRequirement = item.requirementId ? data.requirements.find(entry => entry.id === item.requirementId) : undefined;
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const startEdit = () => { setForm({ teamId: item.teamId, title: item.title, description: item.description, priority: item.priority, submitter: item.submitter, expectedDate: item.expectedDate || "", businessValue: item.businessValue, note: item.note }); setEditing(true); setRejecting(false); setReopening(false); };
  const save = async (event: FormEvent) => { event.preventDefault(); try { await mutate("updatePoolItem", { id, ...form }, "需求池条目已更新"); setEditing(false); } catch {} };
  const reject = async (event: FormEvent) => { event.preventDefault(); try { await mutate("rejectPoolItem", { id, decisionNote }, "已标记为不采纳，记录保留可查"); setRejecting(false); } catch {} };
  const reopen = async () => { try { await mutate("reopenPoolItem", { id }, "已回到待评估，可重新给出结论"); setReopening(false); } catch {} };
  const copy = async () => { try { await navigator.clipboard.writeText(`需求池 #${item.id} ${item.title}`); notify("条目标题已复制"); } catch { notify("浏览器暂不支持复制，请手动选中复制", "info"); } };
  // 各分支带不同 key：点击「编辑」后整个 footer 卸载重建，被点击的按钮节点随旧子树断开连接，
  // 避免它被 React 同节点改造成带 form 关联的 submit 按钮后，浏览器仍按点击默认动作自动提交编辑表单。
  const footer = editing
    ? <div key="editing" className="drawer-edit-footer desktop-edit"><button type="button" className="button" onClick={() => setEditing(false)}>取消编辑</button><button className="button primary" type="submit" form="edit-pool-item" disabled={busy || !form.title.trim()}>{busy ? <Spinner /> : <Check size={16} />}保存修改</button></div>
    : item.status === "pending" && (canEdit || canDecide) ? <div key="pending-actions" className="drawer-actions desktop-edit">
        {canDecide
          ? <button type="button" className="text-button cancel-requirement" onClick={() => { setRejecting(!rejecting); setReopening(false); }}><Ban size={15} />标记不采纳</button>
          : <span className="drawer-status-note"><Info size={14} />筛选结论由产品经理确认</span>}
        {canEdit && <button type="button" className="button" onClick={startEdit}><Pencil size={15} />编辑</button>}
        {canDecide && <button type="button" className="button primary advance-button" onClick={() => onConvert(item.id)}><Rocket size={16} />转为正式需求</button>}
      </div>
    : item.status !== "pending" && canDecide ? <div key="decided-actions" className="drawer-actions desktop-edit">
        <span className="drawer-status-note"><Info size={14} />已给出筛选结论，条目只读</span>
        <button type="button" className="button" onClick={() => { setReopening(!reopening); setRejecting(false); }}><RotateCcw size={15} />重新评估</button>
      </div>
    : <div key="readonly" className="drawer-readonly"><ShieldCheck size={15} />{item.status === "pending" ? "当前账号对该团队的需求池仅有浏览权限" : "该条目已给出筛选结论，仅供查阅"}<button type="button" className="button" onClick={onClose}>关闭详情</button></div>;
  return <Modal drawer eyebrow={<><span className="pool-eyebrow"><Lightbulb size={12} />需求池</span><ChevronRight size={12} /><span>POOL-{String(item.id).padStart(3, "0")}</span><button className="icon-button tiny" aria-label="复制条目标题" onClick={copy}><Copy size={12} /></button></>} title={editing ? "编辑需求池条目" : item.title} onClose={onClose} footer={footer}>
    {editing ? <form id="edit-pool-item" className="form-stack" onSubmit={save}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="edit-pool-team">所属团队 <em>*</em></label><Select id="edit-pool-team" value={form.teamId} onChange={value => set("teamId", value)} options={maintainableTeams.map(entry => ({ value: entry.id, label: entry.name }))} placeholder="选择团队" ariaLabel="所属团队" /></div>
        <div className="form-field"><label htmlFor="edit-pool-priority">优先级</label><Select id="edit-pool-priority" value={form.priority} onChange={value => set("priority", value)} options={Object.entries(PRIORITIES).map(([key, label]) => ({ value: key, label }))} ariaLabel="优先级" /></div>
      </div>
      <div className="form-field"><label htmlFor="edit-pool-title">需求名称 <em>*</em></label><input id="edit-pool-title" required maxLength={120} value={form.title} onChange={event => set("title", event.target.value)} /></div>
      <div className="form-field"><label htmlFor="edit-pool-description">需求描述</label><textarea id="edit-pool-description" rows={4} maxLength={2000} value={form.description} onChange={event => set("description", event.target.value)} /></div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="edit-pool-submitter">提报人</label><input id="edit-pool-submitter" maxLength={40} value={form.submitter} onChange={event => set("submitter", event.target.value)} /></div>
        <div className="form-field"><label htmlFor="edit-pool-expected">期望实现时间<span>选填</span></label><DatePicker id="edit-pool-expected" value={form.expectedDate} onChange={value => set("expectedDate", value)} placeholder="未填写期望时间" ariaLabel="期望实现时间" /></div>
      </div>
      <div className="form-field"><label htmlFor="edit-pool-value">业务价值说明</label><textarea id="edit-pool-value" rows={3} maxLength={2000} value={form.businessValue} onChange={event => set("businessValue", event.target.value)} /></div>
      <div className="form-field"><label htmlFor="edit-pool-note">备注</label><textarea id="edit-pool-note" rows={2} maxLength={1000} value={form.note} onChange={event => set("note", event.target.value)} /></div>
    </form> : <>
      <div className="detail-badges"><PoolStatusBadge status={item.status} /><Badge tone={item.priority === "high" ? "red" : item.priority === "medium" ? "amber" : "neutral"}><Flag size={11} />{PRIORITIES[item.priority]}</Badge>{item.status === "pending" && canDecide && <button type="button" className="text-button detail-edit desktop-edit" onClick={() => onConvert(item.id)}><Rocket size={13} />转为正式需求</button>}</div>
      <div className="detail-meta">
        <div><label>{team ? <TeamIcon team={team} small /> : <Info size={13} />}所属团队</label><span>{team?.name || "团队已删除"}</span></div>
        <div><label><UserRound size={13} />提报人</label><span><Avatar name={item.submitter} small />{item.submitter || "未填写"}</span></div>
        <div><label><CalendarDays size={13} />期望实现时间</label><span className={!item.expectedDate ? "subtle" : ""}>{item.expectedDate ? item.expectedDate.replaceAll("-", ".") : "未填写期望时间"}</span></div>
        <div><label><Clock3 size={13} />提报时间</label><span>{item.createdAt.slice(0, 10).replaceAll("-", ".")}</span></div>
        <div><label><Target size={13} />关联需求</label><span>{item.requirementId ? (linkedRequirement ? <button className="text-button" onClick={() => openDetail(linkedRequirement.id)}><Rocket size={12} />{requirementCode(linkedRequirement.id)} · {linkedRequirement.title}</button> : <span className="subtle">{requirementCode(item.requirementId)} · 需求不可见或已移除</span>) : <span className="subtle">尚未转正式需求</span>}</span></div>
      </div>
      <section className="detail-section description-section"><div className="detail-section-heading"><h3>需求描述</h3></div><p>{item.description || "还没有补充描述。清晰的背景与使用场景，有助于评估这项需求的价值。"}</p></section>
      <section className="detail-section description-section"><div className="detail-section-heading"><h3>业务价值说明</h3></div><p>{item.businessValue || "还没有补充业务价值。说明预期收益，有助于在需求池中排定优先级。"}</p></section>
      {item.note && <section className="detail-section description-section"><div className="detail-section-heading"><h3>备注</h3></div><p>{item.note}</p></section>}
      {item.status !== "pending" && item.decisionNote && <section className="detail-section description-section"><div className="detail-section-heading"><h3>评估说明</h3></div><p>{item.decisionNote}</p></section>}
      {item.status !== "pending" && <div className={`pool-decision ${item.status}`}><IconFor status={item.status} /><div><strong>{item.status === "accepted" ? "已采纳：已转为正式需求" : "不采纳：暂不进入研发流程"}</strong><p>{item.decidedAt ? `${item.decidedAt.slice(0, 10).replaceAll("-", ".")} 由 ${data.members.find(member => member.id === item.decidedBy)?.name || "产品经理"} 给出结论。` : "已给出筛选结论。"}重新评估后条目会回到待评估，已生成的正式需求会继续保留在需求流程中。</p></div></div>}
      {!canEdit && !canDecide && <div className="pool-readonly-note"><ShieldCheck size={14} />业务负责人的需求池权限为录入与编辑；筛选结论由产品经理或空间管理员确认。</div>}
      <div className="detail-update">最近更新于 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.updatedAt))}<span>操作人：{data.members.find(member => member.id === item.updatedBy)?.name || "系统"}</span></div>
      <div className="mobile-readonly-note"><ShieldCheck size={13} />当前为手机只读模式，请在电脑端维护需求池。</div>
    </>}
    {rejecting && canDecide && <form ref={revealAction} className="inline-action-box block-form desktop-edit" onSubmit={reject}><h3><Ban size={16} />标记为不采纳</h3><p>确认后条目进入「不采纳」，不再参与需求池的后续评估；如需重新考虑可再执行「重新评估」。</p><textarea value={decisionNote} onChange={event => setDecisionNote(event.target.value)} placeholder="选填：评估说明，例如暂不投入的原因…" rows={3} maxLength={1000} aria-label="评估说明" /><div className="inline-actions"><button className="button small" type="button" onClick={() => setRejecting(false)}>取消</button><button className="button danger small" type="submit" disabled={busy}>{busy ? <Spinner /> : <Ban size={14} />}确认不采纳</button></div></form>}
    {reopening && canDecide && <div ref={revealAction} className="inline-action-box cancel-confirm desktop-edit"><h3><RotateCcw size={16} />重新评估这条需求？</h3><p>条目会回到「待评估」并解除与正式需求的关联；已生成的需求仍保留在研发流程中，不会删除。</p><div className="inline-actions"><button type="button" className="button small" onClick={() => setReopening(false)}>暂不调整</button><button type="button" className="button primary small" disabled={busy} onClick={reopen}>{busy && <Spinner />}确认重新评估</button></div></div>}
  </Modal>;
}

function ConvertPoolItem({ item, onClose }: { item: PoolItem; onClose: () => void }) {
  const { data, busy, mutate, openDetail } = useWorkspace();
  // 转入生成的是正式需求，团队范围按正式需求维护权限判断（空间管理员全部、产品经理绑定团队）。
  const teams = data.teams.filter(team => canMaintain(data.actor, team.id));
  const [form, setForm] = useState({ teamId: teams.some(team => team.id === item.teamId) ? item.teamId : teams[0]?.id || "", title: item.title, owner: item.submitter, expectedDate: "", requirementCycle: DEFAULT_REQUIREMENT_CYCLE });
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const today = todayString(data.now);
  const selectedTeam = data.teams.find(team => team.id === form.teamId);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await mutate("convertPoolItem", { id: item.id, ...form }, "已转为正式需求，可在需求详情中继续推进");
      onClose();
      if (result.id) openDetail(Number(result.id));
    } catch { /* 保留表单便于修正 */ }
  };
  return <Modal title="转为正式需求" description="需求池条目将标记为已采纳，并生成一条从团队流程第一个阶段开始的需求。" onClose={onClose}
    footer={<><span className="form-footer-note"><Lightbulb size={13} />需求池记录会保留来源追溯</span><button className="button" onClick={onClose}>取消</button><button className="button primary" type="submit" form="convert-pool-item" disabled={busy || !form.teamId || !form.title.trim() || !form.expectedDate}>{busy ? <Spinner /> : <Rocket size={16} />}确认转入</button></>}>
    <form id="convert-pool-item" className="form-stack" onSubmit={submit}>
      <div className="form-information"><FileText size={16} /><div>来自需求池：<strong>{item.title}</strong><p>{PRIORITIES[item.priority]} · 提报人 {item.submitter || "未填写"}{item.businessValue ? ` · ${item.businessValue}` : ""}</p></div></div>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="convert-team">所属团队 <em>*</em></label><Select id="convert-team" value={form.teamId} onChange={value => set("teamId", value)} options={teams.map(team => ({ value: team.id, label: team.name }))} placeholder="选择团队" ariaLabel="所属团队" /></div>
        <div className="form-field"><label htmlFor="convert-owner">需求负责人<span>选填</span></label><input id="convert-owner" maxLength={40} placeholder="默认沿用提报人" value={form.owner} onChange={event => set("owner", event.target.value)} /></div>
      </div>
      <div className="form-field"><label htmlFor="convert-title">需求标题 <em>*</em></label><input id="convert-title" required maxLength={120} value={form.title} onChange={event => set("title", event.target.value)} /><span className="field-counter">{form.title.length} / 120</span></div>
      <div className="form-field"><label htmlFor="convert-date">期望上线/完成日期 <em>*</em></label><DatePicker id="convert-date" value={form.expectedDate} onChange={value => set("expectedDate", value)} placeholder="选择今天及以后" min={today} clearable={false} minHint={`期望上线/完成日期不能早于今天（${today}）`} ariaLabel="期望上线/完成日期" /><small className="field-help">必填，只能选择今天及以后（按北京时间）；创建后不可修改。</small></div>
      <div className="form-field"><label id="convert-cycle-label">需求周期 <em>*</em></label><div className="choice-group" role="radiogroup" aria-labelledby="convert-cycle-label">{Object.entries(REQUIREMENT_CYCLES).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={form.requirementCycle === value} className={`choice ${form.requirementCycle === value ? "selected" : ""}`} onClick={() => set("requirementCycle", value)}><strong>{label}</strong><span>{value === "next" ? "下周一 09:00 开始" : "立即进入在途"}</span></button>)}</div><small className="field-help">转入后需求从「{selectedTeam?.stages[0]?.name || "初始阶段"}」开始，来源记为「需求池转入」。</small></div>
    </form>
  </Modal>;
}

function IconFor({ status }: { status: PoolItemStatus }) {
  const Icon = STATUS_ICONS[status];
  return <Icon size={16} />;
}
