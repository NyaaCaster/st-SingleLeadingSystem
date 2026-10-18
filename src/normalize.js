import { CompatibilityError, isRecord } from './errors.js';

const roles = new Set(['system', 'user', 'assistant', 'tool']);
const examples = { example_user: 'user', example_assistant: 'assistant' };
const fail = (code, index) => { throw new CompatibilityError(code, index); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

function systemText(message, index) {
    const example = Object.hasOwn(examples, message.name) ? examples[message.name] : null;
    const keys = example ? ['role', 'content', 'name'] : ['role', 'content'];
    if (Object.keys(message).some(key => !keys.includes(key))) fail('system_metadata', index);
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.content)) fail('system_content', index);
    for (const part of message.content) {
        if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string'
            || Object.keys(part).some(key => !['type', 'text'].includes(key))) {
            fail('system_content', index);
        }
    }
    return message.content.map(part => part.text).join('');
}

/** Check structural tool pairing only. Never execute tools or parse their arguments. */
function validate(messages) {
    if (!Array.isArray(messages) || !messages.length) fail('messages_shape', null);
    let pending = new Set();
    const texts = new Map();
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (!isRecord(message) || !roles.has(message.role)) fail('message_role', index);
        if (Object.hasOwn(message, 'function_call')) fail('legacy_function', index);
        if (pending.size && message.role !== 'tool') fail('tool_interrupted', index);
        if (message.role !== 'tool' && Object.hasOwn(message, 'tool_call_id')) fail('tool_pairing', index);
        if (message.role === 'system') {
            texts.set(index, systemText(message, index));
            continue;
        }
        const calls = message.tool_calls;
        const hasCalls = Object.hasOwn(message, 'tool_calls');
        if (hasCalls && (message.role !== 'assistant' || !Array.isArray(calls) || !calls.length)) {
            fail('tool_calls', index);
        }
        const content = message.content;
        const validContent = typeof content === 'string' || (Array.isArray(content)
            && content.every(part => isRecord(part) && nonempty(part.type)));
        if (!validContent && !(hasCalls && content == null)) fail('message_content', index);
        if (hasCalls) {
            for (const call of calls) {
                if (!isRecord(call) || !nonempty(call.id) || pending.has(call.id)
                    || call.type !== 'function' || !isRecord(call.function)
                    || !nonempty(call.function.name) || typeof call.function.arguments !== 'string') {
                    fail('tool_calls', index);
                }
                pending.add(call.id);
            }
        }
        if (message.role === 'tool') {
            if (!nonempty(message.tool_call_id) || !pending.delete(message.tool_call_id)) fail('tool_pairing', index);
        }
    }
    if (pending.size) fail('tool_missing_results', messages.length - 1);
    return texts;
}

/** Pure conversion. Ordinary messages (including tools/media/reasoning) keep their identity. */
export function normalizeMessages(messages) {
    const texts = validate(messages);
    const stats = { leading: 0, merged: 0, demoted: 0, examples: 0 };
    const result = [];
    let inPrefix = true;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role !== 'system') {
            inPrefix = false;
            result.push(message);
        } else if (Object.hasOwn(examples, message.name)) {
            inPrefix = false;
            stats.examples++;
            result.push({ role: examples[message.name], content: message.content });
        } else if (inPrefix) {
            stats.leading++;
            if (stats.leading === 1) result.push({ role: 'system', content: texts.get(index) });
            else {
                result[0].content += '\n\n' + texts.get(index);
                stats.merged++;
            }
        } else {
            stats.demoted++;
            result.push({ role: 'user', content: message.content });
        }
    }
    return { messages: result, stats };
}
