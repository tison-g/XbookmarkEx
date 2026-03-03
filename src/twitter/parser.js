/**
 * Parse a raw tweet result from X GraphQL API into a clean structure.
 * Handles retweets, quoted tweets, and regular tweets.
 */
export function parseTweet(rawResult) {
    // Handle tweet wrapper variations
    const tweet = rawResult?.__typename === 'TweetWithVisibilityResults'
        ? rawResult.tweet
        : rawResult;

    if (!tweet || tweet.__typename === 'TweetTombstone') return null;

    const core = tweet.core?.user_results?.result;
    const legacy = tweet.legacy;
    const userLegacy = core?.legacy;

    if (!legacy || !userLegacy) return null;

    // Parse media
    const media = parseMedia(legacy.extended_entities?.media ?? legacy.entities?.media ?? []);

    // Full text (prefer note_tweet for long-form)
    const text = tweet.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? '';

    // Build canonical URL
    const url = `https://x.com/${userLegacy.screen_name}/status/${legacy.id_str}`;

    return {
        id: legacy.id_str,
        text: cleanTweetText(text, legacy.entities),
        author: {
            name: userLegacy.name,
            screenName: userLegacy.screen_name,
            avatarUrl: userLegacy.profile_image_url_https,
        },
        createdAt: new Date(legacy.created_at).toISOString(),
        url,
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

function parseMedia(mediaItems) {
    return mediaItems.map(m => {
        if (m.type === 'photo') {
            return {
                type: 'photo',
                url: m.media_url_https,
                ext: 'jpg',
            };
        } else if (m.type === 'video' || m.type === 'animated_gif') {
            // Pick highest bitrate variant
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
 * Remove t.co URLs from tweet text and clean up whitespace.
 */
function cleanTweetText(text, entities) {
    let cleaned = text;
    // Remove all t.co tracking URLs from the end
    const urlEntities = entities?.urls ?? [];
    for (const urlEntity of urlEntities) {
        cleaned = cleaned.replace(urlEntity.url, urlEntity.expanded_url ?? '');
    }
    // Remove media t.co URLs (they appear at end of text)
    cleaned = cleaned.replace(/https:\/\/t\.co\/\S+/g, '').trim();
    return cleaned;
}
