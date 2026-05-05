import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEnvValidator, EnvValidationError } from './env.js';

describe('createEnvValidator', () => {
  const schema = z.object({
    FOO: z.string().min(1),
    BAR: z.string().optional(),
  });

  it('returns parsed env when valid', () => {
    const env = createEnvValidator(schema, { source: { FOO: 'hello' } as NodeJS.ProcessEnv });
    expect(env.FOO).toBe('hello');
    expect(env.BAR).toBeUndefined();
  });

  it('throws EnvValidationError listing missing keys', () => {
    expect(() =>
      createEnvValidator(schema, { source: {} as NodeJS.ProcessEnv, appName: 'test-app' }),
    ).toThrow(EnvValidationError);
  });
});
