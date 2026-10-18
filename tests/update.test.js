import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateChecker, CHECK_INTERVAL } from '../src/update.js';

function harness(fetchFn, overrides = {}) {
    let cache = { lastAttempt: 0, state: 'unchecked' }, clock = CHECK_INTERVAL * 2;
    const states = [];
    const checker = createUpdateChecker({ fetchFn, headers: () => ({ 'X-CSRF-Token': 'test' }),
        installation: () => ({ extensionName: 'renamed-extension', global: false }), now: () => clock,
        getCache: () => cache, setCache: value => cache = value, onState: value => states.push(value), ...overrides });
    return { checker, states, cache: () => cache, tick: amount => clock += amount };
}
const response = (data = {}) => ({ ok: true, json: async () => ({ currentBranchName: 'main', currentCommitHash: 'a'.repeat(40), isUpToDate: true, ...data }) });
test('native update check caches attempts, allows manual refresh and never stores remote credentials', async () => {
    let calls = 0;
    const h = harness(async (url, options) => {
        calls++; assert.equal(url, '/api/extensions/version'); assert.equal(options.method, 'POST');
        assert.deepEqual(JSON.parse(options.body), { extensionName: 'renamed-extension', global: false });
        return response({ isUpToDate: false, remoteUrl: 'https://secret@example.org' });
    });
    assert.equal(await h.checker.check(), 'available'); await h.checker.check(); assert.equal(calls, 1);
    await h.checker.check(true); assert.equal(calls, 2); h.tick(CHECK_INTERVAL); await h.checker.check(); assert.equal(calls, 3);
    assert.doesNotMatch(JSON.stringify(h.cache()), /secret|remote/);
});
test('concurrent clicks join the same request', async () => {
    let resolve, calls = 0;
    const h = harness(() => { calls++; return new Promise(r => resolve = r); });
    const one = h.checker.check(), two = h.checker.check(true); assert.equal(one, two);
    resolve(response()); assert.equal(await one, 'current'); assert.equal(calls, 1);
});
for (const [label, fetchFn, expected] of [
    ['non git', async () => response({ currentBranchName: '', currentCommitHash: '' }), 'unmanaged'],
    ['malformed', async () => ({ ok: true, json: async () => ({ isUpToDate: true }) }), 'failed'],
    ['http failure', async () => ({ ok: false }), 'failed'],
    ['offline', async () => { throw new Error('private info'); }, 'failed'],
    ['json error', async () => ({ ok: true, json: async () => { throw new Error(); } }), 'failed'],
]) test(`update status: ${label}`, async () => {
    const h = harness(fetchFn); assert.equal(await h.checker.check(), expected);
    assert.equal(h.cache().state, expected); assert.notEqual(h.cache().lastAttempt, 0);
});
test('timeout aborts and reports failure, missing install type does not guess', async () => {
    const h = harness((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error()))), { timeoutMs: 5 });
    assert.equal(await h.checker.check(), 'failed');
    const missing = harness(() => { throw new Error('should not fetch'); }, { installation: () => null });
    assert.equal(await missing.checker.check(), 'unavailable');
});
