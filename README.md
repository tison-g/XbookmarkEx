# XbookmarkEx

自动批量导出 X（Twitter）书签，保存为 Obsidian Markdown 格式，支持图片/视频下载和 AI 自动分类归档。

## 特性

- ✅ 完全免费（使用浏览器 Cookie，无需官方 API）
- ✅ 完美支持长文章（X Articles）——标题、加粗、代码块、文件树、流程图全部无损还原
- ✅ 文章图片嵌入正文中对应位置（不是堆叠在文章末尾）
- ✅ 增量导出（只导出新增书签，防重复）
- ✅ AI 深度分类（Gemini 2.5 Flash REST API）+ 智能文件命名
- ✅ 分享类推文聚合汇总，自动生成分享链接导览文件
- ✅ 每次导出自动生成目录文件（按日期命名）
- ✅ 下载图片和视频到 `attachments/`
- ✅ Obsidian 兼容 Markdown（`![[图片]]` 语法）

## 安装

```bash
# 克隆 / 下载项目后进入目录
cd XbookmarkEx

# 安装依赖
npm install
```

## 配置

编辑 `config.json`：

```json
{
  "twitter": {
    "auth_token": "your_auth_token",
    "ct0": "your_ct0_token",
    "query_id": "VFdMm9iVZxlU6hD86gfW_A"
  },
  "gemini": {
    "api_key": "your_gemini_api_key"
  },
  "fetch": {
    "max_count": 50,
    "date_from": "2025-10-01"
  },
  "output": {
    "vault_path": "./XBookMarks",
    "attachments_folder": "attachments"
  }
}
```

### 核心参数详解

| 参数 | 说明 |
|------|------|
| `twitter.auth_token` | X（Twitter）登录 Cookie，从浏览器 F12 → Application → Cookies 获取 |
| `twitter.ct0` | X（Twitter）CSRF Token，同上获取 |
| `twitter.query_id` | Bookmarks GraphQL Hash，X 更新时可能需要重新抓包替换 |
| `gemini.api_key` | Gemini 2.5 Flash API Key（每天 1500 次免费额度） |
| `fetch.max_count` | 单次拉取书签上限，建议 ≤ 50 以降低触发风控概率 |
| `fetch.date_from` | 只导出此日期之后的书签，格式 `YYYY-MM-DD`（增量模式自动追踪，无需手动改） |
| `fetch.date_to` | 可选，限制导出截止日期，留空表示导出到最新 |
| `output.vault_path` | 导出目录，支持绝对路径（如 `G:/ObsidianVault/Bookmarks`）或相对路径 |

### 如何获取 Twitter Cookie

1. 打开 [x.com](https://x.com) 并登录
2. 按 `F12` 打开开发者工具
3. 切换到 **Application** → **Cookies** → `https://x.com`
4. 找到 `auth_token` 和 `ct0`，复制对应值填入配置

> ⚠️ 请妥善保管 Cookie，不要分享给他人。Cookie 会定期失效，失效后重新复制即可。

### 如何获取 Gemini API Key

1. 访问 [Google AI Studio](https://aistudio.google.com/app/apikey)
2. 点击 **Create API Key**
3. 复制 Key 填入 `gemini.api_key`

> Gemini 2.5 Flash 提供每天 1500 次免费调用额度，本项目使用 REST API 直连，无需额外 SDK。

## 使用

```bash
# 增量导出（只导出新书签，推荐！）
npm start

# 全量重新导出所有书签
npm run export:full

# 跳过媒体下载（速度更快）
node src/index.js --no-media

# 跳过 AI 分类（全部归入"其他"）
node src/index.js --no-ai
```

## 输出结构

```
XBookMarks/
├── AI/
│   ├── ClaudeCode/
│   │   └── 2026-03-08-AI第二大脑搭建-rwayne-280字看懂...md   ← 文章类
│   ├── Openclaw/
│   ├── Agent&Skill/
│   ├── 创意设计/
│   └── 其它AI工具/
├── 个人成长/
├── 科技资讯/
├── 推文/
│   ├── 原创/
│   └── 分享/
│       └── 分享汇总-2026-03-13.md                           ← 每次导出自动生成
├── 其它/
├── attachments/
│   └── 1234567890-photo-1.jpg
├── 导出目录-2026-03-13.md                                   ← 每次导出自动生成
└── .xbookmarkex-state.json                                  ← 增量状态，请勿删除
```

## 分类规则

### 一、有标题的 X 文章（Article）

文件名格式：`日期-内容关键词-作者-文章标题`

**AI 大类**（二级分类）：
- `ClaudeCode` — Claude Code 相关
- `Opencode` — OpenCode / OpenClaw 相关
- `Openclaw` — OpenClaw 相关
- `Agent&Skill` — Agent、Skill 工具方法论
- `创意设计` — AI 设计、生图、视频
- `其它AI工具` — 其他 AI 工具

**其他一级分类**：`个人成长`、`科技资讯`、`股票投资`、`生活娱乐`、`学习教育`、`软件工具`、`其它`

### 二、短推文和无标题长推文

文件名格式视内容而定：
- **原创**（无分享链接）：`日期-一句话总结-作者`
- **分享**（含推荐链接/工具/账号）：`日期-分享主题-作者`

分享类推文会同时聚合写入 `推文/分享/分享汇总-日期.md`，方便集中查看所有分享链接。

## Markdown 文件示例

### 文章类（X Article）

```markdown
---
id: "1234567890"
author: "@username"
name: "作者昵称"
date: 2026-03-08
url: "https://x.com/username/article/1234567890"
type: "article"
category: "AI"
subcategory: "ClaudeCode"
tags: ["Claude", "实战"]
summary: "一句话摘要"
likes: 1024
retweets: 200
media:
  - attachments/1234567890-photo-1.jpg
---

# 文章标题

文章正文……图片嵌入在原文对应位置：

![[1234567890-photo-1.jpg]]

更多正文……

---
[原推链接](https://x.com/username/article/1234567890)
```

### 推文类

```markdown
---
id: "9876543210"
author: "@username"
date: 2026-03-10
url: "https://x.com/username/status/9876543210"
type: "tweet"
category: "科技资讯"
---

# 🐦 [@username](https://x.com/username) · 2026-03-10

推文内容……

---
[原推链接](https://x.com/username/status/9876543210)
```

## 定期自动运行

### Windows 任务计划程序

1. 打开任务计划程序 → 创建基本任务
2. 触发器：每天 / 每周
3. 操作：启动程序 → `node`，参数 → `G:\project\XbookmarkEx\src\index.js`，起始于 → `G:\project\XbookmarkEx`

### 命令行手动运行

```bash
cd G:\project\XbookmarkEx && npm start
```

## 常见问题

**Q: 提示 "Unexpected API response structure"**
A: Cookie 已过期，重新从浏览器复制 `auth_token` 和 `ct0` 填入 `config.json`。

**Q: ⚠ Gemini classification failed: Unterminated string...**
A: Gemini API 偶发 JSON 截断问题，已在代码中增加重试和容错，偶尔出现属正常，系统会自动归入"其他"分类。

**Q: 视频无法下载**
A: 部分受版权保护的视频无法下载，工具会跳过并继续，不影响其他内容。

**Q: AI 分类不准确**
A: 可在 `src/ai/classifier.js` 中修改分类规则和 prompt，调整分类偏好。

**Q: 速度很慢**
A: 使用 `--no-ai` 跳过 AI 分类可大幅提速；`--no-media` 跳过图片/视频下载。

**Q: 文章中的代码块/文件树/流程图丢失**
A: 已在最新版本中修复。FxTwitter API 使用 `MARKDOWN` 类型的 atomic 块存储代码内容，当前版本已正确解析并保留。
