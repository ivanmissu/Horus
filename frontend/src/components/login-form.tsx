"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleAlert, Layers3, ShieldCheck } from "lucide-react";
import { Badge, HorusLogo, Spinner } from "./ui";
import { embeddedAuthHeaders, EMBEDDED_SESSION_KEY } from "@/lib/embedded-session";

export function LoginForm({ demoAllowed, previewOnly = false, embeddedPreview = false }: { demoAllowed: boolean; previewOnly?: boolean; embeddedPreview?: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [identity, setIdentity] = useState<{ name: string; firstLogin: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (identity?.firstLogin && password !== confirm) { setError("两次输入的密码不一致，请重新确认"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: identity ? "login" : "identify", username, password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!identity) { setIdentity(result); return; }
      if (embeddedPreview) {
        if (typeof result.previewToken !== "string" || !/^[0-9a-f]{64}$/.test(result.previewToken)) {
          throw new Error("预览会话未创建，请稍后重试");
        }
        sessionStorage.setItem(EMBEDDED_SESSION_KEY, result.previewToken);
      }
      const workspace = await fetch("/api/workspace", {
        credentials: "include", cache: "no-store",
        headers: embeddedPreview ? embeddedAuthHeaders() : {},
      });
      if (!workspace.ok) {
        if (workspace.status === 401) throw new Error("密码已验证，但登录会话未生效，请重试。");
        throw new Error("登录已完成，但工作台加载失败，请联系管理员检查服务日志和数据库初始化。");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "暂时无法连接，请稍后重试");
      return;
    } finally { setBusy(false); }
    // Navigate only after the login response sets its HttpOnly session cookie.
    // Keep navigation outside the request error handler so navigation failures
    // cannot be mistaken for an invalid account or password.
    window.location.replace("/");
  };
  return <main className="login-page"><section className="login-visual"><HorusLogo /><div className="login-orbit" /><span className="login-eyebrow">CLARITY AT EVERY MILESTONE</span><h1>每一个节点，<br /><span>都在你的视线里。</span></h1><p>少一点追问，多一点掌控。<br />用清晰的里程碑，连接团队的每一次进展。</p><div className="login-milestone-card"><div><span><Layers3 size={13} style={{ display: "inline", marginRight: 5 }} />基础平台组</span><Badge tone="blue">稳步推进</Badge></div><strong>统一身份认证 SSO 接入</strong><div className="login-mini-track"><span><i><Check size={10} /></i>需求评审</span><ChevronRight size={12} /><span><i><Check size={10} /></i>技术方案</span><ChevronRight size={12} /><span><i>3</i>开发完成</span><ChevronRight size={12} /><span><i>4</i>正式上线</span></div></div><span className="login-visual-footer">HORUS · 轻量研发掌控</span></section><section className="login-form-side"><div className="login-card"><HorusLogo />{identity && <button className="login-back" onClick={() => { setIdentity(null); setPassword(""); setConfirm(""); setError(""); }}><ArrowLeft size={13} />使用其他账号</button>}<h2>{identity ? identity.firstLogin ? "从设置密码开始" : `你好，${identity.name}` : "欢迎来到 Horus"}</h2><p className="login-subtitle">{identity ? identity.firstLogin ? `${identity.name}，这是你的首次登录。设置一个安全密码，开启清晰协作。` : "输入你的密码，继续掌握团队的每一步进展。" : "登录你的工作空间，让关键进展一目了然。"}</p>{previewOnly && <div className="login-demo"><p>当前为无数据库只读预览，账号登录和保存操作不可用。</p><Link href="/">直接浏览工作台<ArrowRight size={13} /></Link></div>}{!previewOnly && <form className="form-stack" onSubmit={submit}><div className="form-field"><label htmlFor="login-username">登录账号</label><input id="login-username" autoComplete="username" required maxLength={32} value={username} disabled={!!identity} onChange={e => setUsername(e.target.value)} placeholder="请输入负责人为你创建的账号" /></div>{identity && <><div className="form-field"><label htmlFor="login-password">{identity.firstLogin ? "设置密码" : "登录密码"}</label><input id="login-password" autoFocus type="password" autoComplete={identity.firstLogin ? "new-password" : "current-password"} required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入 8–72 位密码" /></div>{identity.firstLogin && <div className="form-field"><label htmlFor="login-confirm">确认密码</label><input id="login-confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入密码" /></div>}</>}{error && <div className="login-error" role="alert"><CircleAlert size={15} />{error}</div>}<button className="button primary login-submit" disabled={busy} type="submit">{busy ? <Spinner /> : <>{identity ? identity.firstLogin ? "设置密码并进入工作台" : "进入工作台" : "继续"}<ArrowRight size={16} /></>}</button></form>}{demoAllowed && !previewOnly && <div className="login-demo"><p>这是可交互的产品演示。可选择下方预建账号体验首次登录，也可以直接浏览演示空间。</p><div className="demo-account-buttons"><button onClick={() => { setIdentity(null); setUsername("chen"); setError(""); }}>团队负责人 · chen</button><button onClick={() => { setIdentity(null); setUsername("lin"); setError(""); }}>产品经理 · lin</button></div><Link href="/">先看看演示工作台<ArrowRight size={13} /></Link></div>}{embeddedPreview && <div className="login-demo"><p>此沙箱的内嵌预览使用仅保存在当前标签页的临时会话。关闭标签页后需要重新登录；正式部署仍使用 HttpOnly Cookie。</p></div>}<div className="login-security"><ShieldCheck size={13} />账号由负责人预建 · 密码安全哈希存储</div></div></section></main>;
}
