import { useEffect, useState } from "react";
import { SendPage } from "./pages/SendPage.tsx";
import { ReceivePage } from "./pages/ReceivePage.tsx";
import { ProductSendPage } from "./pages/ProductSendPage.tsx";
import { ProductReceivePage } from "./pages/ProductReceivePage.tsx";
import { Radio, Camera, FlaskConical, Download } from "lucide-react";

// 路由分层（hash 路由：静态托管零 404 配置）：
// - /#/ 与 /#/receive 为【产品链路】：真实文件 → 真实 cellPx 密度 → 拍摄解码 → 还原文件
// - /#/test 与 /#/test/receive 为【实测脚手架】：8 张固定测试图案 + 离线回归，互不干扰
type Route = "product" | "product-receive" | "test-send" | "test-receive";

function currentRoute(): Route {
  const h = window.location.hash;
  if (h.startsWith("#/test/receive")) return "test-receive";
  if (h.startsWith("#/test")) return "test-send";
  if (h.startsWith("#/receive")) return "product-receive";
  return "product";
}

const HASH_OF: Record<Route, string> = {
  product: "#/",
  "product-receive": "#/receive",
  "test-send": "#/test",
  "test-receive": "#/test/receive"
};

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute());

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (to: Route) => {
    window.location.hash = HASH_OF[to];
    setRoute(to);
  };

  return (
    <div className="flex h-full flex-col bg-ink-900 text-gray-200">
      <header className="flex items-center gap-3 border-b border-ink-700 bg-ink-800 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Radio size={18} />
        </div>
        <div className="font-semibold text-gray-100">ColorTransfer · opti-link</div>
        <span className="hidden rounded-md bg-ink-700 px-2 py-0.5 text-xs text-gray-400 sm:inline">
          产品 /#/ · 实测 /#/test/*
        </span>
        <nav className="ml-auto flex flex-wrap gap-2">
          <TabButton active={route === "product"} onClick={() => navigate("product")} icon={<Radio size={14} />} label="产品·发送" />
          <TabButton
            active={route === "product-receive"}
            onClick={() => navigate("product-receive")}
            icon={<Download size={14} />}
            label="产品·接收"
          />
          <TabButton active={route === "test-send"} onClick={() => navigate("test-send")} icon={<FlaskConical size={14} />} label="实测·发送" />
          <TabButton active={route === "test-receive"} onClick={() => navigate("test-receive")} icon={<Camera size={14} />} label="实测·接收" />
        </nav>
      </header>
      <main className="flex-1 overflow-auto p-4">
        {route === "product" ? (
          <ProductSendPage />
        ) : route === "product-receive" ? (
          <ProductReceivePage />
        ) : route === "test-send" ? (
          <SendPage />
        ) : (
          <ReceivePage />
        )}
      </main>
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
