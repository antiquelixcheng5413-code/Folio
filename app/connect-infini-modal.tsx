"use client";

type Language = "zh" | "en";

export function ConnectInfiniModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const openConsole = () => {
    window.open("https://app.infinisynapse.cn/tasks", "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal connect-infini-modal" role="dialog" aria-modal="true" aria-labelledby="connect-infini-title">
        <div className="modal-head"><div><span className="eyebrow">OPTIONAL CONNECTION</span><h2 id="connect-infini-title">{language === "zh" ? "连接 InfiniSynapse" : "Connect InfiniSynapse"}</h2><p>{language === "zh" ? "打开官方控制台以登录、管理 API Key 和查看任务。先鉴 Peek 仍保持匿名使用，不会读取、保存或绑定你的 InfiniSynapse 账号。" : "Open the official console to sign in, manage API keys and inspect tasks. Peek remains anonymous and does not read, store or bind your InfiniSynapse account."}</p></div><button className="close-button" onClick={onClose} aria-label={language === "zh" ? "关闭" : "Close"}>×</button></div>
        <div className="connect-infini-body">
          <div><span>1</span><p>{language === "zh" ? "在官方页面登录或创建 InfiniSynapse 账号。" : "Sign in or create an InfiniSynapse account on the official page."}</p></div>
          <div><span>2</span><p>{language === "zh" ? "在控制台管理 API Key 与查看由先鉴 Peek 发起的任务。" : "Manage API keys and view tasks created by Peek in the console."}</p></div>
          <div><span>3</span><p>{language === "zh" ? "返回先鉴 Peek 后继续匿名使用，无需注册。" : "Return to Peek and continue anonymously without registration."}</p></div>
        </div>
        <div className="modal-footer"><p>{language === "zh" ? "不会授权先鉴 Peek 访问你的账号。" : "Peek will not receive access to your account."}</p><button className="secondary-button" onClick={onClose}>{language === "zh" ? "暂不连接" : "Not now"}</button><button className="primary-button" onClick={openConsole}>{language === "zh" ? "打开官方控制台" : "Open official console"} ↗</button></div>
      </section>
    </div>
  );
}
