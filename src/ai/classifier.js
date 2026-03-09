import axios from 'axios';

// Predefined categories (can be extended by user)
export const CATEGORIES = [
    'AI与机器学习',
    '编程与开发',
    '设计与创意',
    '科技资讯',
    '商业与创业',
    '生活与娱乐',
    '股票与投资',
    '学习与教育',
    'Openclaw专题',
    '其他',
];

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const CLASSIFICATION_PROMPT = (text, categories) => `
You are a precise content classifier. Analyze the tweet below and return exactly a JSON object (no markdown formatting, no code blocks) with the following fields:
- "category": EXACTLY ONE of these main categories: ${categories.join(', ')}
- "subcategory": A specific, short sub-category name (1-4 words) that fits this tweet best.
- "tags": An array of 1 to 5 hierarchical tags (e.g., ["AI/Prompt", "Dev/NodeJS"]).
- "summary": A concise one-sentence summary (摘要) of the tweet's core point, in Chinese.

Tweet content:
${text}
`.trim();

/**
 * Classify a single tweet using Gemini AI via REST API.
 * @param {string} text - tweet text (or article title + text)
 * @param {string} apiKey - Gemini API key
 * @param {string} [model] - Gemini model name (default: gemini-2.5-flash)
 * @returns {{ category: string, tags: string[] }}
 */
export async function classifyTweet(text, apiKey, model) {
    if (!text || text.trim().length < 5) {
        return { category: '其他', tags: [] };
    }

    const modelName = model || DEFAULT_MODEL;
    const url = `${GEMINI_API_URL}/${modelName}:generateContent?key=${apiKey}`;
    const prompt = CLASSIFICATION_PROMPT(text.slice(0, 1500), CATEGORIES);

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
                            category: { type: "STRING" },
                            subcategory: { type: "STRING" },
                            tags: { type: "ARRAY", items: { type: "STRING" } },
                            summary: { type: "STRING" }
                        },
                        required: ["category", "subcategory", "tags", "summary"]
                    }
                },
            }, {
                timeout: 15000,
            });

            const raw = res.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!raw) throw new Error('Empty response from Gemini');

            const data = JSON.parse(raw);

            // Validate category is in our list
            const category = CATEGORIES.includes(data.category)
                ? data.category
                : '其他';

            const subcategory = data.subcategory || '默认分类';

            const tags = Array.isArray(data.tags)
                ? data.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 5)
                : [];

            const summary = data.summary || '';

            return { category, subcategory, tags, summary };
        } catch (err) {
            lastError = err;
            if (attempt < 3) {
                // Wait before retry: 1s, then 2s
                await new Promise(r => setTimeout(r, attempt * 1000));
            }
        }
    }

    // Fallback after all retries
    console.warn(`  ⚠ Gemini classification failed: ${lastError?.message?.slice(0, 80)}. Using "其他".`);
    return { category: '其他', subcategory: '默认分类', tags: [], summary: '' };
}
