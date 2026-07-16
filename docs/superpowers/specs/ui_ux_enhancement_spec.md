# 轻灵项目 UI/UX 美化与交互流畅性提升设计规范 (Design Spec)

轻灵（qling）作为本地优先的中文 AI Agent 工作台，其设计原则是“透明、可控、白盒化”。然而，原有的 Web 观测台（Dashboard）和终端交互（TUI）在视觉精度、微交互和“科技质感”上还有很大的提升空间。

为了提升轻灵的用户感官与使用体验，本规范结合了 GitHub 和 X 上最优秀的 Agent 交互案例（如 Claude Code, Aider, Linear, Bolt.new），为轻灵量身定制了一套**高辨识度、极度流畅、充满科技温度**的 UI/UX 升级方案。

---

## 1. 调研与优秀案例借鉴

通过对 Aider, Claude Code, Linear 等工具的交互调研，我们总结出以下优秀设计要点：

*   **视觉溢价感（Premium Aesthetics）**：使用深沉的暗色背景（如深绿墨色、深蓝黑），结合极细的半透明边框（`rgba` / `color-mix`）和微弱的背景模糊（`backdrop-filter: blur`），能营造出极其精美的“磨砂玻璃”质感。
*   **动感与气场（Micro-Animations & Liveness）**：
    *   **呼吸灯指示**：运行状态应以带有渐变阴影扩散（Pulse Shadow）的呼吸灯呈现，而非死板的色块。
    *   **平滑过渡**：不管是任务列表的 Hover 态、详情面板（Drawer/Pane）的滑入，还是按钮点击，都需要有优雅的贝塞尔曲线过渡（如 `cubic-bezier(0.22, 1, 0.36, 1)`）。
*   **日志白盒化（Timeline Visualization）**：工具执行（Tool Calls）不应该是冰冷的纯文本。应设计为具有卡片感、不同类型（文件读写、Bash 执行、网络抓取）配有精致的 Unicode 图标或彩色徽章（Badge）的 Timeline 步骤条。
*   **终端呼吸感（TUI Spinner & Polish）**：
    *   在 TUI 等待期间，单调的文字会被实时刷新的**动态菊花（Spinner）**所取代，给人以“Agent 正在高频思考和运转”的视觉体感。
    *   通过对不同事件类型的 ANSI 颜色和结构化卡片排版微调，让 TUI 输出错落有致。

---

## 2. 核心设计体系 (Design System Tokens)

我们将对 `src/dashboard/page.ts` 中的 CSS 变量进行扩展和重做，注入一套具有“竹影墨意”和“极客科技”双重韵味的色彩与字体系统。

### 2.1 CSS 变量升级
```css
:root {
  /* 基础墨色体系 - 更具深度与质感 */
  --ground: #060b09;      /* 极深竹墨底色 */
  --surface: rgba(17, 24, 21, 0.7); /* 磨砂玻璃层，支持毛玻璃效果 */
  --raised: rgba(26, 38, 33, 0.8);  /* 浮起卡片 */
  --line: rgba(99, 213, 162, 0.12); /* 极细竹青边框线 */
  --line-strong: rgba(99, 213, 162, 0.25); /* 强对比线 */
  
  /* 霓虹与强调色 */
  --accent: #4ade80;      /* 鲜艳翠绿 */
  --accent-gradient: linear-gradient(135deg, #63d5a2 0%, #4ade80 50%, #22c55e 100%);
  --glow-shadow: 0 0 16px rgba(74, 222, 128, 0.18);

  /* 状态指示色 */
  --running: #4ade80;
  --queued: #facc15;
  --blocked: #fb923c;
  --failed: #f87171;
  --paused: #60a5fa;
  --radius: 6px; /* 更圆润的角 */
}
```

### 2.2 字体升级 (Typography)
*   **界面无衬线字体**：优先使用 `Outfit`, `Inter`, `Segoe UI`, `PingFang SC`。
*   **代码等宽字体**：优先使用 `JetBrains Mono`, `Cascadia Code`, `Fira Code`。

---

## 3. Web Dashboard 美化与交互重构

### 3.1 磨砂玻璃 (Glassmorphism) 与悬浮感
- **顶部 Bar 和卡片**：开启 `backdrop-filter: blur(12px)`，赋予界面空间通透感。
- **任务行 (`.task-row`)**：
  - 取消生硬的黑白切换。Hover 时平滑向上微动 `transform: translateY(-2px)`，并加微弱的发光投影 `box-shadow`。
  - 选中状态 (`.selected`)：不再使用生硬的外框，而是采用左侧标志条亮起与轻微的背景翠绿辉光。

### 3.2 动态呼吸灯与渐变
- **运行时状态指示器 (`.signal`)**：
  - 增加 `@keyframes pulse` 动画，当状态为 `ready` 时，其外部阴影以 `2s` 周期向外淡入淡出扩散。
- **骨架屏 (`.skeleton`)**：
  - 将横向硬扫光改为基于 Opacity 渐变的“柔和呼吸淡入淡出”，降低用户的焦虑感。

### 3.3 交互式时间线 (Step Timeline)
- 重新编排 `.event-log`。每一个事件都是一个 Timeline Node。
- 用一条淡绿的垂直中轴虚线串联所有事件。
- 工具执行节点根据种类自动区分徽章颜色与图标：
  - 📂 **文件读写** (如 `view_file`, `write_to_file`)：青蓝色徽章
  - 💻 **执行命令** (如 `run_command`)：紫色徽章
  - 🔍 **搜索抓取** (如 `grep_search`, `browser_fetch`)：翠绿色徽章
  - ⚠️ **异常/报错**：淡红色徽章

---

## 4. TUI 终端交互体验提升

### 4.1 动态 TUI Spinner (旋转菊花)
在 `src/tui/progress.ts` 和 `streaming-tui.ts` 中引入一个定时刷新帧的 `Spinner`。
*   **帧动画序列**：`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`
*   **体感刷新**：利用 `setInterval` 保持在底栏状态行或者进度行每 `80ms` 刷新一次。当 Agent 执行工具或思考时，不再只是静态的一行字，而是旋转的菊花，提供流畅的机器运转暗示。

### 4.2 统一且精致的 CLI 日志输出
*   工具调用前：打印 `◌ [Tool Start] <tool_name>` (暗灰色背景 card，配有精致边框线)。
*   工具成功时：打印 `✓ [Tool Success] <tool_name> (<duration>)` (亮绿色图标)。
*   思考与自我修正：思考部分增加精致的前缀指示符 `✦ [Thinking]`，并对大块的 Markdown 使用更平滑的换行与边框包装。

---

## 5. 变更文件清单

*   [MODIFY] [src/dashboard/page.ts](file:///C:/Users/Lenovo/projects/qling/src/dashboard/page.ts) - 更新 HTML 结构与全面重做 CSS 变量和规则。
*   [MODIFY] [src/dashboard/client.ts](file:///C:/Users/Lenovo/projects/qling/src/dashboard/client.ts) - 调整详情面板渲染与时间线 Badge HTML 插入。
*   [MODIFY] [src/tui/progress.ts](file:///C:/Users/Lenovo/projects/qling/src/tui/progress.ts) - 增加 `Spinner` 帧序列与格式化更新。
*   [MODIFY] [src/tui/streaming-tui.ts](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts) - 引入运行时 Spinner 定时绘制逻辑与终端色彩输出微调。
