import {Ajv, type ValidateFunction, type ErrorObject} from 'ajv';
import {Ajv2020} from 'ajv/dist/2020.js';
import {Fault} from './common.ts';

const options = {strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false, ownProperties: true, addUsedSchema: false, logger: false as const};
const draft7 = new Ajv(options), draft2020 = new Ajv2020(options);
const cache = new WeakMap<object, ValidateFunction>();
export type ArgumentDiagnostic = {category: string; badField: string | null; validShape: {type: unknown; required: unknown}; retryable: true; sideEffect: 'not_started'};

/** Pure validation: never coerce, fill defaults, drop fields, or fetch schemas. */
export function compileToolSchema(schema: Record<string, unknown>): ValidateFunction {
  const prior = cache.get(schema); if (prior) return prior;
  try {
    const engine = schema.$schema === 'https://json-schema.org/draft/2020-12/schema' ? draft2020 : draft7;
    const validate = engine.compile(schema);
    if ('$async' in validate) throw new Error('async tool schema unsupported');
    cache.set(schema, validate); return validate;
  } catch { throw new Fault('configuration', 'Tool schema is unsupported or invalid; tool was not executed'); }
}
export function toolArgumentError(schema: Record<string, unknown>, input: unknown): ArgumentDiagnostic | undefined {
  const validate = compileToolSchema(schema);
  if (validate(input)) return;
  const error = validate.errors?.[0] as ErrorObject | undefined;
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties as Record<string, unknown> : {};
  const field = error?.keyword === 'required' ? error.params.missingProperty : error?.instancePath.split('/')[1];
  // Only schema-declared field names leave this boundary, never input values or unknown property names.
  return {category: error?.keyword === 'required' ? 'missing_field' : error?.keyword === 'additionalProperties' ? 'unknown_field' : error?.keyword === 'type' ? 'wrong_type' : 'invalid_arguments',
    badField: typeof field === 'string' && Object.hasOwn(properties, field) ? field : null,
    validShape: {type: schema.type ?? 'any', required: Array.isArray(schema.required) ? schema.required : []},
    retryable: true, sideEffect: 'not_started'};
}
