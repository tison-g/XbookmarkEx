import fs from 'fs-extra';
import path from 'path';
import { classifyTweet } from './src/ai/classifier.js';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

// Category → Emoji mapping for richer index presentation
const CATEGORY_EMOJI = {
    'AI与机器学习': '🤖',
    '编程与开发': '💻',
    '设计与创意': '🎨',
    '科技资讯': '📡',
    '商业与创业': '💼',
    '生活与娱乐': '🎯',
    '股票与投资': '📈',
    '学习与教育': '📚',
    'Openclaw专题': '🦞',
    '其他': '📦',
};

// Helper to safely parse YAML frontmatter and content
function parseMarkdown(content) {
    const yamlRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)/;
    const match = content.match(yamlRegex);
    if (!match) return { frontmatter: {}, text: content, rawYaml: null };

    const yamlStr = match[1];
    const text = match[2];

    // Naive parsing of known fields, keep the rest as string structure
    const frontmatter = {};
    const lines = yamlStr.split('\n');
    let inTags = false;
    let tagsList = [];

    lines.forEach(line => {
        if (line.startsWith('tags:')) {
            inTags = true;
            return;
        }
        if (inTags && line.trim().startsWith('-')) {
            tagsList.push(line.replace('-', '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
            return;
        } else if (inTags && line.trim() !== '') {
            inTags = false;
        }

        if (!inTags && line.includes(':')) {
            const idx = line.indexOf(':');
            const key = line.substring(0, idx).trim();
            const val = line.substring(idx + 1).trim();
            frontmatter[key] = val.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
        }
    });

    if (tagsList.length > 0) {
        frontmatter.tags = tagsList;
    }

    return { frontmatter, text, rawYaml: yamlStr };
}

// Rebuild frontmatter with updated fields
function serializeMarkdown(frontmatter, rawYaml, category, subcategory, tags, summary, text) {
    let resultYaml = rawYaml;

    // We will append/replace our new fields into the raw yaml string to preserve other properties
    const toRemove = ['category:', 'subcategory:', 'summary:'];
    let lines = rawYaml.split('\n');

    // remove old keys
    lines = lines.filter(line => !toRemove.some(r => line.startsWith(r)));

    // rebuild tags block
    let newTags = new Set((frontmatter.tags || []));
    tags.forEach(t => newTags.add(t));
    newTags = Array.from(newTags);

    // remove old tags logic
    let tempLines = [];
    let inTags = false;
    for (const line of lines) {
        if (line.startsWith('tags:')) {
            inTags = true;
            continue;
        }
        if (inTags && line.trim().startsWith('-')) continue;
        if (inTags && line.trim() !== '') inTags = false;

        if (!inTags) tempLines.push(line);
    }
    lines = tempLines;

    const newFields = [
        `category: "${category}"`,
        `subcategory: "${subcategory}"`,
        `summary: "${summary.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        'tags:'
    ];
    newTags.forEach(t => newFields.push(`  - ${t}`));

    return `---\n${lines.join('\n')}\n${newFields.join('\n')}\n---\n${text}`;
}

async function getAllMarkdownFiles(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await getAllMarkdownFiles(filePath));
        } else if (file.endsWith('.md') && file !== '00_Root_Index.md') {
            results.push(filePath);
        }
    }
    return results;
}

// To build the Index at the end
let indexData = {}; // { category: { subcategory: [ { filename, summary, tags } ] } }

// Helper to delay
const delay = ms => new Promise(res => setTimeout(res, ms));

async function main() {
    console.log('Loading config...');
    const config = await fs.readJson(CONFIG_PATH);
    const apiKey = config.gemini.api_key;
    const model = config.gemini.model || 'gemini-2.5-flash';

    // Resolve BOOKMARKS_DIR from config instead of hardcoding
    const BOOKMARKS_DIR = path.resolve(config.output?.vault_path || '../XBookmarks');
    const INDEX_FILE = path.join(BOOKMARKS_DIR, '00_Root_Index.md');

    console.log(`Scanning directory: ${BOOKMARKS_DIR}`);
    const files = await getAllMarkdownFiles(BOOKMARKS_DIR);
    console.log(`Found ${files.length} markdown files to process.`);

    // Pre-build a map of all attachments currently in XBookmarks
    console.log('Building attachment map...');
    const attachmentMap = {}; // filename -> absolute path
    async function scanAttachments(dir) {
        const list = await fs.readdir(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            const stat = await fs.stat(filePath);
            if (stat && stat.isDirectory()) {
                await scanAttachments(filePath);
            } else if (!file.endsWith('.md')) { // Non-markdown files are treated as attachments
                attachmentMap[file] = filePath;
            }
        }
    }
    await scanAttachments(BOOKMARKS_DIR);

    let processedCount = 0;

    for (const filePath of files) {
        const filename = path.basename(filePath);
        const content = await fs.readFile(filePath, 'utf8');

        const { frontmatter, text, rawYaml } = parseMarkdown(content);

        let { category, subcategory, tags, summary } = frontmatter;

        // Skip calling API if we already have the new classification scheme and it's not the fallback "其他" one
        const isFallback = category === '其他' && subcategory === '默认分类' && (!summary || summary.trim() === '');
        if (subcategory && summary && category && !isFallback) {
            console.log(`[SKIP] ${filename} already has subcategory & summary.`);
            tags = frontmatter.tags || [];
        } else {
            console.log(`[PROCESS] ${filename}... calling Gemini`);
            let inputToGemini = (frontmatter.name || '') + '\\n' + text.substring(0, 1500);

            let result = await classifyTweet(inputToGemini, apiKey, model);
            category = result.category;
            subcategory = result.subcategory;
            tags = result.tags;
            summary = result.summary;

            const newContent = serializeMarkdown(frontmatter, rawYaml, category, subcategory, tags, summary, text);

            // Move markdown file to new location
            const newDir = path.join(BOOKMARKS_DIR, category, subcategory);
            await fs.ensureDir(newDir);

            const newFilePath = path.join(newDir, filename);
            await fs.writeFile(newFilePath, newContent, 'utf8');

            if (filePath !== newFilePath) {
                await fs.remove(filePath);
            }

            // --- Move Attachments ---
            // Look for Obsidian embeds like ![[image.jpg]] or ![[image.png|300]]
            const embedRegex = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
            let match;
            const attachmentsDir = path.join(newDir, 'attachments');

            while ((match = embedRegex.exec(text)) !== null) {
                const attachName = match[1].trim();
                const oldAttachPath = attachmentMap[attachName];

                if (oldAttachPath) {
                    await fs.ensureDir(attachmentsDir);
                    const newAttachPath = path.join(attachmentsDir, attachName);

                    if (oldAttachPath !== newAttachPath) {
                        try {
                            await fs.move(oldAttachPath, newAttachPath, { overwrite: true });
                            console.log(`  -> Moved attachment ${attachName}`);
                            // Update map so we know its new location
                            attachmentMap[attachName] = newAttachPath;
                        } catch (err) {
                            console.error(`  -> Failed to move attachment ${attachName}: ${err.message}`);
                        }
                    }
                }
            }

            processedCount++;

            // Limit rate to avoid killing free-tier API quotas
            await delay(1000);
        }

        // Add to index
        if (!indexData[category]) indexData[category] = {};
        if (!indexData[category][subcategory]) indexData[category][subcategory] = [];

        const noteRef = `[[${filename.replace('.md', '')}]]`;
        indexData[category][subcategory].push({
            noteRef,
            summary: summary || '暂无摘要'
        });
    }

    // Build Index.md
    console.log('Generating Index.md...');
    let indexContent = `# 🗂️ XBookmarks 知识库索引\n\n> [!info] 知识管理概览\n> 这是从 X/Twitter 导出的书签的精准分类归档。按照最新分类自动生成。\n\n`;

    for (const cat of Object.keys(indexData).sort()) {
        const emoji = CATEGORY_EMOJI[cat] || '📄';
        indexContent += `## ${emoji} ${cat}\n`;
        for (const sub of Object.keys(indexData[cat]).sort()) {
            indexContent += `### ${sub}\n`;
            for (const item of indexData[cat][sub]) {
                indexContent += `- ${item.noteRef} : *${item.summary}*\n`;
            }
            indexContent += `\n`;
        }
    }

    await fs.writeFile(INDEX_FILE, indexContent, 'utf8');

    // Clean up empty directories from the old structure
    console.log('Cleaning up empty folders...');
    async function cleanEmptyDirs(dir) {
        if (!await fs.pathExists(dir)) return;
        const list = await fs.readdir(dir);
        for (const file of list) {
            const fp = path.join(dir, file);
            const st = await fs.stat(fp);
            if (st.isDirectory()) {
                await cleanEmptyDirs(fp);
            }
        }
        // check again after possible children deletion
        const currentList = await fs.readdir(dir);
        if (currentList.length === 0 && dir !== BOOKMARKS_DIR) {
            await fs.remove(dir);
        }
    }
    await cleanEmptyDirs(BOOKMARKS_DIR);

    console.log(`\n🎉 Processing complete! Processed ${processedCount} files. Index created at ${INDEX_FILE}`);
}

main().catch(console.error);
