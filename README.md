# URL Path Recorder

一个面向 Microsoft Edge / Chromium 的轻量 URL 跳转记录工具。

- Web UI：<https://amsasw.github.io/url-set/>
- 扩展：负责浏览器权限、URL 捕获、关联标签页跟踪和本地存储
- Pages：负责展示、筛选、折叠、诊断和导出

## v0.7 主要功能

- 001-100 多任务监控
- 每个任务可自定义名称
- 一个任务可关联主标签页、OAuth/SSO 新标签页和验证弹窗
- 每个任务独立停止、清空、删除和改名
- URL 记录实时显示，并保存在 `chrome.storage.local`
- 连续相同 URL 只在界面折叠，原始记录不会被删除
- 显示相邻记录的毫秒/秒级时间差
- OAuth / login / callback / verify / SSO 地址自动标记“认证”
- 默认导出脱敏 URL，可单独确认后导出原始 URL
- 隐藏式诊断面板显示 Core/Web/API 版本、任务数、关联标签页数等
- Web UI 与扩展 Core 独立版本，网页更新通常无需重新安装扩展

## 目录结构

```text
url-set/
├─ extension/
│  ├─ manifest.json
│  ├─ background.js
│  ├─ bridge.js
│  └─ README.md
├─ web/
│  ├─ index.html
│  ├─ app.js
│  ├─ style.css
│  └─ .nojekyll
└─ .github/workflows/
   ├─ pages.yml
   └─ release-extension.yml
```

## 安装扩展

推荐从仓库 Releases 下载 `URL-Path-Recorder-Edge.zip`。

1. 解压 ZIP。
2. Edge 打开 `edge://extensions/`。
3. 开启“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择解压后的目录（里面应直接看到 `manifest.json`）。
6. 打开 <https://amsasw.github.io/url-set/>。

开发时也可以直接加载仓库里的 `extension/` 目录。

## 使用

1. 选择编号 001-100。
2. 输入可选名称和起始 URL。
3. 点击“开始 / 重新启动”。
4. 该任务会跟踪其主标签页及由它打开的关联 OAuth/验证标签页。
5. 回到 Pages 页面查看实时记录。

停止后的任务再次使用相同编号启动时，会保留之前的记录并创建新的监控标签页。

## 隐私与导出

记录只保存在扩展本地存储中。OAuth URL 可能包含 `code`、`token`、`state` 等敏感参数，因此默认提供“复制脱敏”和“导出脱敏”；导出原始 URL 前会再次确认。

## 发布

- `web/` 由 GitHub Pages workflow 自动部署。
- `extension/` 有变化时会自动构建 `URL-Path-Recorder-Edge.zip`，并更新 `edge-latest` Release。

## 备份

v0.7 全量优化前的主分支已备份到：

`backup-before-v0.7-full-optimization`
