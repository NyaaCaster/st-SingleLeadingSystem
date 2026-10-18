import { SETTINGS_KEY, readSettings, addRule } from './src/settings.js';
import { requestIdentity } from './src/identity.js';
import { processRequest } from './src/request.js';
import { createUpdateChecker } from './src/update.js';
import { createUI, reasonText } from './src/ui.js';
import { diagnostic } from './src/errors.js';
import { sha256 } from './src/sha256.js';

const folder = new URL('.', import.meta.url);
const extensionId = decodeURIComponent(folder.pathname.split('/scripts/extensions/')[1]?.replace(/\/$/, '') || '');
const directoryName = extensionId.split('/').at(-1);

async function initialize() {
    if (document.getElementById('sls-settings')) return;
    const context = () => globalThis.SillyTavern?.getContext?.();
    const ctx = context();
    const container = document.querySelector('#extensions_settings');
    if (!container) throw new Error('host_unavailable');
    const response = await fetch(new URL('settings.html', folder));
    if (!response.ok) throw new Error('settings_load');
    const template = document.createElement('template'); template.innerHTML = await response.text();
    const root = template.content.firstElementChild; container.append(root);
    let ui, settings, settingsError, unavailable = false;
    let libs, openai, extensions;
    try {
        [libs, openai, extensions] = await Promise.all([
            import('../../../../lib.js'), import('../../../openai.js'), import('../../../extensions.js'),
        ]);
    } catch { unavailable = true; }
    if (!ctx?.extensionSettings || typeof ctx?.saveSettingsDebounced !== 'function'
        || !ctx?.eventTypes?.CHAT_COMPLETION_SETTINGS_READY || typeof ctx?.eventSource?.on !== 'function'
        || typeof libs?.yaml?.parse !== 'function'
        || typeof openai?.getChatCompletionModel !== 'function' || !openai?.oai_settings) unavailable = true;

    function reload() {
        ({ settings, error: settingsError } = readSettings(context()?.extensionSettings?.[SETTINGS_KEY]));
    }
    function persist() {
        if (unavailable || settingsError) return;
        context().extensionSettings[SETTINGS_KEY] = settings;
        context().saveSettingsDebounced();
    }
    function currentIdentity() {
        if (unavailable) return { error: 'host_unavailable' };
        if (context().mainApi !== 'openai') return { error: 'main_api' };
        try {
            return { identity: requestIdentity({ chat_completion_source: openai.oai_settings.chat_completion_source,
                model: openai.getChatCompletionModel(), custom_url: openai.oai_settings.custom_url,
                reverse_proxy: openai.oai_settings.reverse_proxy }, sha256) };
        } catch (error) { return { error: diagnostic(error).code }; }
    }
    function render() {
        const current = currentIdentity();
        ui.render(settings, current.identity, unavailable ? 'host_unavailable' : settingsError, current.error);
    }
    const toast = (text, kind = 'info') => globalThis.toastr?.[kind]?.(text, '系统消息合并', { timeOut: 6000, escapeHtml: true });
    let checker;
    ui = createUI(root, {
        setEnabled(value) { if (unavailable || settingsError) return; settings.enabled = value; persist(); render(); },
        add() {
            if (unavailable || settingsError) return;
            const current = currentIdentity();
            if (!current.identity) { render(); return; }
            const index = addRule(settings, current.identity); persist(); render(); ui.focusRule(index);
        },
        toggleRule(index, value) { if (settingsError || unavailable) return; settings.rules[index].enabled = value; persist(); render(); },
        note(index, value) { if (settingsError || unavailable) return; settings.rules[index].note = value.slice(0, 80); persist(); },
        async remove(index) {
            if (settingsError || unavailable) return;
            const rule = settings.rules[index];
            const confirm = context()?.Popup?.show?.confirm;
            const approved = confirm ? await confirm('移除规则', '移除此连接与模型的规则？该操作不会修改酒馆连接设置。')
                : globalThis.confirm('移除此连接与模型的规则？');
            if (!approved || settingsError || unavailable) return;
            const currentIndex = settings.rules.indexOf(rule);
            if (currentIndex >= 0) { settings.rules.splice(currentIndex, 1); persist(); render(); }
        },
        check() { void checker?.check(true); },
    });
    reload(); render();
    const installation = () => {
        const type = extensions?.extensionTypes?.[extensionId];
        return ['global', 'local'].includes(type) && directoryName && ctx?.getRequestHeaders
            ? { extensionName: directoryName, global: type === 'global' } : null;
    };
    let volatileCache = { ...settings.updateCheck };
    checker = createUpdateChecker({ fetchFn: (...args) => fetch(...args), headers: () => context().getRequestHeaders(), installation,
        getCache: () => volatileCache, setCache(cache) { volatileCache = cache; if (!settingsError && !unavailable) { settings.updateCheck = cache; persist(); } },
        onState: state => ui.update(state) });
    ui.update(volatileCache.state);
    fetch(new URL('manifest.json', folder)).then(result => result.ok ? result.json() : null)
        .then(manifest => ui.version(typeof manifest?.version === 'string' ? manifest.version : null)).catch(() => ui.version(null));

    const jq = globalThis.jQuery;
    if (jq) jq(root.querySelector('.inline-drawer')).on('inline-drawer-toggle.sls', () => {
        const open = root.querySelector('.inline-drawer-icon')?.classList.contains('up');
        ui.expanded(open);
        if (open) { reload(); volatileCache = { ...settings.updateCheck }; render(); void checker.check(); }
    });
    if (unavailable) return;
    const refresh = () => { reload(); render(); };
    const refreshEvents = ['SETTINGS_LOADED', 'SETTINGS_LOADED_AFTER', 'EXTENSION_SETTINGS_LOADED', 'CONNECTION_PROFILE_LOADED',
        'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'MAIN_API_CHANGED', 'OAI_PRESET_CHANGED_AFTER', 'APP_READY'];
    for (const key of refreshEvents) if (ctx.eventTypes[key]) ctx.eventSource.on(ctx.eventTypes[key], refresh);
    let scheduled = false;
    const change = event => {
        if (root.contains(event.target)) return;
        if (event.target?.matches?.('#custom_api_url_text, #openai_reverse_proxy, #chat_completion_source, #main_api, [id*="model"]')) {
            if (!scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; refresh(); }); }
        }
    };
    document.addEventListener('input', change); document.addEventListener('change', change);
    let lastWarning = '', lastWarningAt = 0;
    const handler = request => {
        if (context().extensionSettings.disabledExtensions?.includes(extensionId)) return;
        // Read the latest configuration, including edits made through settings import/profile changes.
        reload();
        const result = settingsError ? { status: 'skipped', code: settingsError } : processRequest(request, settings, {
            sha256, parseYaml: libs.yaml.parse,
        });
        ui.result(result);
        if (result.status === 'skipped') {
            const key = JSON.stringify(result), time = Date.now();
            if (key !== lastWarning || time - lastWarningAt >= 10000) {
                toast(`本次未合并：${reasonText(result)} 酒馆将继续原发送流程。`, 'warning');
                lastWarning = key; lastWarningAt = time;
            }
        }
    };
    // The host awaits listeners. makeLast only sets today's order, not a permanent final hook.
    if (typeof ctx.eventSource.makeLast === 'function') ctx.eventSource.makeLast(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, handler);
    else ctx.eventSource.on(ctx.eventTypes.CHAT_COMPLETION_SETTINGS_READY, handler);
}

function boot() {
    initialize().catch(() => {
        globalThis.toastr?.error?.('系统消息合并未能加载，未接入请求处理。请检查酒馆版本与扩展文件。', '系统消息合并');
        console.warn('[st-single-leading-system] Initialization failed; request hook was not installed.');
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
