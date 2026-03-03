import { GoogleGenerativeAI } from '@google/generative-ai';

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
 * Classify a single tweet using Gemini AI.
 * @param {string} text - tweet text
 * @param {string} apiKey - Gemini API key
 * @returns {{ category: string, tags: string[] }}
 */
export async function classifyTweet(text, apiKey) {
    if (!text || text.trim().length < 5) {
        return { category: '其他', tags: [] };
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const prompt = CLASSIFICATION_PROMPT(text.slice(0, 1000), CATEGORIES);

    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const raw = result.response.text().trim();

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
    console.warn(`  ⚠ Gemini classification failed: ${lastError?.message}. Using "其他".`);
    return { category: '其他', tags: [] };
}
