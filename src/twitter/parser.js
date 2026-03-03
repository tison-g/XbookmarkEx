import axios from 'axios';

/**
 * Parse a raw tweet result from X GraphQL API into a clean structure.
 * Handles regular tweets, X Articles (note_tweet), retweets, and quoted tweets.
 */
export function parseTweet(rawResult) {
    // Handle tweet wrapper variations
    const tweet = rawResult?.__typename === 'TweetWithVisibilityResults'
        ? rawResult.tweet
        : rawResult;

    if (!tweet || tweet.__typename === 'TweetTombstone') return null;

    let core = tweet.core?.user_results?.result;
    let legacy = tweet.legacy;
    let userLegacy = core?.legacy;

    if (!legacy && tweet.article) {
        // Handle standalone article object variations if legacy is missing
        legacy = tweet.article;
    }

    // For articles, the author data might be located differently
    if (!userLegacy && tweet.core?.user_results?.result?.legacy) {
        userLegacy = tweet.core.user_results.result.legacy;
    }

    if (!legacy) return null;

    // Detect X Article (long-form post via note_tweet OR dedicated article property)
    const noteTweet = tweet.note_tweet?.note_tweet_results?.result;
    const isArticle = !!noteTweet || !!tweet.article;

    // Optional safe extraction of author fields
    // X GraphQL sometimes places these in `core`, sometimes in `legacy`
    const userCore = core?.core;
    const screenName = userCore?.screen_name || userLegacy?.screen_name || 'unknown';
    const authorName = userCore?.name || userLegacy?.name || 'unknown';
    const avatarUrl = userLegacy?.profile_image_url_https || '';

    // Full text: articles use note_tweet, regular tweets use full_text
    let rawText = legacy.full_text ?? '';
    let noteEntities = legacy.entities;

    if (noteTweet) {
        rawText = noteTweet.text ?? rawText;
        noteEntities = noteTweet.entity_set ?? noteEntities;
    }

    // Parse media (from tweet + note_tweet media if present)
    const mediaItems = [
        ...(legacy.extended_entities?.media ?? legacy.entities?.media ?? []),
        ...(noteTweet?.media?.inline_media ?? []),
    ];
    const media = parseMedia(mediaItems);

    // Build canonical URL:
    // X Articles are accessible via /article/ID (the /status/ID link also works
    // but shows a "view article" wrapper — /article/ID gives the full read view)
    const tweetId = legacy.id_str || legacy.id || 'unknown_id';
    const url = isArticle
        ? `https://x.com/${screenName}/article/${tweetId}`
        : `https://x.com/${screenName}/status/${tweetId}`;

    // Also keep the status URL for reference
    const statusUrl = `https://x.com/${screenName}/status/${tweetId}`;

    return {
        id: tweetId,
        text: cleanTweetText(rawText, noteEntities),
        author: {
            name: authorName,
            screenName,
            avatarUrl,
        },
        createdAt: new Date(legacy.created_at || new Date()).toISOString(),
        url,
        statusUrl,
        isArticle,
        media,
        isRetweet: !!legacy.retweeted_status_id_str,
        quotedTweet: tweet.quoted_status_result
            ? parseTweet(tweet.quoted_status_result.result)
            : null,
        likeCount: legacy.favorite_count,
        retweetCount: legacy.retweet_count,
        replyCount: legacy.reply_count,
    };
}

/**
 * Fetch and extract the full body of an X Article using the public FxTwitter API.
 * This bypasses authentication and rate limits, returning structured article data.
 * @param {string} tweetId 
 * @returns {string|null} The article text formatted as Markdown, or null if failed.
 */
export async function fetchArticleContentFromFxTwitter(tweetId) {
    try {
        const res = await axios.get(`https://api.fxtwitter.com/status/${tweetId}`, {
            headers: { 'user-agent': 'XbookmarkEx/1.0' },
            timeout: 10000,
        });

        const article = res.data?.tweet?.article;
        if (!article || !article.content || !article.content.blocks) {
            return null; // Not an article or no content
        }

        // Convert FxTwitter blocks into Markdown
        let markdown = '';
        for (const block of article.content.blocks) {
            if (!block.text) continue;

            let text = block.text;

            // Apply inline formatting if available
            if (block.inlineStyleRanges && block.inlineStyleRanges.length > 0) {
                // We need to apply styles from the end to the beginning so offsets don't shift
                const styles = [...block.inlineStyleRanges].sort((a, b) => b.offset - a.offset);
                for (const style of styles) {
                    const start = style.offset;
                    const end = start + style.length;
                    const before = text.slice(0, start);
                    const middle = text.slice(start, end);
                    const after = text.slice(end);

                    if (style.style === 'Bold') {
                        text = `${before}**${middle}**${after}`;
                    } else if (style.style === 'Italic') {
                        text = `${before}*${middle}*${after}`;
                    } else if (style.style === 'Code') {
                        text = `${before}\`${middle}\`${after}`;
                    }
                }
            }

            // Apply block formatting
            switch (block.type) {
                case 'header-one':
                    markdown += `# ${text}\n\n`;
                    break;
                case 'header-two':
                    markdown += `## ${text}\n\n`;
                    break;
                case 'header-three':
                    markdown += `### ${text}\n\n`;
                    break;
                case 'unordered-list-item':
                    markdown += `- ${text}\n`;
                    break;
                case 'ordered-list-item':
                    markdown += `1. ${text}\n`; // Markdown auto-numbers
                    break;
                case 'code-block':
                    markdown += `\`\`\`\n${text}\n\`\`\`\n\n`;
                    break;
                case 'unstyled':
                default:
                    if (text.trim() === '') {
                        markdown += '\n'; // Preserve empty lines
                    } else {
                        markdown += `${text}\n\n`;
                    }
                    break;
            }
        }

        return {
            text: markdown.trim(),
            author: {
                screenName: res.data.tweet?.author?.screen_name,
                name: res.data.tweet?.author?.name,
            }
        };
    } catch {
        return null;
    }
}

function parseMedia(mediaItems) {
    return mediaItems.map(m => {
        if (!m || !m.type) return null;
        if (m.type === 'photo') {
            return {
                type: 'photo',
                url: m.media_url_https,
                ext: 'jpg',
            };
        } else if (m.type === 'video' || m.type === 'animated_gif') {
            const variants = (m.video_info?.variants ?? [])
                .filter(v => v.content_type === 'video/mp4')
                .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
            const best = variants[0];
            return {
                type: m.type === 'animated_gif' ? 'gif' : 'video',
                url: best?.url ?? m.media_url_https,
                ext: 'mp4',
            };
        }
        return null;
    }).filter(Boolean);
}

/**
 * Remove t.co tracking URLs and clean up whitespace.
 */
function cleanTweetText(text, entities) {
    let cleaned = text ?? '';
    const urlEntities = entities?.urls ?? [];
    for (const urlEntity of urlEntities) {
        // For article URLs pointing to twitter articles, remove the link (we already track url)
        if (urlEntity.expanded_url?.includes('/article/')) {
            cleaned = cleaned.replace(urlEntity.url, '').trim();
        } else {
            cleaned = cleaned.replace(urlEntity.url, urlEntity.expanded_url ?? '');
        }
    }
    // Remove remaining t.co URLs
    cleaned = cleaned.replace(/https:\/\/t\.co\/\S+/g, '').trim();
    return cleaned;
}

function decodeHTMLEntities(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
