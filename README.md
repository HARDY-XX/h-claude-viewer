# Claude Code Viewer - Claude Code 项目对话历史浏览器

## 项目概述

Claude Code Viewer 是一个基于 Web 的可视化工具，用于浏览和分析 **Claude Code**（Claude 官方 CLI）在各个项目中生成的对话历史记录。

### 核心功能

- **多项目管理**：自动发现并列出所有 Claude Code 项目（根据目录结构）
- **对话浏览**：按项目查看所有历史对话会话
- **消息详情**：查看完整的用户消息、AI 回复、工具调用记录
- **实时刷新**：自动轮询新消息，支持增量追加显示
- **统计分析**：显示 token 使用量（输入、输出、缓存创建、缓存读取）、消息数量、模型使用情况
- **格式化显示**：支持 Markdown 渲染、代码高亮、工具调用折叠显示

## 技术架构

### 前端
- 纯 HTML/CSS/JavaScript 单页应用
- 依赖库：
  - [marked](https://github.com/markedjs/marked) - Markdown 渲染
  - [highlight.js](https://highlightjs.org/) - 代码语法高亮
- 三栏布局设计：
  - 左侧：项目列表
  - 中间：对话会话列表
  - 右侧：消息详情和统计信息

### 后端
- Node.js + Express 框架
- 端口：`3000`
- 无数据库：直接读取本地 `.jsonl` 文件
- 自动解析 Claude Code 生成的对话记录格式

## 数据源

项目会读取 **`C:\Users\38869\.claude\projects`** 目录下的所有子文件夹（排除 `viewer` 和 `memory`），识别包含 `.jsonl` 文件的文件夹作为项目。

### 文件夹命名规则
项目文件夹使用特殊编码格式：
- 例如：`C--Users-38869-Desktop-tmp`
- 编码规则：`[驱动器字母]--[路径，使用 - 替代 / 或 \]`
- 显示时自动解码为可读路径：`C:/Users/38869/Desktop/tmp`

### 数据格式
Claude Code 生成的 `.jsonl`（JSON Lines）文件，每行是一个 JSON 对象，包含：
- `type`: 消息类型（`user`、`assistant`、`system`）
- `timestamp`: ISO 8601 格式的时间戳
- `message`: 消息内容
- `usage`: token 使用统计（AI 回复）
- `tool_use_result`: 工具调用结果

## 安装和使用

### 前置要求

- Node.js >= 14
- npm（Node.js 自带）

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

或直接运行：

```bash
node server.js
```

### 访问界面

启动后，在浏览器中打开：**http://localhost:3000**

## 界面说明

### 项目列表（左侧）
- 显示所有检测到的项目
- 每个项目显示：
  - 项目路径（解码后的可读格式）
  - 对话数量
  - 最后一次对话时间
- 点击项目可加载该项目的所有对话

### 对话列表（中间）
- 显示选定项目的所有对话会话
- 每个会话显示：
  - 用户第一条消息预览（最多 120 字符）
  - 消息总数
  - 最后一条消息时间
- 点击会话可查看详细消息内容

### 详情面板（右侧）
- **统计栏**：显示当前对话的统计信息
  - Input Tokens：输入 token 总数
  - Output Tokens：输出 token 总数
  - Cache Creation：缓存创建 token
  - Cache Read：缓存读取 token
  - 消息总数、User/Assistant 轮次、使用的模型
- **消息列表**：
  - 用户消息（蓝色边框）
  - Assistant 消息（普通背景）
  - System 消息（灰色，透明背景）
  - Sidechain 消息（虚线边框，半透明）
  - 每条消息显示时间、模型、token 使用情况
  - 工具调用以可折叠的详情块显示

## 自动刷新机制

- **项目列表**：每 3 秒自动检查新项目
- **对话列表**：每 3 秒检查当前项目的对话变化
- **消息内容**：每 3 秒增量检查新消息并自动追加（不会重新加载整个对话）

## 开发说明

### 主要文件

- `server.js`：Express 后端服务，提供 3 个 API 接口
  - `GET /api/projects`：获取项目列表
  - `GET /api/projects/:projectId/sessions`：获取指定项目的会话列表
  - `GET /api/sessions/:projectId/:sessionId`：获取会话详情和统计
- `public/index.html`：前端单页应用
- `package.json`：项目配置和依赖

### 关键函数

**后端（server.js）**：
- `decodeFolderName()`：将编码的文件夹名转换为可读路径
- `parseJsonlLine()`：安全解析 JSON 行
- `readJsonlFile()`：读取整个 JSONL 文件
- `getSessionFiles()`：获取项目目录下所有 .jsonl 文件
- `getLatestTimestamp()`：快速获取文件中最后一条记录的时间戳

**前端（index.html）**：
- `loadProjects()`：加载项目列表
- `selectProject()` / `selectSession()`：选择项目/会话
- `renderMessage()`：渲染单条消息（支持文本、工具调用、思考过程）
- `renderContent()`：渲染消息内容（支持字符串、数组块）
- `startMessagesRefresh()`：启动自动刷新机制

## 使用场景

1. **回顾开发历史**：查看之前与 Claude 的对话，找回代码实现思路
2. **分析 token 使用**：监控不同项目、不同任务的 token 消耗情况
3. **调试工具调用**：检查工具调用的输入输出，排查问题
4. **学习最佳实践**：回顾 Claude 生成的代码和解决方案
5. **项目复盘**：统计项目中与 AI 交互的频率和效果

## 注意事项

- 项目会**自动排除** `viewer` 和 `memory` 文件夹
- 只显示包含 `.jsonl` 文件的文件夹作为项目（`sessionCount > 0`）
- 时间显示格式为中文本地化（例如："02/27 14:30"）
- 所有数据仅在本地读取，不会上传到任何外部服务
- 刷新频率固定为 3 秒，避免过于频繁的文件读取

## 依赖版本

```json
{
  "express": "^4.21.0"
}
```

## 许可证

本项目为 Claude Code 内置工具，遵循 Claude Code 的相关许可条款。

---

**项目名称**：claude-code-viewer
**版本**：1.0.0
**作者**：Claude Code
**最后更新**：2026-02-28
