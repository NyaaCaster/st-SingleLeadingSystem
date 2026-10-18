import { CompatibilityError, diagnostic, isRecord } from './errors.js';
import { SOURCES, TYPES, requestIdentity, sameIdentity } from './identity.js';
import { normalizeMessages } from './normalize.js';

const protectedFields = new Set(['messages', 'model']);

function parseParameter(value, parseYaml, field) {
    if (!value) return undefined;
    try {
        if (typeof value !== 'string') throw new Error();
        // Silence parser warnings: they can contain user-supplied YAML snippets.
        return parseYaml(value, { logLevel: 'error' });
    } catch { throw new CompatibilityError('custom_parse', null, [field]); }
}

/** Mirrors the backend's shallow Object.assign and top-level deletion semantics. */
export function checkCustomBody(request, parseYaml) {
    const include = parseParameter(request.custom_include_body, parseYaml, 'custom_include_body');
    const exclude = parseParameter(request.custom_exclude_body, parseYaml, 'custom_exclude_body');
    const objects = Array.isArray(include) ? include.filter(isRecord) : isRecord(include) ? [include] : [];
    const included = objects.flatMap(object => Object.keys(object));
    const excluded = Array.isArray(exclude) ? exclude.map(key => String(key))
        : isRecord(exclude) ? Object.keys(exclude) : typeof exclude === 'string' ? [exclude] : [];
    const conflicts = [...new Set([...included, ...excluded].filter(key => protectedFields.has(key)))].sort();
    if (conflicts.length) throw new CompatibilityError('custom_conflict', null, conflicts);
}

function checkWritable(request, key) {
    const descriptor = Object.getOwnPropertyDescriptor(request, key);
    if (descriptor ? !Object.hasOwn(descriptor, 'value') || !descriptor.writable : !Object.isExtensible(request)) {
        throw new CompatibilityError('request_readonly');
    }
}

/** Synchronous event handler core: no network, retry, tools or configuration writes. */
export function processRequest(request, settings, { sha256, parseYaml }) {
    if (!settings.enabled) return { status: 'ignored', code: 'disabled' };
    if (!isRecord(request) || !TYPES.has(request.type) || !Object.hasOwn(SOURCES, request.chat_completion_source)) {
        return { status: 'ignored', code: 'scope' };
    }
    try {
        const identity = requestIdentity(request, sha256);
        if (!settings.rules.some(rule => rule.enabled && sameIdentity(rule, identity))) return { status: 'ignored', code: 'unmatched' };
        if (identity.source === 'custom') checkCustomBody(request, parseYaml);
        const normalized = normalizeMessages(request.messages);
        checkWritable(request, 'messages');
        checkWritable(request, 'custom_prompt_post_processing');
        // Both targets are own writable data properties (or extensible slots), with no await between writes.
        Object.defineProperties(request, {
            messages: { writable: true, enumerable: true, configurable: true, ...Object.getOwnPropertyDescriptor(request, 'messages'), value: normalized.messages },
            custom_prompt_post_processing: { writable: true, enumerable: true, configurable: true, ...Object.getOwnPropertyDescriptor(request, 'custom_prompt_post_processing'), value: '' },
        });
        return { status: 'applied', stats: normalized.stats };
    } catch (error) {
        return { status: 'skipped', ...diagnostic(error) };
    }
}
