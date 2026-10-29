"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Bell, Check, ExternalLink, Eye, EyeOff, Info, Link2, Save, Send, ShieldCheck } from "lucide-react";
import { useWorkspace } from "./workspace-context";
import { Badge, EmptyState, Spinner, TimePicker } from "./ui";
import { PageHeading } from "./requirement-views";
import { countPendingArchiveByTeam } from "@/lib/digest";
import { daysOverdue, isAnyOverdue, isScheduled, PRIORITY_LABELS, todayString } from "@/lib/domain";
import { embeddedAuthHeaders } from "@/lib/embedded-session";

type CredentialState = "loading" | "ready" | "error";

export function NotificationsPage() {
  const { data, busy, mutate } = useWorkspace();
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [time, setTime] = useState(data.settings.time);
  const [webhook, setWebhook] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [savedCredentials, setSavedCredentials] = useState({ webhook: "", signingSecret: "" });
  const [clearSigningSecret, setClearSigningSecret] = useState(false);
  const [appUrl, setAppUrl] = useState(data.settings.appUrl);
  const [showWebhook, setShowWebhook] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [credentialState, setCredentialState] = useState<CredentialState>("loading");
  const [credentialError, setCredentialError] = useState("");
  const [credentialsVersion, setCredentialsVersion] = useState(0);

  // Keep credentials out of the general workspace payload. This endpoint checks
  // the current role on every request and is never cached by the browser.
  useEffect(() => {
    const controller = new AbortController();
    async function loadCredentials() {
      try {
        const response = await fetch("/api/notification-settings", {
          cache: "no-store", signal: controller.signal,
          headers: data.embeddedAuth ? embeddedAuthHeaders() : {},
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "通知配置加载失败，请重试");
        if (typeof result.webhook !== "string" || typeof result.signingSecret !== "string") throw new Error("通知配置加载失败，请重试");
        if (controller.signal.aborted) return;
        setWebhook(result.webhook);
        setSigningSecret(result.signingSecret);
        setSavedCredentials({ webhook: result.webhook, signingSecret: result.signingSecret });
        setCredentialState("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setCredentialError(error instanceof Error && !(error instanceof TypeError) ? error.message : "通知配置加载失败，请重试");
        setCredentialState("error");
      }
    }
    void loadCredentials();
    return () => controller.abort();
  }, [data.embeddedAuth, credentialsVersion]);

  const reloadCredentials = () => {
    setCredentialError("");
    setCredentialState("loading");
    setCredentialsVersion(previous => previous + 1);
  };
  const scheduledDigestAvailable = process.env.NEXT_PUBLIC_HORUS_SCHEDULED_DIGEST_AVAILABLE !== "false";
  const active = data.requirements.filter(r => r.status === "active" && !isScheduled(r, data.now));
  const blocked = active.filter(r => r.blocked);
  // 与钉钉摘要口径保持一致：逾期不限优先级；待归档仅统计本周一前已上线未归档的历史项，为 0 时隐藏。
  const overdue = active.filter(r => isAnyOverdue(r, data.now));
  const alerts = active.filter(r => r.blocked || isAnyOverdue(r, data.now));
  const pendingArchiveTeams = countPendingArchiveByTeam(data.requirements, data.teams, data.now);
  const pendingArchiveCount = pendingArchiveTeams.reduce((sum, item) => sum + item.count, 0);
  const alertNote = (r: (typeof alerts)[number]) => [r.blocked ? `卡点：${r.blockReason}` : "", isAnyOverdue(r, data.now) ? `逾期 ${daysOverdue(r.expectedDate!, data.now)} 天 · 优先级：${PRIORITY_LABELS[r.priority]}（期望上线/完成 ${r.expectedDate}）` : ""].filter(Boolean).join("；");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (credentialState !== "ready") return;
    try {
      // Unchanged credentials are sent as blank so another administrator's
      // newer values are not silently overwritten by a stale form.
      await mutate("saveNotifications", {
        enabled, time,
        webhook: webhook === savedCredentials.webhook ? "" : webhook,
        signingSecret: signingSecret === savedCredentials.signingSecret ? "" : signingSecret,
        clearSigningSecret, appUrl: appUrl || window.location.origin,
      }, "通知配置已保存");
      setClearSigningSecret(false);
      // The server retains existing credentials for blank fields. Reload after
      // saving so the form always reflects the values actually stored.
      reloadCredentials();
    } catch { /* 保留表单，便于修正。 */ }
  };
  const send = async () => { try { await mutate("sendNotification"); } catch {} };

  return <>
    <PageHeading title="通知设置" subtitle="重要的异常，主动送达。让关注发生在问题变大之前。" actions={<button className="button primary desktop-edit" type="submit" form="notification-form" disabled={busy || credentialState !== "ready"}>{busy ? <Spinner /> : <Save size={16} />}保存配置</button>} />
    <div className="settings-layout notifications-layout">
      <div>
        <form id="notification-form" className="card notification-config" onSubmit={save} aria-busy={credentialState === "loading"}>
          <div className="table-card-heading">
            <div className="notification-channel-heading"><span className="dingtalk-icon"><Send size={20} fill="currentColor" strokeWidth={1.2} /></span><div><h2>钉钉群机器人</h2><p>每天一条摘要，关键异常不遗漏</p></div></div>
            <Badge tone={data.settings.hasWebhook ? "green" : "neutral"}>{data.settings.hasWebhook ? <><Check size={11} />已配置</> : "待连接"}</Badge>
          </div>
          <div className="notification-form-body">
            <div className="notification-toggle-row"><div><strong>每日异常摘要</strong><p>自动汇总卡点清单、全部逾期需求与各团队历史待归档数量</p></div><button className={`toggle desktop-edit ${enabled ? "on" : ""}`} type="button" role="switch" aria-checked={enabled} aria-label="启用每日自动推送" disabled={!scheduledDigestAvailable} title={!scheduledDigestAvailable ? "Vercel 部署暂未配置定时任务；目前仅支持手动测试发送" : undefined} onClick={() => setEnabled(!enabled)}><span /></button></div>
            {credentialState === "loading" && <div className="notification-credential-status" role="status"><Spinner />正在加载已保存的机器人配置…</div>}
            {credentialState === "error" && <div className="notification-credential-error" role="alert">{credentialError}<button className="text-button" type="button" onClick={reloadCredentials}>重新加载</button></div>}
            <div className="form-stack">
              <div className="form-field"><label htmlFor="notify-time">每日推送时间</label><div className="time-input-row"><TimePicker id="notify-time" value={time} onChange={setTime} placeholder="选择时间" ariaLabel="每日推送时间" /><span>北京时间 · UTC+8</span></div></div>
              <div className="form-field">
                <label htmlFor="notify-webhook">机器人 Webhook <a href="https://open.dingtalk.com/document/robots/custom-robot-access" target="_blank" rel="noreferrer">如何获取<ExternalLink size={11} /></a></label>
                <div className="secret-input"><input id="notify-webhook" type={showWebhook ? "text" : "password"} autoComplete="off" value={webhook} onChange={e => setWebhook(e.target.value)} disabled={credentialState !== "ready"} placeholder={data.settings.hasWebhook ? "留空保持现有配置" : "https://oapi.dingtalk.com/robot/send?access_token=…"} /><button className="icon-button" type="button" disabled={credentialState !== "ready"} onClick={() => setShowWebhook(!showWebhook)} aria-label={showWebhook ? "隐藏 Webhook" : "显示 Webhook"}>{showWebhook ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                <small className="field-help">仅空间管理员可查看，默认隐藏；留空保存时保留原有地址。</small>
              </div>
              <div className="form-field">
                <label htmlFor="notify-secret">加签密钥<span>选填</span></label>
                <div className="secret-input"><input id="notify-secret" type={showSecret ? "text" : "password"} autoComplete="new-password" value={signingSecret} onChange={e => setSigningSecret(e.target.value)} disabled={credentialState !== "ready" || clearSigningSecret} placeholder={data.settings.hasSigningSecret ? "留空保持原有密钥" : "若机器人启用加签，请填写 SEC 开头的密钥"} /><button className="icon-button" type="button" disabled={credentialState !== "ready" || clearSigningSecret} onClick={() => setShowSecret(!showSecret)} aria-label={showSecret ? "隐藏加签密钥" : "显示加签密钥"}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                {data.settings.hasSigningSecret && <label className="inline-checkbox"><input type="checkbox" checked={clearSigningSecret} disabled={credentialState !== "ready"} onChange={e => setClearSigningSecret(e.target.checked)} />移除原有加签密钥</label>}
                <small className="field-help">仅空间管理员可查看；留空保留密钥，勾选上方选项可移除。使用自定义关键词时请在钉钉中添加「Horus」。</small>
              </div>
              <div className="form-field"><label htmlFor="notify-url">系统访问链接</label><div className="input-with-icon"><Link2 size={15} /><input id="notify-url" type="url" value={appUrl} onChange={e => setAppUrl(e.target.value)} placeholder="留空时使用当前系统访问地址" /></div><small className="field-help">将作为摘要底部的「打开 Horus 工作台」链接。</small></div>
            </div>
            <div className="notification-test-row"><span><ShieldCheck size={14} />仅发送异常与历史待归档计数，不推送全部需求</span><button className="button small desktop-edit" type="button" disabled={busy || !data.settings.hasWebhook} title={!data.settings.hasWebhook ? "请先填写并保存 Webhook" : "使用已保存的配置发送"} onClick={send}><Send size={14} />立即发送测试</button></div>
          </div>
        </form>
        <div className="settings-tip notification-retry-note"><Info size={16} /><p>{scheduledDigestAvailable ? "推送失败会记录日志，并在次日将未送达内容合并重试。自托管部署需保持应用在线，内置调度每分钟检查一次。" : "当前 Vercel 部署未配置定时任务，因此每日自动摘要已关闭；手动测试发送仍可用。"}</p></div>
      </div>
      <aside className="notification-preview-column">
        <div className="preview-label"><Eye size={15} />消息预览<span>Markdown</span></div>
        <div className="notification-preview"><div className="preview-bot-header"><span className="dingtalk-icon"><Bell size={19} /></span><div><strong>Horus 研发助手</strong><span>机器人</span><p>每天 {time} · 异常摘要</p></div></div><div className="preview-message"><h3>Horus 每日异常摘要</h3><span className="preview-date">{todayString(data.now).replaceAll("-", ".")}</span><div className="preview-callout">{blocked.length} 项卡点 · {overdue.length} 项逾期{pendingArchiveCount > 0 ? ` · ${pendingArchiveCount} 项历史待归档` : ""}</div>{alerts.length ? alerts.slice(0, 3).map(r => <div className="preview-alert" key={r.id}><strong>{r.title}</strong><p>{alertNote(r)}</p><span>{data.teams.find(t => t.id === r.teamId)?.name} · {r.owner || "未指定负责人"}</span></div>) : <p className="preview-all-good">所有需求有序推进，暂无卡点或逾期。</p>}{alerts.length > 3 && <p className="preview-more">另有 {alerts.length - 3} 项异常，将一并包含在摘要中</p>}{pendingArchiveCount > 0 && <div className="preview-archive-summary"><strong>历史待归档：</strong><span>{pendingArchiveTeams.map(item => `${item.name} ${item.count} 项`).join(" · ")}</span></div>}<Link href="/" className="preview-workspace-link">打开 Horus 工作台<ArrowUpRight size={14} /></Link></div><p className="preview-footer">这是实时数据预览，不代表已发送</p></div>
        <div className="settings-help-card notification-help"><h3>只在需要时，提醒你</h3><p>一条消息看清团队的卡点、逾期风险与历史待归档数量，不把群聊变成需求流水账。</p><div className="notification-rule-chips"><Badge tone="orange">卡点清单</Badge><span>+</span><Badge tone="red">全部逾期</Badge><span>+</span><Badge tone="amber">历史待归档计数</Badge></div></div>
      </aside>
    </div>
    <section className="card delivery-log"><div className="table-card-heading"><h2>推送记录<span className="small-label">最近 20 次</span></h2>{data.settings.pendingCount > 0 && <Badge tone="neutral">{data.settings.pendingCount} 项待合并重试</Badge>}</div>{data.logs.length ? <div className="management-table-scroll"><table className="management-table"><thead><tr><th>推送时间</th><th>状态</th><th>摘要</th><th>备注</th></tr></thead><tbody>{data.logs.map(log => <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</td><td><Badge tone={log.status === "success" ? "green" : "neutral"}>{log.status === "success" ? "已送达" : "待重试"}</Badge></td><td>{log.summary}</td><td className="subtle">{log.error || "机器人已确认接收"}</td></tr>)}</tbody></table></div> : <EmptyState title="还没有推送记录" description="保存机器人配置并发送一次测试，记录将显示在这里。" />}</section>
  </>;
}
