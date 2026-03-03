import fsExtra from 'fs-extra';
import path from 'path';
import { createReadStream } from 'fs';
import chalk from 'chalk';
import cliProgress from 'cli-progress';

import { fetchAllBookmarks } from './twitter/api.js';
import { parseTweet } from './twitter/parser.js';
import { downloadMedia } from './exporter/media.js';
import { saveBookmark, getAttachmentsDir } from './exporter/markdown.js';
import { classifyTweet } from './ai/classifier.js';
import { loadState, saveState, isExported, markExported } from './storage/state.js';

const { readJson, ensureDir } = fsExtra;

// ── Parse CLI arguments ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const FULL_EXPORT = args.includes('--full');
const SKIP_MEDIA = args.includes('--no-media');
const SKIP_AI = args.includes('--no-ai');

// ── Load & validate config ────────────────────────────────────────────────────
async function loadConfig() {
    const configPath = path.resolve('config.json');
    let config;
    try {
        config = await readJson(configPath);
    } catch {
        console.error(chalk.red('✗ Cannot read config.json. Make sure it exists in the project root.'));
        process.exit(1);
    }

    const errors = [];
    if (!config.twitter?.auth_token || config.twitter.auth_token.startsWith('PASTE')) {
        errors.push('twitter.auth_token');
    }
    if (!config.twitter?.ct0 || config.twitter.ct0.startsWith('PASTE')) {
        errors.push('twitter.ct0');
    }
    if (!SKIP_AI && (!config.gemini?.api_key || config.gemini.api_key.startsWith('PASTE'))) {
        errors.push('gemini.api_key');
    }
    if (!config.output?.vault_path) {
        errors.push('output.vault_path');
    }

    if (errors.length > 0) {
        console.error(chalk.red(`✗ Missing or unconfigured fields in config.json:`));
        errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        console.error(chalk.yellow('\nSee README.md for setup instructions.'));
        process.exit(1);
    }

    return config;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(chalk.bold.cyan('\n📚 XbookmarkEx — X Bookmark Exporter\n'));

    const config = await loadConfig();
    const cookies = config.twitter;
    const vaultPath = path.resolve(config.output.vault_path);
    const attachmentsFolder = config.output.attachments_folder ?? 'attachments';

    await ensureDir(vaultPath);

    // Load incremental state
    const state = FULL_EXPORT
        ? { exportedIds: [], lastRun: null }
        : await loadState(vaultPath);

    if (FULL_EXPORT) {
        console.log(chalk.yellow('⚡ Full export mode: all bookmarks will be re-exported.\n'));
    } else if (state.lastRun) {
        console.log(chalk.gray(`  Last run: ${state.lastRun}\n`));
    }

    // Fetch bookmarks
    console.log(chalk.blue('⬇ Fetching bookmarks from X...'));
    let totalFetched = 0;

    const rawTweets = await fetchAllBookmarks(cookies, (tweets, page) => {
        totalFetched += tweets.length;
        process.stdout.write(`\r  Fetched ${totalFetched} bookmarks (page ${page})...`);
    });
    console.log(`\r${chalk.green('✓')} Fetched ${chalk.bold(rawTweets.length)} bookmarks total.\n`);

    // Parse tweets
    const tweets = rawTweets
        .map(raw => parseTweet(raw))
        .filter(Boolean);

    // Filter new ones
    const newTweets = FULL_EXPORT
        ? tweets
        : tweets.filter(t => !isExported(state, t.id));

    const skipped = tweets.length - newTweets.length;

    if (newTweets.length === 0) {
        console.log(chalk.green('✓ No new bookmarks to export. Everything is up to date!'));
        state.lastRun = new Date().toISOString();
        await saveState(vaultPath, state);
        return;
    }

    console.log(chalk.blue(`📝 Exporting ${chalk.bold(newTweets.length)} new bookmarks`) +
        (skipped > 0 ? chalk.gray(` (${skipped} already exported, skipped)`) : '') + '\n');

    // Progress bar
    const bar = new cliProgress.SingleBar({
        format: '  [{bar}] {percentage}% | {value}/{total} | {tweet}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
    }, cliProgress.Presets.shades_classic);

    bar.start(newTweets.length, 0, { tweet: '' });

    let exported = 0;
    let failed = 0;

    for (const tweet of newTweets) {
        const shortText = tweet.text.slice(0, 40).replace(/\n/g, ' ');
        bar.update(exported, { tweet: `@${tweet.author.screenName}: ${shortText}…` });

        try {
            // 1. Classify with AI
            const classification = SKIP_AI
                ? { category: '其他', tags: [] }
                : await classifyTweet(tweet.text, config.gemini.api_key);

            // Small delay to respect Gemini rate limits
            if (!SKIP_AI) await new Promise(r => setTimeout(r, 300));

            // 2. Download media
            let savedMedia = [];
            if (!SKIP_MEDIA && tweet.media.length > 0) {
                const attachDir = getAttachmentsDir(vaultPath, classification.category, attachmentsFolder);
                savedMedia = await downloadMedia(tweet.media, attachDir, tweet.id);
            }

            // 3. Save markdown
            await saveBookmark(tweet, vaultPath, classification, savedMedia, attachmentsFolder);

            // 4. Mark as exported
            markExported(state, tweet.id);
            exported++;
        } catch (err) {
            failed++;
            bar.update(exported, { tweet: chalk.red(`✗ ${tweet.id}: ${err.message}`) });
        }

        bar.update(exported);
    }

    bar.stop();

    // Save state
    state.lastRun = new Date().toISOString();
    await saveState(vaultPath, state);

    // Summary
    console.log('');
    console.log(chalk.bold.green(`✓ 导出完成！`));
    console.log(`  ${chalk.green('●')} 新导出：${chalk.bold(exported)} 条`);
    if (skipped > 0) console.log(`  ${chalk.gray('●')} 已跳过：${skipped} 条（增量）`);
    if (failed > 0) console.log(`  ${chalk.red('●')} 失败：${failed} 条`);
    console.log(`  ${chalk.blue('●')} 保存位置：${vaultPath}\n`);
}

main().catch(err => {
    console.error(chalk.red(`\n✗ 运行出错：${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
});
