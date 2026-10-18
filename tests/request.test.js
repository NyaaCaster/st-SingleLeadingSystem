import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { processRequest, checkCustomBody } from '../src/request.js';
import { requestIdentity } from '../src/identity.js';
import { defaultSettings, addRule } from '../src/settings.js';

const dependencies = { sha256: value => createHash('sha256').update(value).digest('hex'), parseYaml: YAML.parse };
const request = (source = 'custom', type = 'normal') => ({ type, chat_completion_source: source, custom_url: 'http://localhost:11434/v1', model: 'Qwen',
    messages: [{ role: 'system', content: 'main' }, { role: 'user', content: 'hi' }, { role: 'system', content: 'depth' }],
    custom_prompt_post_processing: 'merge', tools: [{ type: 'function' }], stream: true, max_tokens: 1000 });
const settingsFor = req => { const s = defaultSettings(); s.enabled = true; addRule(s, requestIdentity(req, dependencies.sha256)); return s; };

for (const source of ['custom', 'openai', 'openrouter']) for (const type of ['normal', 'regenerate', 'swipe', 'continue']) {
    test(`outbound ${source}/${type} changes only messages and this request post-processing`, () => {
        const req = request(source, type), settings = settingsFor(req); const before = structuredClone(req), config = structuredClone(settings);
        const result = processRequest(req, settings, dependencies);
        assert.equal(result.status, 'applied'); assert.equal(req.messages.at(-1).role, 'user'); assert.equal(req.custom_prompt_post_processing, '');
        const { messages, custom_prompt_post_processing, ...other } = req;
        const { messages: old, custom_prompt_post_processing: oldProcessing, ...oldOther } = before;
        assert.deepEqual(other, oldOther); assert.deepEqual(settings, config);
    });
}
for (const change of [req => req.type = 'quiet', req => req.type = 'impersonate', req => req.type = 'unknown',
    req => req.chat_completion_source = 'claude', req => req.model = 'other', req => req.custom_url += '/different']) {
    test('out-of-scope requests stay byte-equivalent and do not parse YAML', () => {
        const req = request(), settings = settingsFor(req); change(req); req.custom_include_body = '[';
        const before = structuredClone(req);
        assert.equal(processRequest(req, settings, dependencies).status, 'ignored'); assert.deepEqual(req, before);
    });
}
test('total and per-rule disable leave request unchanged', () => {
    for (const disable of [s => s.enabled = false, s => s.rules[0].enabled = false]) {
        const req = request(), settings = settingsFor(req), before = structuredClone(req); disable(settings);
        assert.equal(processRequest(req, settings, dependencies).status, 'ignored'); assert.deepEqual(req, before);
    }
});
for (const [field, value] of [
    ['custom_include_body', 'messages: []'], ['custom_include_body', '- temperature: 0.5\n- model: Qwen'],
    ['custom_include_body', '? !!str "messages"\n: []'], ['custom_include_body', '"mod\\u0065l": other'],
    ['custom_exclude_body', '[model, messages]'], ['custom_exclude_body', 'messages'], ['custom_exclude_body', 'model: true'],
    ['custom_include_body', '['], ['custom_exclude_body', '['],
]) test(`custom conflict/parse failure preserves request: ${field} ${value}`, () => {
    const req = request(), settings = settingsFor(req); req[field] = value;
    const before = structuredClone(req); const result = processRequest(req, settings, dependencies);
    assert.equal(result.status, 'skipped'); assert.deepEqual(req, before);
    assert.ok(['custom_conflict', 'custom_parse'].includes(result.code));
    assert.deepEqual(Object.keys(result).sort(), ['code', 'fields', 'index', 'status']);
});
test('custom nested keys and arbitrary other options are preserved', () => {
    const req = request(), settings = settingsFor(req);
    req.custom_include_body = 'temperature: 0.5\noptions:\n  model: nested\n  messages: not-top-level\nreasoning_effort: high';
    req.custom_exclude_body = '[frequency_penalty]';
    assert.equal(processRequest(req, settings, dependencies).status, 'applied');
    assert.match(req.custom_include_body, /reasoning_effort: high/);
    assert.doesNotThrow(() => checkCustomBody({ custom_include_body: '- model\n- 7\n- null' }, YAML.parse));
});
test('malformed messages, tool associations and readonly targets cannot partially update', () => {
    for (const mutate of [req => req.messages.push({ role: 'developer', content: 'secret prompt' }),
        req => req.messages.push({ role: 'tool', content: 'secret result', tool_call_id: 'missing' }),
        req => Object.defineProperty(req, 'custom_prompt_post_processing', { writable: false }), req => Object.freeze(req)]) {
        const req = request(), settings = settingsFor(req); mutate(req); const before = structuredClone(req);
        const result = processRequest(req, settings, dependencies);
        assert.equal(result.status, 'skipped'); assert.deepEqual(req, before); assert.doesNotMatch(JSON.stringify(result), /secret/);
    }
});
test('already compliant request still disables post-processing and conversion is idempotent', () => {
    const req = request(), settings = settingsFor(req); req.messages = [{ role: 'user', content: 'hello' }];
    assert.equal(processRequest(req, settings, dependencies).status, 'applied'); assert.equal(req.custom_prompt_post_processing, '');
    const before = structuredClone(req); processRequest(req, settings, dependencies); assert.deepEqual(req, before);
});
