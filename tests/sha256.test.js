import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import legacy from 'js-sha256';
import { sha256 } from '../src/sha256.js';
import { requestIdentity, sameIdentity } from '../src/identity.js';
import { defaultSettings, addRule } from '../src/settings.js';
import { processRequest } from '../src/request.js';

const nodeHash = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('SHA-256 known answers, including multiple blocks and a million characters', () => {
    const vectors = [
        ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
        ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
        ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
    ];
    for (const [input, expected] of vectors) assert.equal(sha256(input), expected);
});

test('UTF-8 and padding boundaries agree with Node and the previous host library', () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1024]) {
        for (const unit of ['a', '汉', '😺', '\0', 'é']) {
            const input = unit.repeat(length);
            assert.equal(sha256(input), nodeHash(input));
            assert.equal(sha256(input), legacy.sha256(input));
        }
    }
    assert.throws(() => sha256(null), TypeError);
    assert.equal(sha256('abc'), sha256('abc')); // Independent calls have no shared state.
});

test('existing endpoint-v1 rules match and process requests with the bundled hash', () => {
    for (const endpoint of [
        'http://LOCALHOST:80/v1', 'https://example.invalid/v1/',
        'https://example.invalid/V1?q=1&b=2#part',
        'http://name:password@[::1]:11434/v1?key=example',
        'https://例子.测试/路径?字符=😺',
    ]) {
        const request = { type: 'normal', chat_completion_source: 'custom', custom_url: endpoint, model: 'example',
            custom_prompt_post_processing: 'merge', messages: [{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }] };
        const oldIdentity = requestIdentity(request, legacy.sha256);
        const newIdentity = requestIdentity(request, sha256);
        assert.deepEqual(newIdentity, oldIdentity);
        assert.ok(sameIdentity(newIdentity, oldIdentity));
        const settings = defaultSettings(); settings.enabled = true; addRule(settings, oldIdentity);
        const savedRules = structuredClone(settings.rules);
        assert.equal(processRequest(request, settings, { sha256 }).status, 'applied');
        assert.deepEqual(request.messages, [{ role: 'system', content: 'a\n\nb' }]);
        assert.deepEqual(settings.rules, savedRules);
    }
});
