import axios from 'axios';
import { discoverBookmarksQueryId } from './discovery.js';

// Cache the discovered query ID (only fetch once per run)
let _cachedQueryId = null;

// Known fallback IDs (in case JS bundle scraping fails, try these in order)
const FALLBACK_QUERY_IDS = [
  'Z5Ngu1AJLopIBkSZjCAUSQ',
  'usYMFZ5ZFnKTBWBGBBa8xA',
  'E4TiApMlKHaeTHqIqaFSFg',
  'vxYTlHGU3TxO3EVkIeOAXQ',
];

const BOOKMARKS_FEATURES = JSON.stringify({
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,   // ← enable articles
  responsive_web_twitter_article_notes_tab_ui_enabled: true,         // ← article tab
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
  articles_preview_enabled: true,                                    // ← article preview
  creator_subscriptions_tweet_result_by_id_enabled: true,
});

function makeHeaders(cookies) {
  return {
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
  };
}

/**
 * Single HTTP call for one page of bookmarks using a specific query ID.
 */
async function fetchPageWithId(cookies, cursor, queryId) {
  const variables = { count: 100, includePromotedContent: false };
  if (cursor) variables.cursor = cursor;

  const url = `https://x.com/i/api/graphql/${queryId}/Bookmarks`;
  const response = await axios.get(url, {
    params: {
      variables: JSON.stringify(variables),
      features: BOOKMARKS_FEATURES,
    },
    headers: makeHeaders(cookies),
    timeout: 20000,
  });

  const data = response.data;
  const timeline = data?.data?.bookmark_timeline_v2?.timeline;
  if (!timeline) {
    throw new Error(`Unexpected API response structure. Got keys: ${JSON.stringify(Object.keys(data?.data || {}))}`);
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
 * Fetch one page of bookmarks, automatically discovering or trying fallback query IDs.
 * @param {object} cookies - { auth_token, ct0 }
 * @param {string|null} cursor - pagination cursor
 */
export async function fetchBookmarksPage(cookies, cursor = null) {
  // If we have a cached working query ID, use it directly
  if (_cachedQueryId) {
    return fetchPageWithId(cookies, cursor, _cachedQueryId);
  }

  // Step 1: Use manually configured query_id if provided in config (highest priority)
  if (cookies._queryId) {
    _cachedQueryId = cookies._queryId;
    return fetchPageWithId(cookies, cursor, _cachedQueryId);
  }

  // Step 2: Try dynamic discovery from JS bundle
  process.stdout.write('\r  Discovering current API endpoint...');
  const discovered = await discoverBookmarksQueryId(cookies);
  if (discovered) {
    try {
      const result = await fetchPageWithId(cookies, cursor, discovered);
      _cachedQueryId = discovered;
      process.stdout.write('\r  ✓ API endpoint discovered automatically\n');
      return result;
    } catch {
      // fall through to try fallbacks
    }
  }

  // Step 3: Try known fallback IDs one by one
  for (const id of FALLBACK_QUERY_IDS) {
    try {
      const result = await fetchPageWithId(cookies, cursor, id);
      _cachedQueryId = id;
      process.stdout.write(`\r  ✓ Using endpoint: ${id}\n`);
      return result;
    } catch (e) {
      const status = e.response?.status;
      if (status !== 404 && status !== 400 && status !== 403) {
        throw e; // unexpected error, don't retry
      }
      // 404/400 = wrong query ID, try next
    }
  }

  throw new Error(
    'Failed to connect to X bookmarks API. All query IDs returned 404.\n\n' +
    'Please find the current query ID manually:\n' +
    '  1. Open Chrome and go to https://x.com/i/bookmarks\n' +
    '  2. Press F12 → Network tab → filter by "Bookmarks"\n' +
    '  3. Scroll down in your bookmarks to trigger a request\n' +
    '  4. Click the Bookmarks request → copy the ID from the URL:\n' +
    '     https://x.com/i/api/graphql/[QUERY_ID_HERE]/Bookmarks\n' +
    '  5. Add to config.json: "query_id": "[QUERY_ID_HERE]"'
  );
}

/**
 * Fetch bookmarks with optional limits and date filtering.
 * Retries on socket hang up or rate-limit errors.
 *
 * @param {object} cookies
 * @param {object} opts
 * @param {number}  [opts.maxCount=200]  - max tweets to return (default 200)
 * @param {Date}    [opts.dateFrom]       - only return tweets on or after this date
 * @param {Date}    [opts.dateTo]         - only return tweets on or before this date
 * @param {function}[opts.onPage]         - callback(tweets, page) after each page
 * @returns {object[]} raw tweet results
 */
export async function fetchAllBookmarks(cookies, opts = {}) {
  const {
    maxCount = 200,
    dateFrom = null,
    dateTo = null,
    onPage = null,
  } = opts;

  const allTweets = [];
  let cursor = null;
  let page = 1;
  let stopEarly = false;

  while (!stopEarly) {
    // Retry this page up to 3 times on transient errors
    let result;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await fetchBookmarksPage(cookies, cursor);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const isTransient =
          err.code === 'ECONNRESET' ||
          err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT' ||
          err.message?.includes('socket hang up') ||
          err.response?.status === 429 ||
          err.response?.status >= 500;

        if (!isTransient || attempt === 3) break;

        const wait = attempt * 5000;
        process.stdout.write(`\r  ⟳ Connection dropped, retrying in ${wait / 1000}s (attempt ${attempt}/3)...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    if (lastErr) throw lastErr;

    const { tweets, nextCursor } = result;

    for (const tweet of tweets) {
      // Date filtering: use tweet's createdAt
      const tweetDate = tweet?.legacy?.created_at
        ? new Date(tweet.legacy.created_at)
        : null;

      if (tweetDate) {
        if (dateTo && tweetDate > dateTo) continue;      // too recent, skip
        if (dateFrom && tweetDate < dateFrom) {          // too old → stop pagination
          stopEarly = true;
          break;
        }
      }

      allTweets.push(tweet);

      // Stop if we've hit the max count
      if (allTweets.length >= maxCount) {
        stopEarly = true;
        break;
      }
    }

    if (onPage) onPage(tweets, page);
    if (!nextCursor || tweets.length === 0) break;
    if (stopEarly) break;

    cursor = nextCursor;
    page++;

    // Polite delay: 1.2s between pages, 3s every 5 pages
    const delay = page % 5 === 0 ? 3000 : 1200;
    await new Promise(r => setTimeout(r, delay));
  }

  return allTweets;
}

