import axios from 'axios';

/**
 * Fetch the X homepage HTML and extract main JS bundle URL.
 */
async function getMainJsBundleUrl() {
    const res = await axios.get('https://x.com/', {
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'accept': 'text/html',
        },
        timeout: 15000,
    });
    const html = res.data;
    // Find main JS bundle
    const match = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[^"]+\.js/);
    return match ? match[0] : null;
}

/**
 * Dynamically discover the Bookmarks GraphQL query ID from X's JS bundle.
 * Falls back to a cached ID if discovery fails.
 */
export async function discoverBookmarksQueryId(cookies) {
    // Strategy 1: Try fetching the JS bundle and regex-searching for Bookmarks queryId
    try {
        const bundleUrl = await getMainJsBundleUrl();
        if (bundleUrl) {
            const res = await axios.get(bundleUrl, {
                headers: {
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                timeout: 30000,
            });
            const js = res.data;
            // Pattern: {queryId:"XXXX",operationName:"Bookmarks"
            const match = js.match(/\{queryId:"([^"]+)",operationName:"Bookmarks"/);
            if (match) {
                return match[1];
            }
            // Alternative pattern
            const match2 = js.match(/operationName:"Bookmarks"[^}]+queryId:"([^"]+)"/);
            if (match2) {
                return match2[1];
            }
        }
    } catch (e) {
        // fall through to strategy 2
    }

    // Strategy 2: Try fetching the client-route map file which also has queryIds
    try {
        const res = await axios.get('https://x.com/', {
            headers: {
                'user-agent': 'Mozilla/5.0',
                'accept': 'application/json',
                'x-twitter-active-user': 'yes',
                'x-twitter-auth-type': 'OAuth2Session',
                'cookie': `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}`,
                'x-csrf-token': cookies.ct0,
            },
            timeout: 15000,
        });
        const html = res.data;
        // Look for any graphql JS file that might contain query IDs
        const scripts = html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"]+\.js/g) || [];
        for (const scriptUrl of scripts.slice(0, 5)) {
            try {
                const jsRes = await axios.get(scriptUrl, { timeout: 20000 });
                const match = jsRes.data.match(/\{queryId:"([^"]+)",operationName:"Bookmarks"/);
                if (match) return match[1];
            } catch { }
        }
    } catch { }

    // If all discovery fails, return null (caller should handle)
    return null;
}
