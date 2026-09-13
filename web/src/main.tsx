import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("root 容器缺失");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
