import axios from 'axios';
import fsExtra from 'fs-extra';
import path from 'path';

const { ensureDir, pathExists, createWriteStream } = fsExtra;

/**
 * Download all media for a tweet into outputDir.
 * Returns list of saved filenames (relative to outputDir).
 *
 * @param {object[]} mediaList - from parseTweet().media
 * @param {string} outputDir - absolute path to attachments folder
 * @param {string} tweetId
 * @returns {string[]} filenames saved
 */
export async function downloadMedia(mediaList, outputDir, tweetId) {
    if (!mediaList || mediaList.length === 0) return [];
    await ensureDir(outputDir);

    const saved = [];

    for (let i = 0; i < mediaList.length; i++) {
        const item = mediaList[i];
        const filename = `${tweetId}-${item.type}-${i + 1}.${item.ext}`;
        const destPath = path.join(outputDir, filename);

        // Skip if already downloaded (idempotent)
        if (await pathExists(destPath)) {
            saved.push(filename);
            continue;
        }

        try {
            await downloadFile(item.url, destPath);
            saved.push(filename);
        } catch (err) {
            console.warn(`  ⚠ Failed to download media ${filename}: ${err.message}`);
            // Continue without crashing
        }
    }

    return saved;
}

/**
 * Stream-download a URL to a local file path.
 */
async function downloadFile(url, destPath) {
    // For photos, append :orig to get original quality
    const finalUrl = url.endsWith('.jpg') || url.endsWith('.png') || url.endsWith('.webp')
        ? `${url}:orig`
        : url;

    const response = await axios.get(finalUrl, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'referer': 'https://x.com/',
        },
    });

    return new Promise((resolve, reject) => {
        const writer = createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });
}
