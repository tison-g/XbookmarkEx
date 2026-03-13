import fsExtra from 'fs-extra';
import path from 'path';

const { ensureDir, writeFile } = fsExtra;

/**
 * Generate Obsidian-compatible Markdown content for a tweet.
 */
export function generateMarkdown(tweet, savedMedia, classification, attachmentsFolder) {
    const date = tweet.createdAt.slice(0, 10); // YYYY-MM-DD
    const { category, subcategory, tags, summary } = classification;

    // Build YAML frontmatter
    const mediaFrontmatter = savedMedia.length > 0
        ? savedMedia.map(f => `  - ${attachmentsFolder}/${f}`).join('\n')
        : '';

    const frontmatter = [
        '---',
        `id: "${tweet.id}"`,
        `author: "@${tweet.author.screenName}"`,
        `name: "${escapeYaml(tweet.author.name)}"`,
        `date: ${date}`,
        `url: "${tweet.url}"`,
        tweet.statusUrl && tweet.isArticle ? `status_url: "${tweet.statusUrl}"` : null,
        `type: "${classification.tweet_type || (tweet.isArticle ? 'article' : 'tweet')}"`,
        `category: "${category}"`,
        subcategory ? `subcategory: "${subcategory}"` : null,
        `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
        summary ? `summary: "${escapeYaml(summary)}"` : null,
        tweet.likeCount != null ? `likes: ${tweet.likeCount}` : null,
        tweet.retweetCount != null ? `retweets: ${tweet.retweetCount}` : null,
        savedMedia.length > 0 ? `media:\n${mediaFrontmatter}` : null,
        '---',
    ].filter(Boolean).join('\n');

    // Header - show article badge for X Articles
    const typeIcon = tweet.isArticle ? '📝 ' : (classification.tweet_type === 'share' ? '🔗 ' : '');
    const header = `# ${typeIcon}[@${tweet.author.screenName}](https://x.com/${tweet.author.screenName}) · ${date}`;

    // Tweet text body
    let body = tweet.text || '_（无文字内容）_';

    // Replace inline media placeholders and track which ones were inlined
    const inlinedMediaFiles = new Set();
    if (tweet.isArticle && tweet.media && tweet.media.length > 0) {
        for (const m of tweet.media) {
            if (m.mediaId && m.localFilename) {
                const placeholder = `![MEDIA:${m.mediaId}]`;
                const replacement = `![[${m.localFilename}]]`; // Obsidian auto-resolves filename
                if (body.includes(placeholder)) {
                    body = body.split(placeholder).join(replacement);
                    inlinedMediaFiles.add(m.localFilename);
                }
            }
        }
    }
    // Remove any unresolved MEDIA placeholders (e.g. videos not in media_entities)
    body = body.replace(/!\[MEDIA:[^\]]+\]\n?/g, '');

    // Media embeds
    const mediaEmbeds = savedMedia.filter(f => !inlinedMediaFiles.has(f)).map(f => {
        const isVideo = f.includes('-video-') || f.includes('-gif-');
        if (isVideo) {
            return `> 🎥 [视频: ${f}](${attachmentsFolder}/${f})`;
        }
        return `![[${f}]]`;
    }).join('\n');

    // Quoted tweet block
    let quotedBlock = '';
    if (tweet.quotedTweet) {
        const qt = tweet.quotedTweet;
        const qtDate = qt.createdAt.slice(0, 10);
        quotedBlock = [
            '',
            '> **引用推文**',
            `> [@${qt.author.screenName}](https://x.com/${qt.author.screenName}) · ${qtDate}`,
            `> `,
            ...qt.text.split('\n').map(l => `> ${l}`),
            `> `,
            `> [查看原推](${qt.url})`,
        ].join('\n');
    }

    // Footer
    const footer = `---\n[原推链接](${tweet.url})`;

    const parts = [
        frontmatter,
        '',
        header,
        '',
        body,
    ];

    if (mediaEmbeds) {
        parts.push('', mediaEmbeds);
    }
    if (quotedBlock) {
        parts.push(quotedBlock);
    }
    parts.push('', footer);

    return parts.join('\n');
}

/**
 * Determine the save directory based on classification.
 * - article → {vault}/{category}/{subcategory}/ or {vault}/{category}/
 * - original → {vault}/推文/原创/
 * - share → {vault}/推文/分享推荐/
 */
function getCategoryDir(vaultPath, classification) {
    const { tweet_type, category, subcategory } = classification;

    if (tweet_type === 'original') {
        return path.join(vaultPath, '推文', '原创');
    }
    if (tweet_type === 'share') {
        return path.join(vaultPath, '推文', '分享推荐');
    }

    // article type
    if (category === 'AI' && subcategory) {
        return path.join(vaultPath, 'AI', subcategory);
    }
    return path.join(vaultPath, category);
}

/**
 * Build the filename based on tweet type and classification.
 * - article: 日期-hint-作者-标题.md
 * - original: 日期-hint-作者.md
 * - share: 日期-hint-作者.md
 */
function buildFilename(tweet, classification) {
    const date = tweet.createdAt.slice(0, 10);
    const author = tweet.author.screenName;
    const hint = sanitizeFilename(classification.filename_hint || '未分类');

    if (classification.tweet_type === 'article' && tweet.articleTitle) {
        const safeTitle = sanitizeFilename(tweet.articleTitle).slice(0, 30).trim() || tweet.id;
        return `${date}-${hint}-${author}-${safeTitle}.md`;
    }

    return `${date}-${hint}-${author}.md`;
}

/**
 * Save a tweet as a markdown file in the correct category folder.
 * Returns { filePath, classification } for index generation.
 */
export async function saveBookmark(tweet, vaultPath, classification, savedMedia, attachmentsFolder) {
    const categoryDir = getCategoryDir(vaultPath, classification);
    const attachmentsDir = path.join(categoryDir, attachmentsFolder);
    await ensureDir(categoryDir);
    await ensureDir(attachmentsDir);

    const filename = buildFilename(tweet, classification);
    const filePath = path.join(categoryDir, filename);

    const content = generateMarkdown(tweet, savedMedia, classification, attachmentsFolder);
    await writeFile(filePath, content, 'utf-8');

    return { filePath, filename };
}

/**
 * Get the attachments directory for a tweet's category.
 */
export function getAttachmentsDir(vaultPath, classification, attachmentsFolder) {
    const categoryDir = getCategoryDir(vaultPath, classification);
    return path.join(categoryDir, attachmentsFolder);
}

/**
 * Generate a share summary file that lists all share-type tweets.
 */
export async function generateShareSummary(shareTweets, classifications, vaultPath) {
    if (shareTweets.length === 0) return null;

    const date = new Date().toISOString().slice(0, 10);
    const shareDir = path.join(vaultPath, '推文', '分享推荐');
    await ensureDir(shareDir);

    const rows = shareTweets.map((tweet, i) => {
        const cl = classifications[i];
        const summary = cl.summary || tweet.text.slice(0, 50).replace(/\n/g, ' ');
        const links = (tweet.urls && tweet.urls.length > 0)
            ? tweet.urls.map(u => `[分享链接](${u})`).join('<br>')
            : `[原推链接](${tweet.url})`;
        return `| ${sanitizeTable(cl.filename_hint)} | @${tweet.author.screenName} | ${sanitizeTable(summary)} | ${links} |`;
    });

    const content = [
        `# 分享汇总 ${date}`,
        '',
        `共 ${shareTweets.length} 条分享推荐。`,
        '',
        '| 主题 | 作者 | 摘要 | 链接 |',
        '|------|------|------|------|',
        ...rows,
    ].join('\n');

    const filePath = path.join(shareDir, `分享汇总-${date}.md`);
    await writeFile(filePath, content, 'utf-8');
    return filePath;
}

/**
 * Generate a per-export index/catalog file.
 */
export async function generateExportIndex(exportedItems, vaultPath) {
    if (exportedItems.length === 0) return null;

    const date = new Date().toISOString().slice(0, 10);

    const articles = exportedItems.filter(i => i.classification.tweet_type === 'article');
    const originals = exportedItems.filter(i => i.classification.tweet_type === 'original');
    const shares = exportedItems.filter(i => i.classification.tweet_type === 'share');

    const lines = [
        `# 导出目录 ${date}`,
        '',
        `共导出 ${exportedItems.length} 条书签。`,
        '',
    ];

    if (articles.length > 0) {
        lines.push('## 📝 文章', '');
        lines.push('| 标题 | 作者 | 分类 | 摘要 |');
        lines.push('|------|------|------|------|');
        for (const item of articles) {
            const { tweet, classification, filename } = item;
            const title = tweet.articleTitle || classification.filename_hint;
            const cat = classification.category === 'AI'
                ? `AI/${classification.subcategory}`
                : classification.category;
            lines.push(`| ${sanitizeTable(title)} | @${tweet.author.screenName} | ${cat} | ${sanitizeTable(classification.summary)} |`);
        }
        lines.push('');
    }

    if (originals.length > 0) {
        lines.push('## 💬 原创推文', '');
        lines.push('| 摘要 | 作者 | 链接 |');
        lines.push('|------|------|------|');
        for (const item of originals) {
            const { tweet, classification } = item;
            lines.push(`| ${sanitizeTable(classification.summary)} | @${tweet.author.screenName} | [查看](${tweet.url}) |`);
        }
        lines.push('');
    }

    if (shares.length > 0) {
        lines.push('## 🔗 分享推荐', '');
        lines.push('| 主题 | 作者 | 链接 |');
        lines.push('|------|------|------|');
        for (const item of shares) {
            const { tweet, classification } = item;
            lines.push(`| ${sanitizeTable(classification.filename_hint)} | @${tweet.author.screenName} | [查看](${tweet.url}) |`);
        }
        lines.push('');
    }

    const filePath = path.join(vaultPath, `导出目录-${date}.md`);
    await writeFile(filePath, lines.join('\n'), 'utf-8');
    return filePath;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeYaml(str) {
    return String(str ?? '').replace(/"/g, '\\"');
}

function sanitizeFilename(str) {
    return String(str ?? '').replace(/[\\/:*?"<>|\n\r]/g, '-').trim();
}

function sanitizeTable(str) {
    return String(str ?? '').replace(/\|/g, '｜').replace(/\n/g, ' ').slice(0, 60);
}
