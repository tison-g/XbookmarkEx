import axios from 'axios';

// ── Category hierarchy ────────────────────────────────────────────────────────
// AI subcategories live under 'AI/' parent directory
export const AI_SUBCATEGORIES = [
    'ClaudeCode',
    'Opencode',
    'Openclaw',
    'Agent&Skill',
    '创意设计',
    '其它AI工具',
];

// Top-level categories (non-AI)
export const GENERAL_CATEGORIES = [
    '个人成长',
    '科技资讯',
    '股票投资',
    '生活娱乐',
    '学习教育',
    '软件工具',
    '其它',
];

// All valid category values Gemini may return
const ALL_CATEGORIES = ['AI', ...GENERAL_CATEGORIES];

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const CLASSIFICATION_PROMPT = (text, isArticle) => `
You are a precise content classifier for X (Twitter) bookmarks.

## Task
Analyze the tweet below and return a JSON object.

## Return Fields
- "tweet_type": one of "article", "share", "original"
  - "article": long-form content with a clear title/topic (Note Tweet / X Article)
  - "share": the tweet recommends or shares a link, tool, another user, or external resource
  - "original": personal thoughts, commentary, or discussion without sharing external links
${isArticle ? '  NOTE: This tweet is a confirmed X Article, so tweet_type MUST be "article".' : ''}
- "category": one of [${ALL_CATEGORIES.map(c => `"${c}"`).join(', ')}]
  - Use "AI" for any AI/ML/LLM/coding-assistant/prompt-engineering related content
  - Use the most specific general category otherwise
- "ai_sub": (ONLY when category is "AI") one of [${AI_SUBCATEGORIES.map(c => `"${c}"`).join(', ')}]
  - ClaudeCode: Claude Code, Anthropic Claude, Claude artifacts
  - Opencode: OpenAI Codex, GPT coding, ChatGPT coding
  - Openclaw: Openclaw platform or related tools
  - Agent&Skill: AI agents, MCP, skills, automation, workflows
  - 创意设计: AI art, image generation, design tools
  - 其它AI工具: other AI tools not fitting above
- "filename_hint": a short Chinese phrase (4-8 chars) summarizing the core topic, suitable for a filename
  - For articles: describe what kind of content (e.g. "AI提示词教程", "MCP开发指南")
  - For shares: describe what is being shared (e.g. "推荐开源工具", "分享AI插件")
  - For originals: one-sentence gist (e.g. "关于创业思考", "学习心得")
- "summary": a concise one-sentence Chinese summary of the tweet content
- "tags": 2-5 keyword tags in Chinese or English

## Tweet Content
${text}
`.trim();

/**
 * Classify a single tweet using Gemini AI via REST API.
 * Returns { tweet_type, category, subcategory, filename_hint, summary, tags }
 */
export async function classifyTweet(text, apiKey, isArticle = false, model) {
    if (!text || text.trim().length < 5) {
        return defaultResult();
    }

    const modelName = model || DEFAULT_MODEL;
    const url = `${GEMINI_API_URL}/${modelName}:generateContent?key=${apiKey}`;
    const prompt = CLASSIFICATION_PROMPT(text.slice(0, 2000), isArticle);

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 1024,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            tweet_type: { type: "STRING" },
                            category: { type: "STRING" },
                            ai_sub: { type: "STRING" },
                            filename_hint: { type: "STRING" },
                            summary: { type: "STRING" },
                            tags: { type: "ARRAY", items: { type: "STRING" } },
                        },
                        required: ["tweet_type", "category", "filename_hint", "summary", "tags"]
                    }
                },
            }, {
                timeout: 30000,
            });

            const raw = res.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!raw) throw new Error('Empty response from Gemini');

            const data = JSON.parse(raw);

            // Validate tweet_type
            const validTypes = ['article', 'share', 'original'];
            const tweet_type = validTypes.includes(data.tweet_type) ? data.tweet_type : 'original';

            // Validate category
            const category = ALL_CATEGORIES.includes(data.category) ? data.category : '其它';

            // Validate AI subcategory
            let subcategory = '';
            if (category === 'AI') {
                subcategory = AI_SUBCATEGORIES.includes(data.ai_sub) ? data.ai_sub : '其它AI工具';
            }

            // filename_hint: sanitize and limit length
            const filename_hint = sanitizeHint(data.filename_hint || '未分类');

            const summary = data.summary || '';

            const tags = Array.isArray(data.tags)
                ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 5)
                : [];

            return { tweet_type, category, subcategory, filename_hint, summary, tags };
        } catch (err) {
            lastError = err;
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, attempt * 1000));
            }
        }
    }

    console.warn(`  ⚠ Gemini classification failed: ${lastError?.message?.slice(0, 80)}. Using defaults.`);
    return defaultResult();
}

function defaultResult() {
    return {
        tweet_type: 'original',
        category: '其它',
        subcategory: '',
        filename_hint: '未分类',
        summary: '',
        tags: [],
    };
}

function sanitizeHint(str) {
    return String(str ?? '')
        .replace(/[\\/:*?"<>|\n\r]/g, '')
        .trim()
        .slice(0, 20) || '未分类';
}
