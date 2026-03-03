import fsExtra from 'fs-extra';
import path from 'path';

const { readJson, writeJson, pathExists } = fsExtra;

const STATE_FILENAME = '.xbookmarkex-state.json';

function getStatePath(vaultPath) {
    return path.join(vaultPath, STATE_FILENAME);
}

/**
 * Load state from vault. Returns default if not found.
 * @param {string} vaultPath
 * @returns {{ exportedIds: string[], lastRun: string|null }}
 */
export async function loadState(vaultPath) {
    const statePath = getStatePath(vaultPath);
    if (!(await pathExists(statePath))) {
        return { exportedIds: [], lastRun: null };
    }
    try {
        const state = await readJson(statePath);
        return {
            exportedIds: Array.isArray(state.exportedIds) ? state.exportedIds : [],
            lastRun: state.lastRun ?? null,
        };
    } catch {
        return { exportedIds: [], lastRun: null };
    }
}

/**
 * Save state to vault.
 */
export async function saveState(vaultPath, state) {
    const statePath = getStatePath(vaultPath);
    await writeJson(statePath, state, { spaces: 2 });
}

/**
 * Check if a tweet ID was already exported.
 */
export function isExported(state, tweetId) {
    return state.exportedIds.includes(tweetId);
}

/**
 * Mark a tweet ID as exported (mutates state in-place).
 */
export function markExported(state, tweetId) {
    if (!state.exportedIds.includes(tweetId)) {
        state.exportedIds.push(tweetId);
    }
}
