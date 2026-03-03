import axios from 'axios';

// Predefined categories (can be extended by user)
export const CATEGORIES = [
    'AI与机器学习',
    '编程与开发',
    '设计与创意',
    '科技资讯',
    '商业与创业',
    '生活与娱乐',
    '学习与教育',
    '其他',
];

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';

const CLASSIFICATION_PROMPT = (text, categories) => `
Analyze the following tweet and classify it. Respond ONLY with valid JSON, no markdown, no explanation.

Categories to choose from: ${categories.join(', ')}

Tweet:
${text}

Respond with exactly this JSON structure:
{
  "category": "<one category from the list above>",
  "tags": ["tag1", "tag2", "tag3"]
}

Rules:
- Choose the single most relevant category
- Tags should be 2-5 short English or Chinese keywords
- If the tweet is in Chinese, prefer Chinese tags
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
                    maxOutputTokens: 512,
                },
            }, {
                timeout: 15000,
            });

            const raw = res.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (!raw) throw new Error('Empty response from Gemini');

            // Strip markdown code fences if model wraps in them
            const jsonStr = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
            const parsed = JSON.parse(jsonStr);

            // Validate category is in our list
            const category = CATEGORIES.includes(parsed.category)
                ? parsed.category
                : '其他';

            const tags = Array.isArray(parsed.tags)
                ? parsed.tags.map(t => String(t)).slice(0, 5)
                : [];

            return { category, tags };
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
    return { category: '其他', tags: [] };
}
