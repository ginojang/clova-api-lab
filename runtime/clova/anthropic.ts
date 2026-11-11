import type {Answer, Message, Tool, ToolCall} from './common.ts';

type ObjectValue = Record<string, unknown>;
export class AnthropicInputError extends Error {
  status = 400;
  code = 'invalid_request';
}
export type AnthropicRequest = {model: string; messages: Message[]; tools: Tool[]; stream: boolean; maxTokens: number};
type TextBlock = {type: 'text'; text: string};
type ToolBlock = {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>};
export type AnthropicMessage = {
  id: string; type: 'message'; role: 'assistant'; model: string; content: (TextBlock | ToolBlock)[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens'; stop_sequence: null;
  usage: {input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number};
};
export type AnthropicEvent = {type: string; [key: string]: unknown};

function object(value: unknown, name: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AnthropicInputError(`${name} must be an object.`);
  return value as ObjectValue;
}
function fields(value: ObjectValue, allowed: string[], name: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new AnthropicInputError(`${name} contains unsupported fields.`);
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new AnthropicInputError(`${name} must be text.`);
  return value;
}
function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new AnthropicInputError(`${name} must be a nonempty identifier.`);
  return value;
}
function toolName(value: unknown): string {
  const name = identifier(value, 'tool name');
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) throw new AnthropicInputError('Tool name has an invalid format.');
  return name;
}
function noCache(value: ObjectValue) {
  if (value.cache_control != null) throw new AnthropicInputError('Prompt caching is unsupported; set DISABLE_PROMPT_CACHING=1.');
}
function textBlocks(value: unknown, name: string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) throw new AnthropicInputError(`${name} must contain text blocks.`);
  return value.map(v => {
    const block = object(v, name); noCache(block); fields(block, ['type', 'text', 'cache_control'], name);
    if (block.type !== 'text') throw new AnthropicInputError(`${name} supports text only; images, documents and thinking are unsupported.`);
    return text(block.text, name);
  }).join('\n');
}

/** Translate the supported text/function subset; no agent loop or tool execution lives here. */
export function parseAnthropicRequest(value: unknown, models: readonly string[]): AnthropicRequest {
  const input = object(value, 'request');
  if (input.thinking !== undefined) {
    const thinking = object(input.thinking, 'thinking');
    if (thinking.type !== 'disabled' || Object.keys(thinking).some(k => k !== 'type')) throw new AnthropicInputError('Thinking is unsupported; set MAX_THINKING_TOKENS=0.');
  }
  if (input.output_config !== undefined) throw new AnthropicInputError('output_config is unsupported; set CLAUDE_CODE_EFFORT_LEVEL=unset and disable experimental betas.');
  for (const key of ['context_management', 'container', 'mcp_servers']) {
    if (input[key] !== undefined) throw new AnthropicInputError('Output configuration, context management and server tools are unsupported; disable experimental betas.');
  }
  noCache(input);
  fields(input, ['model', 'messages', 'system', 'tools', 'stream', 'max_tokens', 'temperature', 'thinking', 'metadata', 'tool_choice', 'stop_sequences', 'cache_control'], 'request');
  const model = identifier(input.model, 'model');
  if (!models.includes(model)) throw new AnthropicInputError('Requested model is not enabled.');
  if (input.stream !== undefined && typeof input.stream !== 'boolean') throw new AnthropicInputError('stream must be a boolean.');
  if (!Number.isInteger(input.max_tokens) || (input.max_tokens as number) < 1 || (input.max_tokens as number) > 2048) throw new AnthropicInputError('max_tokens must be 1–2048; set CLAUDE_CODE_MAX_OUTPUT_TOKENS=2048.');
  if (input.temperature !== undefined && input.temperature !== 0) throw new AnthropicInputError('Only temperature:0 is supported.');
  if (input.stop_sequences !== undefined && (!Array.isArray(input.stop_sequences) || input.stop_sequences.length)) throw new AnthropicInputError('Custom stop sequences are unsupported.');
  if (input.metadata !== undefined) {
    // Client attribution has no inference semantics and is deliberately not forwarded to CLOVA.
    const metadata = object(input.metadata, 'metadata'); fields(metadata, ['user_id'], 'metadata');
    if (metadata.user_id !== undefined && metadata.user_id !== null) text(metadata.user_id, 'metadata.user_id');
  }
  if (input.tool_choice !== undefined) {
    const choice = object(input.tool_choice, 'tool_choice'); fields(choice, ['type', 'disable_parallel_tool_use'], 'tool_choice');
    if (choice.type !== 'auto' || (choice.disable_parallel_tool_use !== undefined && choice.disable_parallel_tool_use !== false)) throw new AnthropicInputError('Only automatic tool choice with default parallel behavior is supported.');
  }
  const tools: Tool[] = [];
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools)) throw new AnthropicInputError('tools must be an array.');
    const names = new Set<string>();
    for (const value of input.tools) {
      const tool = object(value, 'tool'); noCache(tool); fields(tool, ['name', 'description', 'input_schema', 'type', 'cache_control'], 'tool');
      if (tool.type !== undefined && tool.type !== 'custom') throw new AnthropicInputError('Only client-defined function tools are supported.');
      const name = toolName(tool.name);
      if (names.has(name)) throw new AnthropicInputError('Tool names must be unique.');
      names.add(name);
      const inputSchema = object(tool.input_schema, 'input_schema');
      if (inputSchema.type !== undefined && inputSchema.type !== 'object') throw new AnthropicInputError('input_schema must describe an object.');
      tools.push({name, description: tool.description === undefined ? '' : text(tool.description, 'tool description'), inputSchema});
    }
  }
  if (tools.length && (input.max_tokens as number) < 1024) throw new AnthropicInputError('Function calling requires max_tokens between 1024 and 2048.');
  const messages: Message[] = [];
  if (input.system !== undefined) {
    const system = textBlocks(input.system, 'system');
    if (system) messages.push({role: 'system', content: system});
  }
  if (!Array.isArray(input.messages) || !input.messages.length) throw new AnthropicInputError('messages must be a nonempty array.');
  for (const value of input.messages) {
    const message = object(value, 'message'); fields(message, ['role', 'content'], 'message');
    if (message.role !== 'assistant' && message.role !== 'user') throw new AnthropicInputError('Only user and assistant messages are supported; put system instructions in system.');
    const role = message.role;
    if (typeof message.content === 'string') { messages.push({role, content: message.content}); continue; }
    if (!Array.isArray(message.content) || !message.content.length) throw new AnthropicInputError('message.content must contain text or tool blocks.');
    if (role === 'assistant') {
      const parts: string[] = [], toolCalls: ToolCall[] = [], ids = new Set<string>();
      for (const value of message.content) {
        const block = object(value, 'assistant content'); noCache(block);
        if (block.type === 'text') { fields(block, ['type', 'text', 'cache_control'], 'text block'); parts.push(text(block.text, 'text block')); }
        else if (block.type === 'tool_use') {
          fields(block, ['type', 'id', 'name', 'input', 'cache_control'], 'tool_use');
          const id = identifier(block.id, 'tool_use.id');
          if (ids.has(id)) throw new AnthropicInputError('tool_use IDs must be unique within a message.');
          ids.add(id);
          toolCalls.push({id, type: 'function', function: {name: toolName(block.name), arguments: object(block.input, 'tool_use.input')}});
        } else throw new AnthropicInputError('Assistant content supports text and tool_use only.');
      }
      messages.push({role, content: parts.join('\n'), ...(toolCalls.length ? {toolCalls} : {})});
    } else {
      let parts: string[] = [];
      const flush = () => { if (parts.length) { messages.push({role: 'user', content: parts.join('\n')}); parts = []; } };
      for (const value of message.content) {
        const block = object(value, 'user content'); noCache(block);
        if (block.type === 'text') { fields(block, ['type', 'text', 'cache_control'], 'text block'); parts.push(text(block.text, 'text block')); }
        else if (block.type === 'tool_result') {
          fields(block, ['type', 'tool_use_id', 'content', 'is_error', 'cache_control'], 'tool_result');
          if (block.is_error !== undefined && typeof block.is_error !== 'boolean') throw new AnthropicInputError('tool_result.is_error must be a boolean.');
          flush();
          const content = block.content === undefined ? '' : textBlocks(block.content, 'tool_result content');
          // CLOVA lacks an is_error field. Keep the failure signal in an explicit JSON tool result.
          messages.push({role: 'tool', toolCallId: identifier(block.tool_use_id, 'tool_use_id'), content: block.is_error ? JSON.stringify({is_error: true, content}) : content});
        } else throw new AnthropicInputError('User content supports text and tool_result only.');
      }
      flush();
    }
  }
  return {model, messages, tools, stream: input.stream === true, maxTokens: input.max_tokens as number};
}

export function toAnthropicMessage(answer: Answer, model: string, id: string): AnthropicMessage {
  const content: (TextBlock | ToolBlock)[] = [];
  if (answer.message.content) content.push({type: 'text', text: answer.message.content});
  for (const call of answer.message.toolCalls ?? []) content.push({type: 'tool_use', id: call.id, name: call.function.name, input: call.function.arguments});
  const reason = {stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens'} as const;
  const stopReason = reason[answer.finishReason as keyof typeof reason];
  if (!stopReason) throw new Error('Unsupported CLOVA finish reason');
  return {id, type: 'message', role: 'assistant', model, content, stop_reason: stopReason, stop_sequence: null,
    usage: {input_tokens: answer.usage.input, output_tokens: answer.usage.output, cache_creation_input_tokens: answer.usage.cacheWrite, cache_read_input_tokens: answer.usage.cacheRead}};
}

/** Emit a complete Anthropic event sequence from a buffered native response, never fabricated thinking. */
export function* anthropicEvents(message: AnthropicMessage): Generator<AnthropicEvent> {
  yield {type: 'message_start', message: {...message, content: [], stop_reason: null, usage: {...message.usage, output_tokens: 0}}};
  for (const [index, block] of message.content.entries()) {
    if (block.type === 'text') {
      yield {type: 'content_block_start', index, content_block: {type: 'text', text: ''}};
      yield {type: 'content_block_delta', index, delta: {type: 'text_delta', text: block.text}};
    } else {
      yield {type: 'content_block_start', index, content_block: {...block, input: {}}};
      yield {type: 'content_block_delta', index, delta: {type: 'input_json_delta', partial_json: JSON.stringify(block.input)}};
    }
    yield {type: 'content_block_stop', index};
  }
  yield {type: 'message_delta', delta: {stop_reason: message.stop_reason, stop_sequence: null}, usage: {output_tokens: message.usage.output_tokens}};
  yield {type: 'message_stop'};
}
