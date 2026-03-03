import axios from 'axios';

// X internal GraphQL query ID for bookmarks (stable across sessions)
const BOOKMARKS_QUERY_ID = 'Z5Ngu1AJLopIBkSZjCAUSQ';
const BOOKMARKS_FEATURES = JSON.stringify({
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: false,
  tweet_awards_web_tipping_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
});

/**
 * Fetch one page of bookmarks from X internal API.
 * @param {object} cookies - { auth_token, ct0 }
 * @param {string|null} cursor - pagination cursor
 * @returns {{ tweets: object[], nextCursor: string|null }}
 */
export async function fetchBookmarksPage(cookies, cursor = null) {
  const variables = {
    count: 100,
    includePromotedContent: false,
  };
  if (cursor) variables.cursor = cursor;

  const url = `https://x.com/i/api/graphql/${BOOKMARKS_QUERY_ID}/Bookmarks`;

  const response = await axios.get(url, {
    params: {
      variables: JSON.stringify(variables),
      features: BOOKMARKS_FEATURES,
    },
    headers: {
      'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      'cookie': `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}`,
      'x-csrf-token': cookies.ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'referer': 'https://x.com/i/bookmarks',
      'accept': '*/*',
    },
  });

  const data = response.data;
  const timeline = data?.data?.bookmark_timeline_v2?.timeline;
  if (!timeline) {
    throw new Error(`Unexpected API response structure. Got: ${JSON.stringify(Object.keys(data?.data || {}))}`);
  }

  const instructions = timeline.instructions ?? [];
  const timelineAddEntries = instructions.find(i => i.type === 'TimelineAddEntries');
  const entries = timelineAddEntries?.entries ?? [];

  const tweets = [];
  let nextCursor = null;

  for (const entry of entries) {
    const entryId = entry.entryId ?? '';
    if (entryId.startsWith('tweet-')) {
      const result = entry?.content?.itemContent?.tweet_results?.result;
      if (result) tweets.push(result);
    } else if (entryId.startsWith('cursor-bottom')) {
      nextCursor = entry?.content?.value ?? null;
    }
  }

  return { tweets, nextCursor };
}

/**
 * Fetch ALL bookmarks, paginating until done.
 * Calls onPage(tweets, pageNum) after each page.
 * @param {object} cookies
 * @param {function} onPage - optional callback per page
 * @returns {object[]} all raw tweet results
 */
export async function fetchAllBookmarks(cookies, onPage = null) {
  const allTweets = [];
  let cursor = null;
  let page = 1;

  while (true) {
    const { tweets, nextCursor } = await fetchBookmarksPage(cookies, cursor);
    allTweets.push(...tweets);
    if (onPage) onPage(tweets, page);
    if (!nextCursor || tweets.length === 0) break;
    cursor = nextCursor;
    page++;
    // Polite delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  return allTweets;
}
