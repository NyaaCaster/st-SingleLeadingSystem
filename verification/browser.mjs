// Local mock host only. Never starts SillyTavern or contacts a model provider.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installPath = '/scripts/extensions/third-party/renamed-extension/';
let updateMode = 'available', updateRequests = [];
const eventNames = ['CHAT_COMPLETION_SETTINGS_READY', 'SETTINGS_LOADED', 'SETTINGS_LOADED_AFTER', 'EXTENSION_SETTINGS_LOADED',
    'CONNECTION_PROFILE_LOADED', 'CHATCOMPLETION_SOURCE_CHANGED', 'CHATCOMPLETION_MODEL_CHANGED', 'MAIN_API_CHANGED', 'OAI_PRESET_CHANGED_AFTER', 'APP_READY'];
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Single Leading System mock host</title><link rel="stylesheet" href="${installPath}style.css">
<style>:root{color-scheme:dark;--SmartThemeBodyColor:#deded2;--SmartThemeBlurTintColor:#262626;--SmartThemeBorderColor:#60605a}*{box-sizing:border-box}body{margin:0;background:#1e1e1e;color:#deded2;font:15px/1.6 system-ui}#extensions_settings{max-width:620px;margin:20px auto;padding:15px;background:#262626}.inline-drawer-header{display:flex;align-items:center;cursor:pointer}.inline-drawer-icon{margin-left:auto}.inline-drawer-content{display:none}.checkbox_label{display:flex;align-items:center;gap:7px}button,input{font:inherit;color:inherit}button{background:#30302d;border:1px solid #60605a;border-radius:4px;padding:5px 10px;cursor:pointer}input.text_pole{padding:7px;background:#20201e;border:1px solid #60605a;border-radius:4px}</style>
<div id="extensions_settings"></div><input id="custom_api_url_text" hidden>
<script>
const listeners = new Map(); window.hookListeners=listeners;
window.toastMessages=[];window.saveCount=0;window.confirmChoice=true;window.drawerHandlers=new WeakMap();
window.hostContext={mainApi:'openai',extensionSettings:{disabledExtensions:[]},eventTypes:Object.fromEntries(${JSON.stringify(eventNames)}.map(x=>[x,x])),
 eventSource:{on(name,fn){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn)},makeLast(name,fn){this.on(name,fn)},async emit(name,data){for(const fn of [...(listeners.get(name)||[])])await fn(data)}},
 saveSettingsDebounced(){window.saveCount++},getRequestHeaders(){return {'Content-Type':'application/json','X-CSRF-Token':'mock-csrf'}},Popup:{show:{confirm:async()=>window.confirmChoice}}};
window.SillyTavern={getContext:()=>window.hostContext};window.toastr=Object.fromEntries(['info','warning','error'].map(k=>[k,(text)=>window.toastMessages.push({kind:k,text})]));
window.jQuery=element=>({on(name,handler){window.drawerHandlers.set(element,handler)}});
document.addEventListener('click',event=>{const header=event.target.closest('.inline-drawer-toggle');if(!header)return;const drawer=header.parentElement;const icon=header.querySelector('.inline-drawer-icon');const open=!icon.classList.contains('up');icon.classList.toggle('up',open);icon.classList.toggle('down',!open);window.drawerHandlers.get(drawer)?.();drawer.querySelector('.inline-drawer-content').style.display=open?'block':'none'});
</script><script type="module">await import('${installPath}index.js');window.entryImported=true;</script></html>`;

const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (text, type = 'text/javascript') => { res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(text); };
    try {
        if (url.pathname === '/') return send(html, 'text/html');
        // SillyTavern 1.15.0 exports YAML but no SHA-256. Keep the entire UI/request suite on that boundary.
        if (url.pathname === '/lib.js') return send("import yaml from '/node_modules/yaml/browser/index.js'; export {yaml};");
        if (url.pathname === '/scripts/openai.js') return send("export const oai_settings={chat_completion_source:'custom',custom_url:'http://person:private-secret@localhost:11434/v1?secret=token',custom_model:'Qwen3.6-35B:Q4-K-M',custom_prompt_post_processing:'merge'};export const getChatCompletionModel=()=>oai_settings.custom_model;window.mockOai=oai_settings;");
        if (url.pathname === '/scripts/extensions.js') return send("export const extensionTypes={'third-party/renamed-extension':'local'};window.mockExtensionTypes=extensionTypes;");
        if (url.pathname === '/api/extensions/version') {
            let body = ''; for await (const chunk of req) body += chunk;
            updateRequests.push({ body: JSON.parse(body), csrf: req.headers['x-csrf-token'] });
            if (updateMode === 'failed') { res.writeHead(503); return res.end(); }
            return send(JSON.stringify({ currentBranchName: updateMode === 'unmanaged' ? '' : 'main',
                currentCommitHash: updateMode === 'unmanaged' ? '' : 'a'.repeat(40), isUpToDate: updateMode !== 'available',
                remoteUrl: 'https://private-remote@example.invalid/repo.git' }), 'application/json');
        }
        const relative = url.pathname.startsWith(installPath) ? url.pathname.slice(installPath.length)
            : url.pathname.startsWith('/node_modules/') ? url.pathname.slice(1) : null;
        if (!relative) { res.writeHead(404); return res.end(); }
        const path = resolve(root, decodeURIComponent(relative));
        if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404); return res.end(); }
        return send(await readFile(path), extname(path) === '.css' ? 'text/css' : extname(path) === '.html' ? 'text/html' : extname(path) === '.json' ? 'application/json' : 'text/javascript');
    } catch { res.writeHead(404); res.end(); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executablePath = candidates.find(existsSync);
let browser;
const results = [];
try {
    assert.ok(executablePath, 'Set CHROME_PATH to a Chrome/Chromium executable.');
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 850, height: 1400 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
        if (!route.request().url().startsWith(address + '/')) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
    });
    const find = key => page.locator(`[data-sls="${key}"]`);
    const emit = async (options = {}) => page.evaluate(async options => {
        const request={ type:'normal', chat_completion_source:'custom', custom_url:mockOai.custom_url, model:mockOai.custom_model,
            custom_prompt_post_processing:'merge', messages:[{role:'system',content:'main'},{role:'system',content:'world'},
                {role:'user',content:[{type:'image_url',image_url:{url:'data:example'}}]},{role:'system',content:'depth'}], ...options };
        const before=structuredClone(request); await hostContext.eventSource.emit('CHAT_COMPLETION_SETTINGS_READY',request); return {before,request};
    }, options);
    await page.goto(address); await page.waitForFunction(() => window.hookListeners?.get('CHAT_COMPLETION_SETTINGS_READY')?.length === 1);
    await page.locator('.inline-drawer-header').click(); await page.waitForFunction(() => document.querySelector('[data-sls="update-status"]').textContent.includes('有可用更新'));
    assert.equal(await page.locator('#sls-enabled').isChecked(), false);
    assert.equal(await page.locator('.sls-warning strong').count(), 3);
    assert.equal(await page.locator('aside.sls-warning p').first().innerText(), '本插件不是破甲插件，是给自部署的 Qwen3.6 / Qwen3.5 模型做酒馆提示词结构兼容。');
    assert.ok(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('aside.sls-warning')).fontSize)
        < parseFloat(getComputedStyle(document.querySelector('#sls-settings')).fontSize)));
    assert.equal(await page.evaluate(async () => typeof (await import('/lib.js')).sha256), 'undefined');
    const initialText = await page.locator('#sls-settings').innerText();
    assert.ok(!/private-secret|secret=|person:/.test(initialText));
    results.push('宿主无 SHA-256 时真实入口正常加载；默认停用、三条提示顺序和缩小字号、敏感地址不展示');

    await find('add').click(); assert.equal(await page.locator('#sls-enabled').isChecked(), false);
    await find('add').click(); assert.equal(await page.locator('.sls-rule').count(), 1);
    await page.locator('.sls-rule .text_pole').fill('本地模型 <img src=x onerror=alert(1)>');
    await page.locator('#sls-enabled').check();
    const transformed = await emit();
    assert.deepEqual(transformed.request.messages.map(x => x.role), ['system', 'user', 'user']);
    assert.equal(transformed.request.messages[0].content, 'main\n\nworld'); assert.equal(transformed.request.custom_prompt_post_processing, '');
    assert.equal(await page.locator('.sls-rule img').count(), 0);
    const config = await page.evaluate(() => JSON.stringify(hostContext.extensionSettings));
    assert.ok(!/private-secret|secret=|private-remote/.test(config));
    assert.ok(config.includes('本地模型'));
    results.push('添加/重复添加/备注/总开关可用；真实发送事件完成结构转换和本次后处理关闭');

    const conflict = await emit({ custom_include_body: 'messages: []' });
    assert.deepEqual(conflict.request, conflict.before); assert.match(await find('result').innerText(), /本次未合并.*messages/);
    const warningCount = await page.evaluate(() => toastMessages.length); await emit({ custom_include_body: 'messages: []' });
    assert.equal(await page.evaluate(() => toastMessages.length), warningCount);
    const bad = await emit({ custom_include_body: '[' }); assert.deepEqual(bad.request, bad.before);
    const quiet = await emit({ type: 'quiet' }); assert.deepEqual(quiet.request, quiet.before);
    results.push('覆盖冲突、YAML 失败原请求保留，提示原因与重复提示节流；quiet 不介入');

    await page.evaluate(async () => { mockOai.custom_model='other<img>';await hostContext.eventSource.emit('CHATCOMPLETION_MODEL_CHANGED'); });
    assert.equal(await page.locator('.sls-rule').count(), 1); assert.match(await find('match').innerText(), /尚未添加/);
    const other = await emit(); assert.deepEqual(other.request, other.before);
    await find('add').click(); assert.equal(await page.locator('.sls-rule').count(), 2); assert.equal(await page.locator('.sls-rule img').count(), 0);
    await page.evaluate(() => window.confirmChoice=false); await page.locator('.sls-rule button').last().click(); assert.equal(await page.locator('.sls-rule').count(), 2);
    await page.evaluate(() => window.confirmChoice=true); await page.locator('.sls-rule button').last().click(); await page.waitForFunction(() => document.querySelectorAll('.sls-rule').length === 1);
    await page.evaluate(async () => { mockOai.custom_model='Qwen3.6-35B:Q4-K-M';await hostContext.eventSource.emit('CHATCOMPLETION_MODEL_CHANGED'); });
    await page.locator('.sls-rule input[type=checkbox]').uncheck(); const ruleOff = await emit(); assert.deepEqual(ruleOff.request, ruleOff.before);
    await page.locator('.sls-rule input[type=checkbox]').check();
    await page.evaluate(() => hostContext.extensionSettings.disabledExtensions.push('third-party/renamed-extension'));
    const hostOff = await emit(); assert.deepEqual(hostOff.request, hostOff.before);
    await page.evaluate(() => hostContext.extensionSettings.disabledExtensions=[]);
    results.push('切换模型保留旧规则、单规则停用、删除确认和取消、宿主禁用均验证');

    await page.evaluate(async () => { hostContext.mainApi='textgenerationwebui';await hostContext.eventSource.emit('MAIN_API_CHANGED'); });
    assert.equal(await find('add').isDisabled(), true);
    await page.evaluate(async () => { hostContext.mainApi='openai';await hostContext.eventSource.emit('MAIN_API_CHANGED'); });
    const requestsBefore=updateRequests.length;
    await page.locator('.inline-drawer-header').click(); await page.locator('.inline-drawer-header').click();
    assert.equal(updateRequests.length, requestsBefore);
    updateMode='failed'; await find('check').click(); await page.waitForFunction(() => document.querySelector('[data-sls="update-status"]').textContent.includes('检查失败'));
    updateMode='unmanaged'; await find('check').click(); await page.waitForFunction(() => document.querySelector('[data-sls="update-status"]').textContent.includes('非 Git'));
    updateMode='current'; await page.evaluate(() => mockExtensionTypes['third-party/renamed-extension']='global');
    await find('check').click(); await page.waitForFunction(() => document.querySelector('[data-sls="update-status"]').textContent.includes('无需更新'));
    assert.equal(updateRequests.at(-1).body.global, true);
    assert.ok(updateRequests.every(x => x.body.extensionName==='renamed-extension' && x.csrf==='mock-csrf'));
    results.push('原生更新接口：展开节流、手动失败、非 Git、全局安装及 CSRF 头正确');

    await page.evaluate(async () => {
        window.goodConfig=structuredClone(hostContext.extensionSettings['st-single-leading-system']);
        hostContext.extensionSettings['st-single-leading-system']={schemaVersion:99,enabled:true,rules:[]};
        await hostContext.eventSource.emit('SETTINGS_LOADED');
    });
    assert.equal(await page.locator('#sls-enabled').isDisabled(), true);
    const future = await emit(); assert.deepEqual(future.request, future.before);
    assert.equal(await page.evaluate(() => hostContext.extensionSettings['st-single-leading-system'].schemaVersion), 99);
    await page.evaluate(async () => { hostContext.extensionSettings['st-single-leading-system']=window.goodConfig;await hostContext.eventSource.emit('SETTINGS_LOADED'); });
    results.push('未知配置版本保持原值、禁用编辑且不改请求');

    const toolMessages = [{role:'system',content:'main'}, {role:'user',content:'roll'},
        {role:'assistant',content:null,reasoning:'keep-thinking',signature:'keep-signature',tool_calls:[
            {id:'roll-1',type:'function',function:{name:'roll_coc',arguments:'{}'}}]},
        {role:'tool',tool_call_id:'roll-1',content:'42'}, {role:'system',content:'summarize'}];
    const tools = await emit({ messages: toolMessages });
    assert.deepEqual(tools.request.messages.slice(0,4), toolMessages.slice(0,4));
    assert.equal(tools.request.messages.at(-1).role,'user');
    const interrupted = await emit({ messages:[...toolMessages.slice(0,3),{role:'system',content:'interrupt'},...toolMessages.slice(3)] });
    assert.deepEqual(interrupted.request,interrupted.before);
    await page.locator('.sls-rule .text_pole').fill('本地模型');
    results.push('工具续轮中的调用、结果、思考及签名保持；工具块穿插消息时整次跳过');

    await emit();
    for (const width of [850, 375]) {
        await page.setViewportSize({ width, height: 1200 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}`);
        if (process.env.SLS_SCREENSHOT_DIR) await page.screenshot({ path: resolve(process.env.SLS_SCREENSHOT_DIR, `actual-ui-${width}.png`), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push('850px / 375px 页面无横向溢出；无浏览器脚本异常、无外网/模型请求');

    const unavailablePage = await browser.newPage();
    await unavailablePage.route('**/lib.js', route => route.fulfill({ contentType:'text/javascript', body:'export const yaml={};' }));
    await unavailablePage.goto(address);
    await unavailablePage.waitForFunction(() => document.querySelector('[data-sls="unavailable"]')?.hidden === false);
    assert.equal(await unavailablePage.locator('#sls-enabled').isDisabled(),true);
    assert.equal(await unavailablePage.evaluate(() => (hookListeners.get('CHAT_COMPLETION_SETTINGS_READY') || []).length),0);
    await unavailablePage.close();
    results.push('缺失宿主核心能力时显示不可用、不注册发送处理');
    console.log(results.map((line, i) => `${i + 1}. PASS ${line}`).join('\n'));
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
