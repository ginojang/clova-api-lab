import { getCurrentSystemPrompt, getCurrentTools } from '../../harness-lab/pi/node_modules/@earendil-works/pi-ai/dist/index.js';
import { LabError } from './store.mjs';

const textContent = content => typeof content === 'string' ? content : (content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');

/** Replay the actual Pi transcript, including section/tool deltas, for Brain. */
export function brainRequest(messages) {
  const systemPrompt = getCurrentSystemPrompt(messages);
  const translated = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      if (Array.isArray(message.content) && message.content.some(item => item.type !== 'text')) throw new LabError('unsupported', 'The Brain adapter supports text-only user messages');
      translated.push({ role: 'user', content: textContent(message.content) });
    } else if (message.role === 'assistant') {
      const toolCalls = message.content.filter(item => item.type === 'toolCall').map(item => ({ id: item.id, type: 'function', function: { name: item.name, arguments: structuredClone(item.arguments) } }));
      translated.push({ role: 'assistant', content: textContent(message.content), ...(toolCalls.length ? { toolCalls } : {}), ...(message.providerReasoning ? { providerReasoning: structuredClone(message.providerReasoning) } : {}) });
    } else if (message.role === 'toolResult') {
      if (!message.toolCallId) throw new LabError('invalid_tool_result', 'Tool results need their original toolCallId');
      if (message.content.some(item => item.type !== 'text')) throw new LabError('unsupported', 'The Brain adapter supports text-only tool results');
      translated.push({ role: 'tool', toolCallId: message.toolCallId, content: textContent(message.content) });
    } else throw new LabError('unsupported', 'Unexpected Pi message role');
  }
  const tools = getCurrentTools(messages).map(tool => ({ name: tool.name, description: tool.description, inputSchema: structuredClone(tool.parameters) }));
  return { messages: translated, tools, systemPrompt };
}

export function transportForModel(model) {
  if (model === 'scripted') return 'none';
  const provider = model.split(':')[0];
  const variable = { clova: 'CLOVA_BASE_URL', groq: 'GROQ_BASE_URL', openrouter: 'OPENROUTER_BASE_URL', zai: 'ZAI_BASE_URL' }[provider];
  const override = variable && process.env[variable];
  if (!override) return 'remote';
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(override).hostname) ? 'loopback' : 'remote'; }
  catch { throw new LabError('configuration', 'Invalid model endpoint URL'); }
}
