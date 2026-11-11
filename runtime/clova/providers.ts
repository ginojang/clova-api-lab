/** Fixed candidates for the mode 2 comparison. No arbitrary model or paid fallback. */
export type Mode2Provider = {
  readonly id: 'groq' | 'openrouter' | 'zai';
  readonly label: string;
  readonly models: readonly {readonly id: string; readonly label: string}[];
  readonly keyFileEnv: string;
  readonly baseUrlEnv: string;
  readonly defaultBaseUrl: string;
  readonly supportedHarnessModes: readonly ['2'];
  readonly freePolicy: 'free-tier' | 'free-model';
};

export const MODE2_PROVIDERS: readonly Mode2Provider[] = [
  {
    id: 'groq', label: 'Groq',
    models: [{id: 'groq:openai/gpt-oss-120b', label: 'GPT-OSS 120B'}],
    keyFileEnv: 'GROQ_API_KEY_FILE', baseUrlEnv: 'GROQ_BASE_URL',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportedHarnessModes: ['2'], freePolicy: 'free-tier',
  },
  {
    id: 'openrouter', label: 'OpenRouter',
    models: [{id: 'openrouter:cohere/north-mini-code:free', label: 'North Mini Code (free)'}],
    keyFileEnv: 'OPENROUTER_API_KEY_FILE', baseUrlEnv: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    supportedHarnessModes: ['2'], freePolicy: 'free-model',
  },
  {
    id: 'zai', label: 'Z.ai',
    models: [{id: 'zai:glm-4.7-flash', label: 'GLM-4.7-Flash'}],
    keyFileEnv: 'ZAI_API_KEY_FILE', baseUrlEnv: 'ZAI_BASE_URL',
    defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
    supportedHarnessModes: ['2'], freePolicy: 'free-model',
  },
];

export function mode2ProviderForModel(selector: string): Mode2Provider | undefined {
  return MODE2_PROVIDERS.find(provider => provider.models.some(model => model.id === selector));
}
