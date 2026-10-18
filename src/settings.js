import { isRecord } from './errors.js';
import { SOURCES, sameIdentity } from './identity.js';

export const SETTINGS_KEY = 'st-single-leading-system';
export const defaultSettings = () => ({ schemaVersion: 1, enabled: false, rules: [], updateCheck: { lastAttempt: 0, state: 'unchecked' } });
export const UPDATE_STATES = new Set(['unchecked', 'available', 'current', 'failed', 'unmanaged', 'unavailable']);

function safeRule(rule) {
    if (!isRecord(rule) || !Object.hasOwn(SOURCES, rule.source)
        || typeof rule.model !== 'string' || !rule.model.trim()
        || !/^[a-f0-9]{64}$/.test(rule.endpointHash)) return null;
    let origin;
    try {
        const url = new URL(rule.endpointOrigin);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        origin = url.origin;
    } catch { return null; }
    return { source: rule.source, endpointHash: rule.endpointHash, endpointOrigin: origin,
        model: rule.model, enabled: rule.enabled === true,
        note: typeof rule.note === 'string' ? rule.note.slice(0, 80) : '' };
}

/** A malformed/future schema is read-only. Do not replace it with defaults on disk. */
export function readSettings(raw) {
    if (raw === undefined) return { settings: defaultSettings(), error: null };
    if (!isRecord(raw) || raw.schemaVersion !== 1 || typeof raw.enabled !== 'boolean' || !Array.isArray(raw.rules)) {
        return { settings: defaultSettings(), error: 'settings_schema' };
    }
    const rules = raw.rules.map(safeRule);
    if (rules.some(rule => !rule) || rules.some((rule, i) => rules.slice(0, i).some(other => sameIdentity(rule, other)))) {
        return { settings: defaultSettings(), error: 'settings_rules' };
    }
    const check = raw.updateCheck;
    return { settings: { schemaVersion: 1, enabled: raw.enabled, rules,
        updateCheck: { lastAttempt: Number.isFinite(check?.lastAttempt) && check.lastAttempt >= 0 ? check.lastAttempt : 0,
            state: UPDATE_STATES.has(check?.state) ? check.state : 'unchecked' } }, error: null };
}

export function addRule(settings, identity) {
    const existing = settings.rules.findIndex(rule => sameIdentity(rule, identity));
    if (existing !== -1) return existing;
    settings.rules.push({ ...identity, enabled: true, note: '' });
    return settings.rules.length - 1;
}
