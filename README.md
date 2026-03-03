# XbookmarkEx

自动批量导出 X（Twitter）书签，保存为 Obsidian Markdown 格式，支持图片/视频下载和 AI 自动分类归档。

## 特性

- ✅ 完全免费（使用浏览器 Cookie，无需官方 API）
- ✅ 增量导出（只导出新增书签）
- ✅ AI 自动分类（Gemini 1.5 Flash）
- ✅ 下载图片和视频
- ✅ Obsidian 兼容 Markdown（`![[图片]]` 语法）

## 安装

```bash
# 1. 克隆 / 下载项目
cd XbookmarkEx

# 2. 安装依赖
npm install
```

## 配置

编辑 `config.json`：

```json
{
  "twitter": {
    "auth_token": "your_auth_token",
    "ct0": "your_ct0_token"
  },
  "gemini": {
    "api_key": "your_gemini_api_key"
  },
  "output": {
    "vault_path": "G:/ObsidianVault/Bookmarks",
    "attachments_folder": "attachments"
  }
}
```

### 如何获取 Twitter Cookie

1. 打开 [x.com](https://x.com) 并登录
2. 按 `F12` 打开开发者工具
3. 切换到 **Application**（应用程序）选项卡
4. 左侧展开 **Cookies** → `https://x.com`
5. 找到并复制：
   - `auth_token` 的值 → 填入 `twitter.auth_token`
   - `ct0` 的值 → 填入 `twitter.ct0`

> ⚠️ 请妥善保管 Cookie，不要分享给他人。

### 如何获取 Gemini API Key

1. 访问 [Google AI Studio](https://aistudio.google.com/app/apikey)
2. 点击 **Create API Key**
3. 复制 Key 填入 `gemini.api_key`

> Gemini 1.5 Flash 有免费额度，每天 1500 次请求，满足个人使用。

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
ObsidianVault/Bookmarks/
├── AI与机器学习/
│   ├── 2025-03-01-1234567890.md
│   └── attachments/
│       └── 1234567890-photo-1.jpg
├── 编程与开发/
├── 设计与创意/
├── 科技资讯/
├── 商业与创业/
├── 生活与娱乐/
├── 学习与教育/
├── 其他/
└── .xbookmarkex-state.json   ← 增量状态文件，请勿删除
```

## Markdown 文件格式示例

```markdown
---
id: "1234567890"
author: "@username"
date: 2025-03-01
url: "https://x.com/username/status/1234567890"
category: AI与机器学习
tags: ["AI", "LLM", "工具"]
likes: 234
retweets: 45
media:
  - attachments/1234567890-photo-1.jpg
---

# [@username](https://x.com/username) · 2025-03-01

推文的完整文字内容...

![[1234567890-photo-1.jpg]]

---
[原推链接](https://x.com/username/status/1234567890)
```

## 定期自动运行

### Windows 任务计划程序

1. 打开任务计划程序 → 创建基本任务
2. 触发器：每天/每周
3. 操作：启动程序 → `node`，参数 → `G:\project\XbookmarkEx\src\index.js`，起始于 → `G:\project\XbookmarkEx`

### 命令行手动运行（每次拉一次新书签）

```bash
cd G:\project\XbookmarkEx && npm start
```

## 常见问题

**Q: 提示 "Unexpected API response structure"**
A: Cookie 已过期，请重新从浏览器复制 `auth_token` 和 `ct0`。

**Q: 视频无法下载**
A: 某些受版权保护的视频无法下载，工具会跳过并继续。

**Q: AI 分类不准确**
A: 可以在 `src/ai/classifier.js` 中修改 `CATEGORIES` 数组，自定义分类名称。

**Q: 速度很慢**
A: 使用 `--no-ai` 跳过分类可大幅提速；或 `--no-media` 跳过媒体下载。
