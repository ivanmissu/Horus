"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, Archive, ArrowDownRight, ArrowUpRight, Ban, BarChart3, CalendarDays, CircleHelp, CirclePause, Info, Layers3, Minus, RefreshCw, Rocket, Sparkles, Target } from "lucide-react";
import { PageHeading } from "./requirement-views";
import { useWorkspace } from "./workspace-context";
import { Badge, EmptyState, Modal, Select, Spinner } from "./ui";
import { embeddedAuthHeaders } from "@/lib/embedded-session";
import type { StatsBucket, StatsData, StatsGranularity } from "@/lib/types";

const count = (value: number) => value.toString().padStart(2, "0");
const ratioText = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;

function Delta({ value, goodWhenUp = true }: { value: number | null; goodWhenUp?: boolean }) {
  if (value === null) return <span className="stats-delta flat">首期</span>;
  if (value === 0) return <span className="stats-delta flat"><Minus size={11} />持平</span>;
  const up = value > 0;
  const good = up === goodWhenUp;
  return <span className={`stats-delta ${good ? "good" : "bad"}`}>{up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{up ? "+" : ""}{value}</span>;
}

type ChartHover = { index: number; x: number; y: number };
type ChartTipRow = { label: string; value: number; tone: string };

function ChartTipBox({ hover, title, rows }: { hover: ChartHover; title: string; rows: ChartTipRow[] }) {
  return <div className={`stats-chart-tooltip ${hover.y < 110 ? "below" : ""}`} style={{ left: hover.x, top: hover.y }} role="status">
    <strong>{title}</strong>
    {rows.map(row => <span key={row.label}><i className={row.tone} />{row.label}<b>{row.value}</b></span>)}
  </div>;
}

function BarChart({ buckets }: { buckets: StatsBucket[] }) {
  const width = 820;
  const height = 270;
  const padding = { top: 18, right: 14, bottom: 40, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const peak = Math.max(1, ...buckets.flatMap(bucket => [bucket.created, bucket.released, bucket.cancelled]));
  const step = Math.max(1, Math.ceil(peak / 4));
  const top = step * 4;
  const groupWidth = plotWidth / Math.max(1, buckets.length);
  const barWidth = Math.max(4, Math.min(15, (groupWidth - 10) / 3));
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const track = (event: { clientX: number; clientY: number }, index: number) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(Math.max(event.clientX - box.left, 86), Math.max(86, box.width - 86));
    setHover({ index, x, y: event.clientY - box.top });
  };
  return <div className="stats-chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
    <div className="stats-chart-scroll">
      <svg className="stats-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="需求新建、上线与取消趋势">
        {[0, 1, 2, 3, 4].map(index => {
          const y = padding.top + plotHeight - (plotHeight * index) / 4;
          return <g key={index}>
            <line className="stats-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
            <text className="stats-axis-text" x={padding.left - 8} y={y + 4} textAnchor="end">{Math.round((top * index) / 4)}</text>
          </g>;
        })}
        {hover && <rect className="stats-hover-band" x={padding.left + hover.index * groupWidth} y={0} width={groupWidth} height={height} />}
        {buckets.map((bucket, index) => {
          const center = padding.left + index * groupWidth + groupWidth / 2;
          const values = [bucket.created, bucket.released, bucket.cancelled];
          return <g key={bucket.key}>
            {values.map((value, series) => {
              const barHeight = (value / top) * plotHeight;
              const x = center - barWidth * 1.5 - 2 + series * (barWidth + 2);
              return <rect key={series} className={`stats-bar stats-bar-${series}`} x={x} y={padding.top + plotHeight - barHeight} width={barWidth} height={barHeight} rx={2} />;
            })}
            <text className={`stats-axis-text ${bucket.current ? "current" : ""}`} x={center} y={height - 14} textAnchor="middle">{bucket.shortLabel}</text>
          </g>;
        })}
        {buckets.map((bucket, index) => <rect
          key={`hit-${bucket.key}`} x={padding.left + index * groupWidth} y={0} width={groupWidth} height={height} fill="transparent"
          onMouseEnter={event => track(event, index)} onMouseMove={event => track(event, index)}
        />)}
      </svg>
    </div>
    {hover && <ChartTipBox hover={hover} title={buckets[hover.index].label} rows={[
      { label: "新建", value: buckets[hover.index].created, tone: "purple" },
      { label: "上线", value: buckets[hover.index].released, tone: "teal" },
      { label: "取消", value: buckets[hover.index].cancelled, tone: "red" },
    ]} />}
  </div>;
}

function StockChart({ buckets }: { buckets: StatsBucket[] }) {
  const width = 820;
  const height = 210;
  const padding = { top: 16, right: 16, bottom: 30, left: 34 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const peak = Math.max(1, ...buckets.flatMap(bucket => [bucket.stock, bucket.blocked]));
  const step = Math.max(1, Math.ceil(peak / 3));
  const top = step * 3;
  const x = (index: number) => buckets.length <= 1 ? padding.left + plotWidth / 2 : padding.left + (plotWidth * index) / (buckets.length - 1);
  const y = (value: number) => padding.top + plotHeight - (value / top) * plotHeight;
  const bandWidth = buckets.length <= 1 ? plotWidth : plotWidth / (buckets.length - 1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ChartHover | null>(null);
  const track = (event: { clientX: number; clientY: number }, index: number) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(Math.max(event.clientX - box.left, 86), Math.max(86, box.width - 86));
    setHover({ index, x, y: event.clientY - box.top });
  };
  const series = [
    { key: "stock" as const, label: "在途存量", tone: "purple" },
    { key: "blocked" as const, label: "卡点需求", tone: "orange" },
  ];
  return <div className="stats-chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
    <div className="stats-chart-scroll">
      <svg className="stats-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="在途存量与卡点趋势">
        {[0, 1, 2, 3].map(index => {
          const lineY = padding.top + plotHeight - (plotHeight * index) / 3;
          return <g key={index}>
            <line className="stats-grid-line" x1={padding.left} x2={width - padding.right} y1={lineY} y2={lineY} />
            <text className="stats-axis-text" x={padding.left - 8} y={lineY + 4} textAnchor="end">{Math.round((top * index) / 3)}</text>
          </g>;
        })}
        {hover && <rect className="stats-hover-band" x={x(hover.index) - bandWidth / 2} y={0} width={bandWidth} height={height} />}
        {series.map(item => {
          const path = buckets.map((bucket, index) => `${index ? "L" : "M"}${x(index)},${y(bucket[item.key])}`).join(" ");
          return <g key={item.key}>
            <path className={`stats-line stats-line-${item.tone}`} d={path} />
            {buckets.map((bucket, index) => <circle key={bucket.key} className={`stats-point stats-point-${item.tone}`} cx={x(index)} cy={y(bucket[item.key])} r={2.6} />)}
          </g>;
        })}
        {buckets.map((bucket, index) => <text key={bucket.key} className={`stats-axis-text ${bucket.current ? "current" : ""}`} x={x(index)} y={height - 10} textAnchor="middle">{bucket.shortLabel}</text>)}
        {buckets.map((bucket, index) => <rect
          key={`hit-${bucket.key}`} x={x(index) - bandWidth / 2} y={0} width={bandWidth} height={height} fill="transparent"
          onMouseEnter={event => track(event, index)} onMouseMove={event => track(event, index)}
        />)}
      </svg>
    </div>
    {hover && <ChartTipBox hover={hover} title={buckets[hover.index].label} rows={[
      { label: "在途存量", value: buckets[hover.index].stock, tone: "purple" },
      { label: "卡点需求", value: buckets[hover.index].blocked, tone: "orange" },
    ]} />}
  </div>;
}

export function StatsPage() {
  const { data } = useWorkspace();
  const router = useRouter();
  const [granularity, setGranularity] = useState<StatsGranularity>("week");
  const [teamId, setTeamId] = useState("");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [error, setError] = useState("");
  const [rules, setRules] = useState(false);
  const [version, setVersion] = useState(0);
  const periods = granularity === "week" ? 12 : 6;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ granularity, periods: String(periods) });
    if (teamId) params.set("teamId", teamId);
    fetch(`/api/stats?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: data.embeddedAuth ? embeddedAuthHeaders() : {},
    })
      .then(async response => {
        const result = await response.json();
        if (response.status === 401) {
          if (data.embeddedAuth) window.location.replace("/login");
          else router.push("/login");
          throw new Error("登录已过期，请重新登录");
        }
        if (!response.ok) throw new Error(result.error || "加载统计数据失败");
        setStats(result as StatsData);
      })
      .catch((reason: Error) => { if (reason.name !== "AbortError") setError(reason.message); });
    return () => controller.abort();
  }, [granularity, periods, teamId, version, data.embeddedAuth, router]);

  const loading = !stats && !error;
  const reload = () => {
    setStats(null);
    setError("");
    setVersion(value => value + 1);
  };
  const switchGranularity = (next: StatsGranularity) => {
    if (next === granularity) return;
    setStats(null);
    setError("");
    setGranularity(next);
  };
  const switchTeam = (next: string) => {
    setStats(null);
    setError("");
    setTeamId(next);
  };
  const current = stats?.current;
  const previous = stats?.previous;
  const kpis = current ? [
    { label: "本期新建", value: current.created, delta: previous ? current.created - previous.created : null, hint: granularity === "week" ? "本周一至今创建" : "本月 1 日至今创建", icon: Sparkles, tone: "blue", goodWhenUp: true },
    { label: "本期上线", value: current.released, delta: previous ? current.released - previous.released : null, hint: "推进到上线阶段", icon: Rocket, tone: "purple", goodWhenUp: true },
    { label: "本期取消", value: current.cancelled, delta: previous ? current.cancelled - previous.cancelled : null, hint: "取消即归档", icon: Ban, tone: "red", goodWhenUp: false },
    { label: "本期卡点", value: current.blocked, delta: previous ? current.blocked - previous.blocked : null, hint: granularity === "week" ? "周内去重需求数" : "月内去重需求数", icon: CirclePause, tone: "orange", goodWhenUp: false },
    { label: "本期逾期上线", value: current.lateReleased, delta: previous ? current.lateReleased - previous.lateReleased : null, hint: `其中高优 ${current.lateReleasedHigh} 项 · 按实际上线日归期`, icon: AlarmClock, tone: "red", goodWhenUp: false },
  ] : [];
  const mini = current ? [
    { label: "在途存量", value: count(current.stock), hint: "含已上线待归档", icon: Layers3, tone: "purple" },
    { label: "净增", value: `${current.net > 0 ? "+" : ""}${current.net}`, hint: "新建 − 取消 − 归档", icon: BarChart3, tone: current.net < 0 ? "red" : "teal" },
    { label: "本期归档", value: count(current.archived), hint: "上线后归档", icon: Archive, tone: "teal" },
    { label: "上线 / 新建", value: ratioText(current.releaseRatio), hint: "大于 100% 表示在消化存量", icon: ArrowUpRight, tone: "blue" },
    { label: "预期达成率", value: ratioText(current.expectedRatio), hint: `按期 ${current.expectedMet} / 到期 ${current.expectedDue}${stats && stats.missingExpected > 0 ? ` · 未填 ${stats.missingExpected}` : ""}`, icon: Target, tone: "blue" },
    { label: "高优逾期", value: count(current.overdue), hint: "截至现在仍未上线", icon: AlarmClock, tone: current.overdue ? "red" : "orange" },
  ] : [];

  return <div className="stats-page">
    <PageHeading
      title="需求统计"
      subtitle={`需求流入、交付与风险，按${granularity === "week" ? "自然周" : "自然月"}看清。`}
      actions={<>
        <span className="today-label"><CalendarDays size={14} />{stats ? `本期 ${stats.current.label}` : "本周"}</span>
        <button className={`button icon-only refresh-button ${loading ? "refreshing" : ""}`} disabled={loading} onClick={reload} aria-label="刷新统计"><RefreshCw size={16} /></button>
      </>}
    />
    <section className="card stats-toolbar">
      <div className="stats-segmented" role="group" aria-label="统计粒度">
        <button className={granularity === "week" ? "active" : ""} onClick={() => switchGranularity("week")}><CalendarDays size={14} />按周</button>
        <button className={granularity === "month" ? "active" : ""} onClick={() => switchGranularity("month")}><BarChart3 size={14} />按月</button>
      </div>
      <Select value={teamId} onChange={switchTeam} variant="quiet" options={[{ value: "", label: "全部团队" }, ...data.teams.map(team => ({ value: team.id, label: team.name }))]} ariaLabel="按团队筛选统计" />
      <span className="stats-window">{granularity === "week" ? `近 ${periods} 个自然周` : `近 ${periods} 个自然月`} · {granularity === "week" ? "每周一 00:00 切分" : "按自然月切分"}</span>
      <button className="text-button stats-rule-button" onClick={() => setRules(true)}>统计口径<CircleHelp size={13} /></button>
    </section>
    {stats?.hasEstimates && <div className="stats-estimate-note stats-estimate-banner" role="status"><Info size={14} />历史数据由创建、上线、取消时间与审计日志回填，标记为估算，仅供趋势参考。</div>}

    {loading && !stats ? <section className="card stats-loading" role="status"><Spinner />正在汇总需求数据…</section>
      : error ? <section className="card stats-loading" role="alert"><Info size={17} /><p>{error}</p><button className="button small" onClick={reload}>重试</button></section>
        : stats && current ? <>
          <div className="metrics-grid stats-kpi-grid">{kpis.map(item => <div key={item.label} className={`metric-card metric-${item.tone}`}>
            <div className="metric-top"><span>{item.label}</span><span className={`metric-icon ${item.tone}`}><item.icon size={19} strokeWidth={1.7} /></span></div>
            <div className="metric-middle"><strong>{count(item.value)}</strong><span>项需求</span></div>
            <div className="metric-foot"><i />{item.hint}<span className="stats-kpi-delta"><Delta value={item.delta} goodWhenUp={item.goodWhenUp} /></span></div>
          </div>)}</div>
          <div className="stats-mini-grid">{mini.map(item => <div className={`stats-mini-card stats-mini-${item.tone}`} key={item.label}>
            <span className="stats-mini-icon"><item.icon size={15} strokeWidth={1.8} /></span>
            <div><span>{item.label}</span><strong>{item.value}</strong><small>{item.hint}</small></div>
          </div>)}</div>

          <section className="card stats-chart-card">
            <div className="table-card-heading"><div><h2>流量趋势<span className="small-label">{granularity === "week" ? "按自然周" : "按自然月"}</span></h2><p>新建、上线与取消的数量变化，本期为进行中的区间</p></div><div className="stats-chart-legend"><span><i className="purple" />新建</span><span><i className="teal" />上线</span><span><i className="red" />取消</span></div></div>
            <div className="stats-chart-scroll"><BarChart buckets={stats.buckets} /></div>
          </section>

          <div className="stats-two-column">
            <section className="card stats-chart-card">
              <div className="table-card-heading"><div><h2>存量与卡点<span className="small-label">期末值</span></h2><p>在途需求是否越积越多，卡点是否在收敛</p></div><div className="stats-chart-legend"><span><i className="purple" />在途存量</span><span><i className="orange" />卡点</span></div></div>
              <div className="stats-chart-scroll"><StockChart buckets={stats.buckets} /></div>
            </section>
            <section className="card stats-note-card">
              <div className="table-card-heading"><div><h2>本期怎么读<span className="small-label">{current.label}</span></h2><p>先看流入、交付与风险，再看结构</p></div></div>
              <div className="stats-read-list">
                <div><span className="stats-read-icon blue"><Sparkles size={15} /></span><p><strong>{current.created} 项新建</strong>，同期有 {current.released} 项推进到上线。</p></div>
                <div><span className="stats-read-icon orange"><CirclePause size={15} /></span><p><strong>{current.blocked} 项需求</strong>在期内被卡住过，期末仍有 {current.overdue} 项高优逾期；本期另有 <strong>{current.lateReleased} 项逾期上线</strong>（其中高优 {current.lateReleasedHigh} 项）。</p></div>
                <div><span className="stats-read-icon teal"><Layers3 size={15} /></span><p>在途存量 <strong>{current.stock} 项</strong>，本期净增 <strong>{current.net > 0 ? "+" : ""}{current.net}</strong>。</p></div>
                <div><span className="stats-read-icon blue"><Target size={15} /></span><p>本期 <strong>{current.expectedDue} 项期望日到期</strong>，其中 <strong>{current.expectedMet} 项按期上线</strong>。</p></div>
              </div>
              <button className="text-button stats-note-link" onClick={() => setRules(true)}>查看完整口径<ArrowUpRight size={13} /></button>
            </section>
          </div>

          <section className="card stats-table-card">
            <div className="table-card-heading"><div><h2>团队对比<span className="small-label">{stats.range.label}</span></h2><p>区间累计；期末在途与高优逾期为当前值</p></div><span className="subtle">共 {stats.teams.length} 个团队</span></div>
            <div className="management-table-scroll"><table className="stats-table">
              <thead><tr><th>团队</th><th>新建</th><th>上线</th><th>逾期上线</th><th>取消</th><th>卡点</th><th>归档</th><th>期末在途</th><th>高优逾期</th><th>预期达成率</th></tr></thead>
              <tbody>{stats.teams.map(team => <tr key={team.teamId}>
                <td><span className={`stats-team-dot ${team.color}`} />{team.name}</td>
                <td>{team.created}</td><td>{team.released}</td><td title={`其中高优 ${team.lateReleasedHigh} 项`} className={team.lateReleased ? "text-red" : ""}>{team.lateReleased}（高优 {team.lateReleasedHigh}）</td><td>{team.cancelled}</td><td>{team.blocked}</td><td>{team.archived}</td><td>{team.stock}</td><td className={team.overdue ? "text-red" : ""}>{team.overdue}</td>
                <td title={`按期 ${team.expectedMet} / 期望日已到 ${team.expectedDue}`}>{ratioText(team.expectedRatio)}</td>
              </tr>)}{!stats.teams.length && <tr><td colSpan={10} className="stats-empty-cell">当前范围内没有团队数据</td></tr>}</tbody>
              <tfoot><tr><td>合计</td><td>{stats.range.created}</td><td>{stats.range.released}</td><td title={`其中高优 ${stats.range.lateReleasedHigh} 项`} className={stats.range.lateReleased ? "text-red" : ""}>{stats.range.lateReleased}（高优 {stats.range.lateReleasedHigh}）</td><td>{stats.range.cancelled}</td><td>{stats.range.blocked}</td><td>{stats.range.archived}</td><td>{stats.range.stock}</td><td>{stats.range.overdue}</td>
                <td title={`按期 ${stats.range.expectedMet} / 期望日已到 ${stats.range.expectedDue}`}>{ratioText(stats.range.expectedRatio)}</td>
              </tr></tfoot>
            </table></div>
          </section>

          <section className="card stats-table-card">
            <div className="table-card-heading"><div><h2>周期明细<span className="small-label">最近在前</span></h2><p>逐期核对流入、流出、逾期上线与存量变化</p></div><span className="subtle">上线 / 新建 = 当期上线数 ÷ 当期新建数；预期达成率 = 按期上线数 ÷ 期望日已到数{stats.missingExpected > 0 ? `；另有 ${stats.missingExpected} 项未填期望日期未计入` : ""}</span></div>
            <div className="management-table-scroll"><table className="stats-table stats-period-table">
              <thead><tr><th>周期</th><th>新建</th><th>上线</th><th>逾期上线（高优）</th><th>取消</th><th>卡点</th><th>归档</th><th>期末在途</th><th>净增</th><th>上线 / 新建</th><th>预期达成率</th></tr></thead>
              <tbody>{[...stats.buckets].reverse().map(bucket => <tr key={bucket.key} className={bucket.current ? "current" : ""}>
                <td><span>{bucket.label}</span>{bucket.current && <Badge tone="blue">进行中</Badge>}</td>
                <td>{bucket.created}</td><td>{bucket.released}</td><td title={`其中高优 ${bucket.lateReleasedHigh} 项`} className={bucket.lateReleased ? "text-red" : ""}>{bucket.lateReleased}（高优 {bucket.lateReleasedHigh}）</td><td>{bucket.cancelled}</td><td>{bucket.blocked}</td><td>{bucket.archived}</td><td>{bucket.stock}</td>
                <td className={bucket.net < 0 ? "text-red" : ""}>{bucket.net > 0 ? "+" : ""}{bucket.net}</td><td>{ratioText(bucket.releaseRatio)}</td>
                <td title={`按期 ${bucket.expectedMet} / 期望日已到 ${bucket.expectedDue}`}>{ratioText(bucket.expectedRatio)}</td>
              </tr>)}</tbody>
            </table></div>
          </section>
        </> : <section className="card stats-loading"><EmptyState title="还没有可统计的需求" description="新建需求并推进状态后，这里会自动汇总。" /></section>}

    {rules && <Modal title="需求统计口径" description="自然周、生命周期事件与存量，一次讲清。" onClose={() => setRules(false)}>
      <div className="rules-list">
        <div><Badge tone="blue">自然周</Badge><p>每周一 00:00（北京时间）开始，至周日 24:00 结束；本期为本周一至当前时刻，按月统计使用自然月。</p></div>
        <div><Badge tone="purple">新建量</Badge><p>按需求创建时间归集，包含之后已上线或已取消的需求，因此可能大于工作台「本周新建」（后者只看仍在推进中的需求）。</p></div>
        <div><Badge tone="teal">上线量</Badge><p>按需求推进到最后一个阶段（正式上线）的时间归集；归档不改变上线时间。</p></div>
        <div><Badge tone="red">取消量</Badge><p>按取消时间归集；取消会立即归档，不再出现在在途列表。</p></div>
        <div><Badge tone="orange">卡点量</Badge><p>该周期内至少被标记过一次卡点的不同需求数；同一需求多次卡点只计一次，跨周期持续卡点会分别计入每个周期。</p></div>
        <div><Badge tone="neutral">在途存量 / 净增</Badge><p>在途 = 尚未归档的需求（含已上线待归档）。净增 = 当期新建 − 取消 − 归档，反映在途规模的变化。</p></div>
        <div><Badge tone="green">上线 / 新建</Badge><p>当期上线数 ÷ 当期新建数。大于 100% 说明当期交付量超过新增量，正在消化历史存量。</p></div>
        <div><Badge tone="teal">预期达成率</Badge><p>按期望上线/完成日期归集：期望日落在该周期、且期望日已到的需求（不含已取消）中，实际上线日不晚于期望上线/完成日（当天算按期）的占比。期望日未到的（含已提前上线）暂不计入，到期后计入；期望日已过仍未上线算未达成。{stats?.missingExpected ? `当前范围内有 ${stats.missingExpected} 项未填期望上线/完成日期，不计入该比率。` : "未填期望上线/完成日期的需求不计入该比率。"}</p></div>
        <div><Badge tone="amber">高优逾期</Badge><p>期末仍未上线、优先级为高，且期望上线/完成日期早于期末的需求数；未填期望日期的不计入。它是期末未完成存量，不含已经上线的需求。</p></div>
        <div><Badge tone="red">逾期上线</Badge><p>按实际上线日期归属周/月；实际上线日期晚于期望上线/完成日期即计为逾期上线，所有优先级都会统计，并单列其中的高优数量。工作台只将未归档的逾期上线计入「全部逾期」及相应的「高优逾期」；归档后不再计入当前数量，但归档历史仍保留状态标记。</p></div>
      </div>
      <div className="guide-note"><Info size={17} /><p>上线、取消与卡点事件自本版本起精确记录。更早的历史数据由创建、上线、取消时间及审计日志回填，页面标记为估算；卡点历史在事件记录启用前可能不完整。</p></div>
      {stats?.hasEstimates && <div className="stats-estimate-note"><Info size={14} />当前统计包含历史回填数据，仅供趋势参考。</div>}
    </Modal>}
  </div>;
}
