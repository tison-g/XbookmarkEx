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
You are a content classifier. Analyze the tweet below and classify it into EXACTLY ONE of these categories: ${categories.join(', ')}

Tweet content:
${text}

Respond ONLY with a single line of text in this exact format, with no markdown, quotes, or JSON:
CategoryName|tag1,tag2,tag3
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

            // Expecting format: "CategoryName|tag1,tag2,tag3"
            const parts = raw.split('|');
            const categoryStr = parts[0]?.trim() || '';
            const tagsStr = parts[1]?.trim() || '';

            // Validate category is in our list
            const category = CATEGORIES.includes(categoryStr)
                ? categoryStr
                : '其他';

            const tags = tagsStr
                ? tagsStr.split(',').map(t => String(t).trim()).filter(Boolean).slice(0, 5)
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
