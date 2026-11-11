/** JSONL transport only: provider behavior remains in the project's existing Brain. */
import { createInterface } from 'node:readline';
import { Brain } from '../../clova/provider.ts';
import { Fault, redact } from '../../clova/common.ts';

const model = process.argv[2];
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
let active;
let brain;
const originalFetch = globalThis.fetch;
// Count actual HTTP attempts, including failed/aborted attempts. No automatic retries.
globalThis.fetch = (...args) => {
  if (!active) throw new Fault('bridge_protocol', 'Provider fetch has no active request');
  active.providerRequests += 1;
  emit({ id: active.id, event: 'provider_request', providerRequests: active.providerRequests });
  return originalFetch(...args);
};

function failure(error) {
  return {
    code: error instanceof Fault ? error.code : 'bridge_error',
    message: error instanceof Fault ? redact(error.message) : 'Brain bridge failed',
    ...(error instanceof Fault && error.status ? { status: error.status } : {}),
    ...(error instanceof Fault && error.usage ? { usage: error.usage } : {}),
  };
}

try {
  if (model !== 'clova:HCX-005') throw new Fault('configuration', 'Only clova:HCX-005 is enabled in this experiment');
  brain = new Brain(model);
  emit({ event: 'ready', ok: true, model, pid: process.pid });
} catch (error) {
  emit({ event: 'ready', ok: false, error: failure(error) });
  process.exitCode = 1;
}

if (brain) {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    let request;
    try {
      request = JSON.parse(line);
      if (!request || typeof request !== 'object' || typeof request.id !== 'string') {
        throw new Fault('bridge_protocol', 'A request ID is required');
      }
      if (request.op === 'cancel') {
        if (active?.id === request.id) active.controller.abort();
        continue;
      }
      if (request.op !== 'call' || !Array.isArray(request.messages) || !Array.isArray(request.tools)) {
        throw new Fault('bridge_protocol', 'Expected a model call');
      }
      if (active) throw new Fault('bridge_busy', 'A model request is already active');
      const current = { id: request.id, controller: new AbortController(), providerRequests: 0, done: undefined };
      active = current;
      // Do not await here: the input loop must receive cancellation while fetch is pending.
      current.done = (async () => {
        try {
          const answer = await brain.call(request.messages, request.tools, current.controller.signal,
                                          { maxTokens: request.maxTokens });
          emit({ id: current.id, ok: true, answer, providerRequests: current.providerRequests });
        } catch (error) {
          emit({ id: current.id, ok: false, error: failure(error), providerRequests: current.providerRequests });
        } finally {
          if (active === current) active = undefined;
        }
      })();
    } catch (error) {
      emit({ id: request?.id ?? null, ok: false, error: failure(error), providerRequests: 0 });
    }
  }
  const pending = active;
  if (pending) {
    pending.controller.abort();
    await pending.done;
  }
}
