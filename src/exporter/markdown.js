import fsExtra from 'fs-extra';
import path from 'path';

const { ensureDir, writeFile } = fsExtra;

/**
 * Generate Obsidian-compatible Markdown content for a tweet.
 */
export function generateMarkdown(tweet, savedMedia, classification, attachmentsFolder) {
    const date = tweet.createdAt.slice(0, 10); // YYYY-MM-DD
    const { category, tags } = classification;

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
        `type: "${tweet.isArticle ? 'article' : 'tweet'}"`,
        `category: ${category}`,
        `tags: [${tags.map(t => `"${t}"`).join(', ')}]`,
        tweet.likeCount != null ? `likes: ${tweet.likeCount}` : null,
        tweet.retweetCount != null ? `retweets: ${tweet.retweetCount}` : null,
        savedMedia.length > 0 ? `media:\n${mediaFrontmatter}` : null,
        '---',
    ].filter(Boolean).join('\n');

    // Header - show article badge for X Articles
    const typeIcon = tweet.isArticle ? '📝 ' : '';
    const header = `# ${typeIcon}[@${tweet.author.screenName}](https://x.com/${tweet.author.screenName}) · ${date}`;

    // Tweet text body
    const body = tweet.text || '_（无文字内容）_';

    // Media embeds
    const mediaEmbeds = savedMedia.map(f => {
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
 * Save a tweet as a markdown file in the correct category folder.
 * Returns the file path written.
 */
export async function saveBookmark(tweet, vaultPath, classification, savedMedia, attachmentsFolder) {
    const { category } = classification;
    const date = tweet.createdAt.slice(0, 10);
    const author = tweet.author.screenName;

    const categoryDir = path.join(vaultPath, category);
    const attachmentsDir = path.join(categoryDir, attachmentsFolder);
    await ensureDir(categoryDir);
    await ensureDir(attachmentsDir);

    let filename = '';
    if (tweet.isArticle && tweet.articleTitle) {
        // Articles use title strategy: Date-Author-Title.md
        let safeTitle = sanitizeFilename(tweet.articleTitle).slice(0, 40).trim();
        if (!safeTitle) safeTitle = tweet.id; // fallback
        filename = `${date}-${author}-${safeTitle}.md`;
    } else {
        // Regular tweets use Date-Author-IdSuffix.md
        const idSuffix = String(tweet.id).slice(-6);
        filename = `${date}-${author}-${idSuffix}.md`;
    }

    const filePath = path.join(categoryDir, filename);

    const content = generateMarkdown(tweet, savedMedia, classification, attachmentsFolder);
    await writeFile(filePath, content, 'utf-8');

    return filePath;
}

/**
 * Get the attachments directory for a tweet's category.
 */
export function getAttachmentsDir(vaultPath, category, attachmentsFolder) {
    return path.join(vaultPath, category, attachmentsFolder);
}

function escapeYaml(str) {
    return String(str ?? '').replace(/"/g, '\\"');
}

function sanitizeFilename(str) {
    // Replace invalid Windows characters /\:*?"<>| and newlines with a dash
    return String(str ?? '').replace(/[\\/:*?"<>|\n\r]/g, '-').trim();
}
