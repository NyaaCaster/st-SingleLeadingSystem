import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeMessages } from '../src/normalize.js';
import { requestIdentity, sameIdentity } from '../src/identity.js';
import { addRule, defaultSettings, readSettings } from '../src/settings.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const s = content => ({ role: 'system', content });
const u = content => ({ role: 'user', content });
const a = content => ({ role: 'assistant', content });
const toolCall = id => ({ id, type: 'function', function: { name: 'roll_coc', arguments: '{}' } });
const block = () => [{ role: 'assistant', content: null, tool_calls: [toolCall('a'), toolCall('b')], reasoning: 'kept' },
    { role: 'tool', content: '2', tool_call_id: 'b' }, { role: 'tool', content: '1', tool_call_id: 'a' }];
const id = (overrides = {}) => requestIdentity({ chat_completion_source: 'custom', custom_url: 'http://localhost:11434/v1', model: 'Qwen', ...overrides }, hash);

test('position priority preserves depth, whitespace and original ordinary messages', () => {
    const user = u('hello'), assistant = a('answer');
    const input = [s(' A '), s('B'), user, s('depth'), assistant, s('tail')];
    const snapshot = structuredClone(input);
    const output = normalizeMessages(input);
    assert.deepEqual(output.messages, [s(' A \n\nB'), user, u('depth'), assistant, u('tail')]);
    assert.equal(output.messages[1], user);
    assert.deepEqual(input, snapshot);
    assert.deepEqual(output.stats, { leading: 2, merged: 1, demoted: 2, examples: 0 });
    assert.deepEqual(normalizeMessages(output.messages).messages, output.messages);
});
test('examples end the leading prefix before system merging', () => {
    const output = normalizeMessages([s('main'), { ...s('example question'), name: 'example_user' },
        { ...s('example answer'), name: 'example_assistant' }, s('new chat'), u('real')]);
    assert.deepEqual(output.messages, [s('main'), u('example question'), a('example answer'), u('new chat'), u('real')]);
    assert.equal(output.stats.examples, 2);
});
test('text blocks concatenate without invented characters, empty texts stay, no fabricated system', () => {
    assert.deepEqual(normalizeMessages([s([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), s('')]).messages, [s('ab\n\n')]);
    assert.deepEqual(normalizeMessages([a('prefill'), s('continue')]).messages, [a('prefill'), u('continue')]);
    assert.deepEqual(normalizeMessages([u('only')]).messages, [u('only')]);
});
test('tool blocks, media, names and reasoning signatures remain untouched', () => {
    const media = { ...u([{ type: 'image_url', image_url: { url: 'data:example' } }, { type: 'input_audio', input_audio: {} }]), name: 'player', extra: { private: 1 } };
    const tools = block(); const input = [s('main'), media, s('depth'), ...tools, s('tail')];
    const output = normalizeMessages(input).messages;
    assert.equal(output[1], media); tools.forEach((message, i) => assert.equal(output[3 + i], message));
    assert.deepEqual(output.at(-1), u('tail'));
    assert.deepEqual(normalizeMessages([...tools, ...block()]).messages, [...tools, ...block()]);
});
for (const [label, messages] of [
    ['empty request', []], ['unknown role', [{ role: 'developer', content: 'x' }]],
    ['named system', [{ ...s('x'), name: 'other' }]], ['metadata', [{ ...s('x'), cache_control: {} }]],
    ['system media', [s([{ type: 'image_url', image_url: {} }])]],
    ['text metadata', [s([{ type: 'text', text: 'x', cache_control: {} }])]],
    ['broken content', [u(null)]], ['tool missing', [block()[0]]], ['orphan result', [block()[1]]],
    ['interrupted tool', [block()[0], s('injected'), ...block().slice(1)]],
    ['duplicate result', [...block(), block()[1]]],
    ['duplicate call', [{ role: 'assistant', tool_calls: [toolCall('a'), toolCall('a')] }]],
    ['old function', [{ ...a('x'), function_call: {} }]],
]) test(`rejects ${label} without any mutation`, () => {
    const snapshot = structuredClone(messages);
    assert.throws(() => normalizeMessages(messages));
    assert.deepEqual(messages, snapshot);
});
test('URL identity normalizes only URL syntax and keeps endpoint distinctions', () => {
    assert.ok(sameIdentity(id({ custom_url: 'HTTP://LOCALHOST:80/v1' }), id({ custom_url: 'http://localhost/v1' })));
    for (const custom_url of ['http://localhost:11434/v1/', 'http://localhost:11434/V1', 'https://localhost:11434/v1', 'http://localhost:11434/v1?q=1']) {
        assert.equal(sameIdentity(id(), id({ custom_url })), false);
    }
    assert.equal(sameIdentity(id(), id({ model: 'qwen' })), false);
    assert.equal(sameIdentity(id(), id({ chat_completion_source: 'openai', reverse_proxy: 'http://localhost:11434/v1' })), false);
});
test('identity never persists path, query, credentials or raw address', () => {
    const identity = id({ custom_url: 'http://person:secret@example.com:9876/private/path?token=secret' });
    assert.equal(identity.endpointOrigin, 'http://example.com:9876');
    assert.equal(identity.endpointHash.length, 64);
    assert.doesNotMatch(JSON.stringify(identity), /secret|private|token|person/);
});
test('invalid source, model, URL and hash fail without leaking URL', () => {
    for (const overrides of [{ model: '' }, { chat_completion_source: 'claude' }, { custom_url: 'secret-value' }, { custom_url: 'file:///secret' }]) {
        assert.throws(() => id(overrides), error => !error.message.includes('secret'));
    }
});
test('settings default disabled, duplicate add does not re-enable, invalid/future schema read-only', () => {
    const settings = defaultSettings(); addRule(settings, id()); settings.rules[0].enabled = false;
    assert.equal(addRule(settings, id()), 0); assert.equal(settings.rules.length, 1);
    assert.equal(settings.enabled, false); assert.equal(settings.rules[0].enabled, false);
    assert.deepEqual(readSettings(settings), { settings, error: null });
    for (const raw of [null, {}, { ...settings, schemaVersion: 2 }, { ...settings, rules: [{}] }]) {
        const snapshot = structuredClone(raw); const result = readSettings(raw);
        assert.ok(result.error); assert.equal(result.settings.enabled, false); assert.deepEqual(raw, snapshot);
    }
    assert.equal(readSettings(undefined).error, null);
});
