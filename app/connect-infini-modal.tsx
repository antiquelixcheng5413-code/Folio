"use client";

import { useState } from "react";

type Language = "zh" | "en";
export type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  user: {
    id: string;
    email?: string | null;
    username?: string | null;
    nickname?: string | null;
    avatar?: string | null;
    phone?: string | null;
  } | null;
};

export function ConnectInfiniModal({
  language,
  status,
  onClose,
  onChanged,
}: {
  language: Language;
  status: AuthStatus;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const userName = status.user?.nickname || status.user?.email || status.user?.username || "InfiniSynapse 用户";

  const logout = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(language === "zh" ? "退出失败，请重试" : "Could not sign out.");
      await onChanged();
      onClose();
      window.location.assign("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal connect-infini-modal" role="dialog" aria-modal="true" aria-labelledby="connect-infini-title">
        <div className="modal-head">
          <div>
            <span className="eyebrow">{status.authenticated ? "PEEK ACCOUNT" : "OPTIONAL SIGN IN"}</span>
            <h2 id="connect-infini-title">
              {status.authenticated
                ? (language === "zh" ? "你的 Peek 账号" : "Your Peek account")
                : (language === "zh" ? "登录 Peek" : "Sign in to Peek")}
            </h2>
            <p>
              {status.authenticated
                ? (language === "zh" ? "学习记录已与 InfiniSynapse 身份绑定。换设备登录后仍可回到自己的空间。" : "Your learning records are linked to your InfiniSynapse identity and available across devices.")
                : (language === "zh" ? "登录是可选的。你可以继续以访客身份使用，也可以通过 InfiniSynapse 的邮箱、手机号或扫码登录来同步学习记录。" : "Sign-in is optional. Continue as a guest, or use InfiniSynapse email, phone, or QR sign-in to sync your learning records.")}
            </p>
          </div>
          <button className="close-button" onClick={onClose} aria-label={language === "zh" ? "关闭" : "Close"}>×</button>
        </div>

        {status.authenticated ? (
          <div className="signed-in-account">
            {status.user?.avatar
              ? <img src={status.user.avatar} alt="" referrerPolicy="no-referrer" />
              : <span className="account-avatar">{userName.slice(0, 1).toUpperCase()}</span>}
            <div><strong>{userName}</strong><small>{status.user?.email || (language === "zh" ? "已通过 InfiniSynapse 登录" : "Signed in with InfiniSynapse")}</small></div>
          </div>
        ) : (
          <div className="login-choice-list">
            <div><span>✓</span><p>{language === "zh" ? "访客模式无需注册，当前浏览器内的数据照常保存。" : "Guest mode needs no registration and keeps working in this browser."}</p></div>
            <div><span>✓</span><p>{language === "zh" ? "登录后绑定现有学习记录，不会清空你刚刚分析的内容。" : "Signing in links your existing learning records without clearing recent analyses."}</p></div>
            <div><span>✓</span><p>{language === "zh" ? "密码只在 InfiniSynapse 官方页面输入，Peek 不接触或保存密码。" : "Credentials are entered only on the official InfiniSynapse page; Peek never handles passwords."}</p></div>
          </div>
        )}

        {!status.configured && !status.authenticated && (
          <div className="auth-not-configured">
            {language === "zh" ? "登录暂时不可用，你仍然可以继续以访客身份使用全部核心功能。" : "Sign-in is temporarily unavailable. You can still use all core features as a guest."}
          </div>
        )}
        {error && <div className="error-box">{error}</div>}

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>
            {status.authenticated
              ? (language === "zh" ? "完成" : "Done")
              : (language === "zh" ? "以访客身份继续" : "Continue as guest")}
          </button>
          {status.authenticated
            ? <button className="outline-button" disabled={busy} onClick={logout}>{language === "zh" ? "退出登录" : "Sign out"}</button>
            : <button className="primary-button" disabled={!status.configured || busy} onClick={() => window.location.assign("/api/auth/infini/start")}>
                {language === "zh" ? "使用 InfiniSynapse 登录" : "Continue with InfiniSynapse"} →
              </button>}
        </div>
      </section>
    </div>
  );
}
