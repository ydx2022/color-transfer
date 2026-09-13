import { useEffect, useState } from "react";
import { SendPage } from "./pages/SendPage.tsx";
import { ReceivePage } from "./pages/ReceivePage.tsx";
import { Radio, Camera, FlaskConical } from "lucide-react";

// 路由分层（hash 路由：静态托管零 404 配置）：
// - 顶层 /#/ 与 /#/receive 预留给「最终产品」（文件编码发送 / 完整解码接收）
// - 实测脚手架统一放在 /#/test 与 /#/test/receive，避免占用产品路由
type Route = "product" | "test-send" | "test-receive";

function currentRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/test/receive")) return "test-receive";
  if (h.startsWith("#/test")) return "test-send";
  return "product";
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute());

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (to: Route) => {
    window.location.hash = to === "test-receive" ? "#/test/receive" : to === "test-send" ? "#/test" : "#/";
    setRoute(to);
  };

  return (
    <div className="flex h-full flex-col bg-ink-900 text-gray-200">
      <header className="flex items-center gap-3 border-b border-ink-700 bg-ink-800 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Radio size={18} />
        </div>
        <div className="font-semibold text-gray-100">ColorTransfer · opti-link</div>
        <span className="rounded-md bg-ink-700 px-2 py-0.5 text-xs text-gray-400">路由分层：/#/ 留产品 · /#/test/* 实测</span>
        <nav className="ml-auto flex gap-2">
          <TabButton active={route === "test-send"} onClick={() => navigate("test-send")} icon={<FlaskConical size={14} />} label="实测·发送" />
          <TabButton active={route === "test-receive"} onClick={() => navigate("test-receive")} icon={<Camera size={14} />} label="实测·接收" />
          <TabButton active={route === "product"} onClick={() => navigate("product")} icon={<Radio size={14} />} label="产品占位" />
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-4">
        {route === "test-send" ? <SendPage /> : route === "test-receive" ? <ReceivePage /> : <ProductPlaceholder onGo={navigate} />}
      </main>
    </div>
  );
}

// 最终产品路由占位：/#/ 与 /#/receive 预留给文件编码发送 / 完整解码接收，未上线前给出明确提示。
function ProductPlaceholder({ onGo }: { onGo: (to: Route) => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
        <Radio size={24} />
      </div>
      <h1 className="text-2xl font-semibold text-gray-100">最终产品路由已预留</h1>
      <p className="text-sm leading-relaxed text-gray-400">
        以下路由为正式产品保留，尚未上线：
      </p>
      <ul className="w-full space-y-2 text-left text-sm">
        <li className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-3">
          <b className="text-gray-100">/#/</b> <span className="text-gray-400">→ 发送端（选择文件 → 分块编码 → 彩色帧播放）</span>
        </li>
        <li className="rounded-lg border border-ink-700 bg-ink-800 px-4 py-3">
          <b className="text-gray-100">/#/receive</b> <span className="text-gray-400">→ 接收端（拍摄 → 锚点定位 → 透视校正 → 解码还原文件）</span>
        </li>
      </ul>
      <p className="text-xs text-gray-500">当前实测版位于独立命名空间，不占用上述产品路由：</p>
      <div className="flex gap-2">
        <button onClick={() => onGo("test-send")} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-600/80">
          <FlaskConical size={14} /> 进入实测·发送
        </button>
        <button onClick={() => onGo("test-receive")} className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-4 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
          <Camera size={14} /> 进入实测·接收
        </button>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
        active ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-700/70"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
