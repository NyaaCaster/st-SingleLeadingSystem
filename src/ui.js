import { SOURCES, sameIdentity } from './identity.js';

const reasons = {
    source: '此接口入口不在首版支持范围。请使用聊天补全的自定义 OpenAI 兼容、OpenAI 或 OpenRouter。',
    main_api: '请切换到聊天补全。Ollama 请使用自定义 OpenAI 兼容 /v1 接入。',
    model: '尚未选择有效模型。', endpoint: '服务地址无效或不是 HTTP/HTTPS 地址。',
    hash_unavailable: '地址指纹计算失败。',
    settings_schema: '配置版本无法读取，插件已停用且保留原配置。请检查插件版本。',
    settings_rules: '规则配置损坏，插件已停用且保留原配置。',
    messages_shape: '消息数组为空或格式无效。', message_role: '消息包含不支持的角色。',
    message_content: '消息正文格式无法识别。', system_metadata: '系统消息包含其他名称或特殊元数据。',
    system_content: '系统消息包含非文本内容或特殊文本块。', legacy_function: '不支持旧版 function_call 格式。',
    tool_interrupted: '工具调用与结果之间插入了其他消息。', tool_calls: '工具调用结构不完整。',
    tool_pairing: '工具结果与调用无法一一对应。', tool_missing_results: '工具调用缺少对应结果。',
    request_readonly: '请求字段不可写，无法安全提交转换。',
    custom_conflict: '自定义请求体覆盖或删除了受保护字段。', custom_parse: '自定义请求体参数无法解析。',
    unexpected: '处理遇到异常，未修改请求。', host_unavailable: '当前酒馆缺少插件所需能力，插件未接入发送流程。',
};
export const reasonText = result => (reasons[result.code] || reasons.unexpected)
    + (Number.isInteger(result.index) ? `（第 ${result.index + 1} 条消息）` : '')
    + (result.fields?.length ? ` 字段：${result.fields.join('、')}。` : '');
const updateLabels = { unchecked: '尚未检查', checking: '正在检查当前安装分支…', available: '当前安装分支有可用更新。',
    current: '检查时，当前安装分支无需更新。', failed: '检查失败，请稍后手动重试。',
    unmanaged: '此安装方式无法检查更新（非 Git 安装）。', unavailable: '无法确定安装位置或宿主缺少检查能力。' };
const labelFor = identity => `${identity.endpointOrigin} · #${identity.endpointHash.slice(0, 8)}`;

/** Dynamic values are always text nodes, including model IDs and user notes. */
export function createUI(root, actions) {
    const get = key => root.querySelector(`[data-sls="${key}"]`);
    const toggle = root.querySelector('#sls-enabled');
    let current = null;
    const field = (tag, className, text) => { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; };
    toggle.addEventListener('change', () => actions.setEnabled(toggle.checked));
    get('add').addEventListener('click', () => actions.add());
    get('check').addEventListener('click', () => actions.check());
    const header = root.querySelector('.inline-drawer-header');
    header.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); header.click(); }
    });
    return {
        render(settings, identity, error = null, connectionError = null) {
            current = identity;
            toggle.checked = settings.enabled; toggle.disabled = Boolean(error);
            get('enabled-status').textContent = error ? '不可用' : settings.enabled ? '已启用' : '已停用';
            get('unavailable').hidden = !error;
            get('unavailable').textContent = error ? reasonText({ code: error }) : '';
            get('source').textContent = identity ? SOURCES[identity.source] : '—';
            get('origin').textContent = identity ? labelFor(identity) : '—';
            get('model').textContent = identity?.model || '—';
            const match = settings.rules.find(rule => sameIdentity(rule, identity));
            get('match').textContent = !identity ? '无法添加' : match ? (match.enabled ? '规则匹配' : '规则已停用') : '尚未添加';
            get('add').disabled = Boolean(error || !identity);
            get('add').textContent = match ? '查看已有规则' : '添加当前连接与模型';
            get('connection-help').textContent = connectionError ? reasonText({ code: connectionError })
                : '先在酒馆连接面板选择接口和模型，再添加规则。完整地址只保存匹配指纹。';
            get('count').textContent = `${settings.rules.length} 条`;
            get('empty').hidden = settings.rules.length > 0;
            get('rules').replaceChildren();
            settings.rules.forEach((rule, index) => {
                const box = field('div', 'sls-rule', ''); box.dataset.ruleIndex = String(index);
                box.classList.toggle('sls-current', sameIdentity(rule, current));
                const row = field('div', 'sls-row sls-between', '');
                const label = field('label', 'checkbox_label', '');
                const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = rule.enabled; checkbox.disabled = Boolean(error);
                checkbox.addEventListener('change', () => actions.toggleRule(index, checkbox.checked));
                label.append(checkbox, document.createTextNode('启用此规则'));
                const remove = field('button', 'menu_button', '移除'); remove.type = 'button'; remove.disabled = Boolean(error);
                remove.addEventListener('click', () => actions.remove(index)); row.append(label, remove);
                const note = document.createElement('input'); note.className = 'text_pole'; note.type = 'text'; note.value = rule.note;
                note.maxLength = 80; note.placeholder = '连接备注（可选）'; note.disabled = Boolean(error); note.setAttribute('aria-label', '连接备注');
                note.addEventListener('input', () => actions.note(index, note.value));
                box.append(row, note, field('div', 'sls-rule-meta', `${SOURCES[rule.source]} · ${labelFor(rule)}`),
                    field('div', 'sls-rule-model', rule.model));
                get('rules').append(box);
            });
        },
        focusRule(index) {
            const box = get('rules').querySelector(`[data-rule-index="${index}"]`);
            box?.scrollIntoView({ block: 'nearest' }); box?.querySelector('input[type="text"]')?.focus();
        },
        result(result) {
            const target = get('result'); target.dataset.state = result.status;
            if (result.status === 'applied') {
                const s = result.stats;
                target.textContent = `已完成结构处理：开头 ${s.leading} 条系统消息${s.leading > 0 ? '保留为 1 条' : '，未新增系统消息'}；${s.demoted} 条中途系统消息原位转为用户消息；恢复 ${s.examples} 条示例角色。本次后处理已关闭。`;
            } else if (result.status === 'skipped') {
                target.textContent = `本次未合并：${reasonText(result)} 已保留原请求和后处理设置，酒馆继续原流程。`;
            } else {
                target.textContent = '本次未介入：插件停用、规则未匹配或该生成类型不在范围内。';
            }
        },
        update(state) {
            get('update-status').textContent = updateLabels[state] || updateLabels.failed;
            get('update-badge').hidden = state !== 'available'; get('check').disabled = state === 'checking';
        },
        version(version) { get('version').textContent = version ? `v${version}` : '版本未知'; },
        expanded(open) { header.setAttribute('aria-expanded', String(open)); },
    };
}
