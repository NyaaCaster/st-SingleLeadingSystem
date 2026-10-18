import { CompatibilityError } from './errors.js';

export const SOURCES = Object.freeze({ custom: '自定义 OpenAI 兼容', openai: 'OpenAI', openrouter: 'OpenRouter' });
export const TYPES = new Set(['normal', 'regenerate', 'swipe', 'continue']);
const DEFAULT_ENDPOINTS = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
};

/** URL.hash is deliberately included: do not silently equate distinct configured URLs. */
export function requestIdentity(request, sha256) {
    const source = request?.chat_completion_source;
    if (!Object.hasOwn(SOURCES, source)) throw new CompatibilityError('source');
    const model = request.model;
    if (typeof model !== 'string' || !model.trim()) throw new CompatibilityError('model');
    const raw = source === 'custom' ? request.custom_url
        : source === 'openai' ? (request.reverse_proxy || DEFAULT_ENDPOINTS.openai) : DEFAULT_ENDPOINTS.openrouter;
    let url;
    try {
        if (typeof raw !== 'string' || !raw.trim()) throw new Error();
        url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
        throw new CompatibilityError('endpoint');
    }
    const endpointHash = sha256(JSON.stringify(['endpoint-v1', url.href]));
    if (!/^[a-f0-9]{64}$/.test(endpointHash)) throw new CompatibilityError('hash_unavailable');
    return { source, model, endpointHash, endpointOrigin: url.origin };
}

export const sameIdentity = (left, right) => Boolean(left && right && left.source === right.source
    && left.endpointHash === right.endpointHash && left.model === right.model);
