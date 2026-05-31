# 薄荷PDF / Mint PDF

薄荷PDF是一个清爽、免费的 PDF 工具箱，专注于日常文件处理场景。它在浏览器或 Electron 桌面壳中运行，PDF 和图片文件都在本机内存中处理，不需要上传到服务器，也不需要账号、Token 或网络服务。

Mint PDF is a clean, free PDF toolbox for everyday document work. It runs in the browser or an Electron desktop shell, processes PDFs and images locally in memory, and does not require uploads, accounts, tokens, or a remote service.

[中文](#中文) | [English](#english)

## 中文

### 功能

- 图片转 PDF：支持 JPG、PNG，拖拽排序，单张旋转，自定义导出文件名。
- PDF 转图片：将 PDF 每页渲染为 JPG，并打包为 ZIP 下载。
- 压缩 PDF：提供清晰、平衡、最小三档质量设置，适合把扫描件、报名表、合同等压到更易上传的大小。
- 合并 PDF：支持按文件合并，也支持预览每页后按页面拖拽重排再合并。
- 拆分 PDF：预览页面后勾选导出，支持全选、反选、首页、奇数页、偶数页，并可暂存多组页面一次导出多份 PDF。
- 桌面打包：内置 Electron 配置，可打包 Windows 安装版和便携版。

### 纯本地处理

本项目没有后端服务。应用通过浏览器文件选择器或拖拽读取文件，在前端使用 `pdf-lib`、`pdfjs-dist` 和 `JSZip` 完成处理，再通过 `Blob` / Object URL 触发下载。

当前主应用代码没有上传接口调用，也没有 `fetch`、`XMLHttpRequest`、`WebSocket` 或类似网络发送逻辑。Electron 入口开启了 `contextIsolation`、关闭 `nodeIntegration`，并使用 sandbox 模式运行渲染进程。

需要注意：

- 加密、受保护或损坏的 PDF 可能无法读取。
- 超大 PDF 的速度和成功率取决于本机内存、浏览器和 Electron 运行环境。
- 压缩功能会把每页渲染为图片后重新写入 PDF，因此可能丢失可复制文本、表单、链接、批注和矢量细节；它更适合扫描件或图片型 PDF 的体积优化。

### 技术栈

- Vue 3
- TypeScript
- Vite
- pdf-lib
- PDF.js / `pdfjs-dist`
- JSZip
- Electron
- electron-builder

### 本地开发

建议使用较新的 Node.js LTS 版本。

```bash
npm install
npm run dev
```

构建 Web 静态产物：

```bash
npm run build
```

预览构建结果：

```bash
npm run preview
```

### 桌面应用打包

当前 `package.json` 已配置 Windows 打包：

```bash
npm run dist:win
```

只生成未打包目录：

```bash
npm run dist:dir
```

打包输出位于 `release/`。

### 项目结构

```text
src/App.vue              主界面和 PDF 处理流程
src/style.css            界面样式
src/main.ts              Vue 入口
electron/main.cjs        Electron 主进程入口
scripts/inline-dist.mjs  构建后内联 CSS/JS，方便桌面 file:// 加载
public/                  公共静态资源
build/icon.ico           Windows 桌面应用图标
```

### 开源前建议

- 添加 `LICENSE` 文件，并在下方 License 章节同步具体协议。
- 确认是否要发布 `release/`、`dist/`、日志、压缩包等生成产物；通常建议加入 `.gitignore`。
- 如果计划发布到 npm，需要把 `package.json` 中的 `private` 字段调整为合适值。

### License

MIT License. 详见 [LICENSE](./LICENSE)。

## English

### Features

- Images to PDF: supports JPG and PNG input, drag-and-drop ordering, per-image rotation, and custom output names.
- PDF to images: renders every PDF page as JPG and downloads the result as a ZIP archive.
- PDF compression: provides Clear, Balanced, and Small quality modes for scanned documents, forms, contracts, and other upload-size-sensitive files.
- PDF merge: merges by file order, or previews pages and lets you reorder individual pages before export.
- PDF split: previews pages, supports select all, invert, first page, odd pages, even pages, and can stash multiple page groups for multi-file export.
- Desktop packaging: includes Electron configuration for Windows installer and portable builds.

### Local-First Processing

This project has no backend service. Files are loaded through the browser file picker or drag-and-drop, processed in the frontend with `pdf-lib`, `pdfjs-dist`, and `JSZip`, then downloaded through `Blob` / Object URLs.

The main application code currently has no upload API call and no `fetch`, `XMLHttpRequest`, `WebSocket`, or similar network-sending logic. The Electron entry enables `contextIsolation`, disables `nodeIntegration`, and runs the renderer in sandbox mode.

Important notes:

- Encrypted, protected, or damaged PDFs may fail to load.
- Very large PDFs depend on local memory and the browser or Electron runtime.
- Compression rasterizes each page and writes those rendered images into a new PDF. Searchable text, forms, links, annotations, and vector details may be flattened or lost. It is best suited for scanned or image-heavy PDFs.

### Tech Stack

- Vue 3
- TypeScript
- Vite
- pdf-lib
- PDF.js / `pdfjs-dist`
- JSZip
- Electron
- electron-builder

### Development

A recent Node.js LTS version is recommended.

```bash
npm install
npm run dev
```

Build the web assets:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

### Desktop Builds

The current `package.json` includes Windows packaging scripts:

```bash
npm run dist:win
```

Generate the unpacked app directory only:

```bash
npm run dist:dir
```

Build artifacts are written to `release/`.

### Project Structure

```text
src/App.vue              Main UI and PDF workflows
src/style.css            Application styles
src/main.ts              Vue entry
electron/main.cjs        Electron main process
scripts/inline-dist.mjs  Inlines CSS/JS after build for desktop file:// loading
public/                  Public static assets
build/icon.ico           Windows desktop app icon
```

### Before Open Sourcing

- Add a `LICENSE` file and update the License section below.
- Decide whether generated artifacts such as `release/`, `dist/`, logs, and archives should be excluded with `.gitignore`.
- If you plan to publish the package to npm, update the `private` field in `package.json`.

### License

MIT License. See [LICENSE](./LICENSE).
