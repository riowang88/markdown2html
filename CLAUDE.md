# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

- 支持自定义样式的 Markdown 编辑器，输出适配微信公众号、知乎、掘金等平台
- 技术栈：React 16 + MobX 5 + markdown-it + CodeMirror + Ant Design 3
- 包管理：npm | 测试：Jest | 构建：Webpack 4 | 桌面端：Electron
- 在线体验：http://md.aizhuanqian.online
- GitHub 镜像：git@github.com:qq148376839/markdown2html.git
- NAS Docker 部署：`riowang@ssh.riowang.win` → `/volume1/docker/markdown2html/`（端口 3100）
- `homepage` 已改为 `"."`，支持任意域名访问

## 常用命令

```bash
npm start              # 开发服务器（端口 3000）
npm run build          # 生产构建（输出 build/）
npm test               # Jest 测试
npm run lint           # ESLint 检查并自动修复
npm run storybook      # Storybook 组件预览（端口 9001）
npm run analyze        # 构建产物体积分析
npm run watch          # 监听 src/ 变化，实时编译到 lib/（npm 发布用）
```

## 架构

### 状态管理（MobX Stores）

所有 UI 状态通过 MobX observable 管理，持久化到 localStorage：

| Store | 路径 | 职责 |
|-------|------|------|
| content | `src/store/content.js` | 文档内容、自定义 CSS、主题列表、CodeMirror 实例引用 |
| navbar | `src/store/navbar.js` | 主题编号、代码高亮主题、Mac 风格开关、预览模式、同步滚动 |
| view | `src/store/view.js` | 编辑区/预览区/样式编辑器可见性、沉浸模式 |
| dialog | `src/store/dialog.js` | 各 Dialog 显隐状态 |
| imageHosting | `src/store/imageHosting.js` | 图床配置（SM.MS/阿里OSS/七牛/Gitee/GitHub） |

### Markdown 处理流水线

`src/utils/helper.js` 定义两条解析管线：

1. **markdownParserWechat** — 微信专用，移除 `<pre><code>` 标签，用 `juice` 内联 CSS
2. **markdownParser** — 标准 HTML5，highlight.js 代码高亮

两条管线共享自定义 markdown-it 插件（均在 `src/utils/markdown-it-*.js`）：
- `markdown-it-math.js`：MathJax 3 公式渲染（SVG 输出）
- `markdown-it-linkfoot.js`：脚注/引用链接
- `markdown-it-span.js`：标题内注入 `<span>` 供样式钩子
- `markdown-it-imageflow.js`：移动端图片自适应
- `markdown-it-removepre.js`：微信专用，移除 pre 标签

### 平台导出

`src/utils/converter.js` + `src/component/Sidebar/` 实现多平台转换：
- 微信：`juice` 内联 CSS → 剪贴板（因微信编辑器不支持 `<style>` 标签）
- 知乎：公式转图片 URL
- 掘金：公式用 CDN URL

### 图床上传

`src/utils/imageHosting.js`（533 行）是适配器工厂，统一封装 5 种云存储 API。各适配器在 `src/component/ImageHosting/`。

### UI 布局

```
App.js（主组件，410 行）
├── Navbar（左侧菜单）→ src/layout/Navbar.js + src/component/MenuLeft/
├── Toolbar（顶部工具栏）→ src/layout/Toolbar.js + src/component/Toolbar/
├── Editor（CodeMirror 编辑区，左半）
├── Preview（HTML 预览区，右半）
├── StyleEditor（自定义 CSS 编辑器，底部可选）→ src/layout/StyleEditor.js
├── Dialog（模态框容器）→ src/layout/Dialog.js + src/component/Dialog/
└── Footer（底部状态栏）→ src/layout/Footer.js
```

### 主题系统

- 21 个内置 Markdown 主题：`src/template/markdown/`（normal.js ~ twentyone.js + custom.js）
- 7 种代码高亮主题：`src/template/code/`
- Mac 风格代码块变体：`src/template/macCode/`
- 主题切换通过 `navbar.templateNum` / `navbar.codeNum` 索引

## 编码标准

- ESLint：extends airbnb + prettier
- Prettier：120 字符行宽、2 空格缩进、双引号、尾逗号
- Babel：装饰器（legacy）+ class properties，React preset
- 命名：组件 PascalCase / 工具函数 camelCase / 常量 UPPER_SNAKE_CASE

## 核心原则

- **先确认，再执行** — 不明确的需求必须先澄清
- **最小变更** — 只做必要改动，不过度工程
- **行动优先** — 运行命令验证，不靠推理下结论

---

## 协调者协议（Coordinator Protocol）

主会话作为**指挥官**调度 agent。以下规则对主会话强制生效：

### 禁止懒委托（模式 1）

研究结果返回后，**必须消化并综合**，给出精确到文件路径和行号的指令。

**禁止短语**：「基于你的发现」「基于研究结果」「修复我们讨论的」「处理之前提到的」「查看相关文件」

### 并发规则（模式 2）

| 任务类型 | 并发策略 |
|---------|---------|
| 只读研究 | **自由并行** |
| 写操作（同文件区域） | **串行** |
| 验证 + 不同区域实现 | **可并行** |

### Worker 指令要求（模式 5）

Agent 看不到主会话对话。每条 prompt 必须自包含：
- 文件路径 + 行号
- 完成标准（"done" 的定义）
- 目的说明
- 验证方式
- 禁止引用对话上下文

---

## 共享行为准则（所有 Agent 必须遵守）

### 自我合理化防护（模式 4）

| 你在想的 | 正确行动 |
|---------|---------|
| "代码看起来正确" | **运行它** |
| "这个要花太久了" | **告知时间，然后做** |
| "先处理简单的部分" | **先做最难的** |
| "这应该不会有问题" | **验证它** |
| "测试通过了" | **检查测试测了什么** |

**终极检测**：正在写解释而不是运行命令 → 停，运行命令。

### 轻量探索（模式 8）

| 场景 | 策略 |
|------|------|
| 不知道位置 | 广搜：Glob + Grep |
| 知道位置 | 精确读：Read 目标文件 |
| 搜不到 | 换策略：换关键词/目录/工具 |
| 多个独立搜索 | 必须并行 |

### 记忆漂移防护（模式 7）

- 引用文件路径 → 确认存在
- 引用函数/变量 → grep 确认
- 描述架构/状态 → 以当前代码为准

**"记忆说 X 存在" ≠ "X 现在存在"。**

---

## auto memory 配置（模式 6 + 7）

记忆目录：`.claude/memory/`

### 记忆类型

| 类型 | 内容 | 保存时机 |
|------|------|---------|
| **user** | 用户画像（角色/偏好/知识水平） | 了解到用户背景时 |
| **feedback** | 行为纠正（该做/不该做） | 用户纠正或确认你的做法时 |
| **project** | 项目状态（进行中工作/截止日期） | 了解到项目动态时 |
| **reference** | 外部指针（在哪找什么信息） | 了解到外部资源时 |

### 绝对不记

- 代码模式/架构 — `grep` 能查到
- Git 历史 — `git log` 能查到
- 调试方案 — 修复在代码里
- 已在 CLAUDE.md 中的内容

### 记忆防护

1. **漂移防护**：行动前验证引用是否仍有效
2. **膨胀检查**：单个记忆文件 > 5KB → 自动瘦身
3. **写入过滤**："6 个月后这条还有用吗？"
