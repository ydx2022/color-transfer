# 部署到 GitHub Pages（免实名 / 免费 / 永久）

本项目是纯前端 + 本地编解码的 PWA，无任何后端依赖，最适合静态托管。
因采用 hash 路由（`#/...`）与相对 `start_url`，部署到 GitHub Pages 子路径也无需服务端 rewrite。

## 自动流程（推荐）
构建与发布全部由 GitHub Actions 在云端完成，本机无需 `npm run build`。

1. 在 GitHub 新建仓库（建议 `color-transfer`，需为 **Public**）。
2. 推送代码：
   ```bash
   cd d:\Project\ColorTransfer
   git init                      # 若尚未初始化
   git add .
   git commit -m "feat: deploy to GitHub Pages"
   git branch -M main
   git remote add origin https://github.com/<用户名>/<仓库名>.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**（仅需设置一次）。
4. 等待 Actions 跑完（几分钟），访问 `https://<用户名>.github.io/<仓库名>/`。

之后每次 `git push` 到 `main` 都会自动重新部署。

## 工作原理
- `web/vite.config.ts` 中 `base: process.env.BASE_PATH || "/"`：Actions 构建时注入 `/<仓库名>/`，本地或其他平台保持 `/`。
- `.github/workflows/deploy.yml`：云端 `npm install` → `npm run build` → 上传 `web/dist` 并发布为 GitHub Pages；`dist/.nojekyll` 防止 Jekyll 处理破坏下划线资源。

## 手动部署（可选）
若不想用 Actions，可在本机构建后用 `gh-pages` 发布：
```bash
cd web
npm install
BASE_PATH=/<仓库名>/ npm run build
npx gh-pages -d dist
```

## 接收端使用
手机浏览器打开上述链接后，用「添加到主屏幕」可将其作为离线 App 安装，契合「接收端零安装」目标。
