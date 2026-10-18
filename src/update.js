export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;

/** Checks the installed branch through SillyTavern. Never invokes /update. */
export function createUpdateChecker({ fetchFn, headers, installation, getCache, setCache, onState,
    now = Date.now, timeoutMs = 20000 }) {
    let pending = null;
    const emit = state => { onState?.(state); return state; };
    async function run() {
        const started = now();
        setCache({ lastAttempt: started, state: 'failed' });
        emit('checking');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let state = 'failed';
        try {
            const installed = installation();
            if (!installed) state = 'unavailable';
            else {
                const response = await fetchFn('/api/extensions/version', {
                    method: 'POST', headers: headers(), body: JSON.stringify(installed), signal: controller.signal,
                });
                if (!response.ok) throw new Error();
                const data = await response.json();
                if (!data || typeof data.currentBranchName !== 'string' || typeof data.currentCommitHash !== 'string'
                    || typeof data.isUpToDate !== 'boolean') throw new Error();
                if (!data.currentBranchName && !data.currentCommitHash) state = 'unmanaged';
                else if (!data.currentBranchName || !/^[a-f0-9]{7,64}$/i.test(data.currentCommitHash)) throw new Error();
                else state = data.isUpToDate ? 'current' : 'available';
            }
        } catch { state = 'failed'; }
        finally { clearTimeout(timer); }
        setCache({ lastAttempt: started, state });
        return emit(state);
    }
    return {
        check(manual = false) {
            if (pending) return pending;
            const cache = getCache();
            const elapsed = now() - cache.lastAttempt;
            if (!manual && cache.lastAttempt > 0 && elapsed >= 0 && elapsed < CHECK_INTERVAL) {
                return Promise.resolve(emit(cache.state));
            }
            pending = run().finally(() => { pending = null; });
            return pending;
        },
    };
}
