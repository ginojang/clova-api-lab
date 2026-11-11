import {Fault} from './common.ts';

/** Native completion status only. Never retain the supplier's free-form message.
 * Unknown codes are non-retryable 422, not fabricated transient gateway errors.
 * Retry allowlist follows Elda-Spec v0.805 H20; the provider never retries.
 */
export function clovaBodyFault(value: unknown): Fault {
  const providerCode = typeof value === 'string' && /^\d{5}$/.test(value) ? value : undefined;
  const prefix = providerCode ? Number(providerCode.slice(0, 3)) : 0;
  const status = prefix >= 400 && prefix <= 599 ? prefix : 422;
  const apiError = providerCode === '40080' ? 'model_not_found'
    : status === 401 || status === 403 ? 'authentication_failed'
    : status === 402 ? 'billing_error'
    : status === 429 ? 'rate_limit'
    : status >= 500 ? 'server_error'
    : prefix >= 400 && prefix < 500 ? 'invalid_request' : 'unknown';
  const fault = new Fault('api_error', 'CLOVA rejected the request', status);
  fault.providerCode = providerCode;
  fault.apiError = apiError;
  fault.retryable = [429, 500, 502, 503, 529].includes(status);
  return fault;
}
