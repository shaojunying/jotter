# Jotter

一个轻量的 Markdown 记事本（Windows）。外壳用 .NET 10 WPF，编辑器是 WebView2 里的 CodeMirror 6，配色照 VS Code 默认的 Dark Modern。

## 功能

- 多标签、多窗口（Ctrl+Shift+N），标签可以拖动排序
- Markdown 高亮，右侧实时预览（Ctrl+\ 开关），预览跟着编辑区滚动，可以显示本地图片
- 查找 / 替换、多光标、Ctrl+B / Ctrl+I / Ctrl+K
- 关闭后不丢内容：关闭最后一个窗口时，没保存的文字会存进会话，下次打开时恢复
- 保留文件原来的编码（UTF-8 / UTF-8 BOM / UTF-16 / GBK）和换行符（CRLF / LF），状态栏里可以改
- 文件在外部被修改时：没有未保存修改就自动重新加载；有未保存修改时，会提示你选择保留哪个版本
- 单实例：再次打开文件（双击、"打开方式"）会作为新标签加到已经打开的窗口里

快捷键一览在右上角 `⋯` 菜单里。

## 安装 / 更新 / 卸载

需要 Windows 10/11、.NET 10 SDK、Node.js 和 WebView2 运行时（Windows 11 自带）。在仓库根目录运行：

```powershell
pwsh -File .\install.ps1
```

装在 `%LOCALAPPDATA%\Programs\Jotter`，开始菜单里搜 "Jotter" 就能打开；右键 `.md` 文件 > 打开方式 也能选它。卸载：`install.ps1 -Uninstall`。数据（会话、设置、日志）在 `%LOCALAPPDATA%\Jotter`。

## 开发

```
web/              编辑器界面（CodeMirror 6 + markdown-it），node build.mjs 打包到 src/Jotter/wwwroot
src/Jotter/       WPF 外壳：窗口、文件读写和编码、会话存储、单实例
tools/            图标生成、测试用的 CDP 驱动脚本
```

- 构建：`cd web; node build.mjs`，然后 `dotnet build src/Jotter`
- 只改界面时，可以直接用浏览器打开 `src/Jotter/wwwroot/index.html`（用本地 http 服务器打开），没有外壳时会用内置的假数据跑
- 端到端测试：`tools/run-test-instance.ps1` 启动调试版本，使用独立的数据目录，并打开调试端口。
  - 用 `node tools/cdp.mjs 9333 eval|type|key|shot ...` 驱动它。
  - 用 `tools/win.ps1` 关闭或激活窗口。
