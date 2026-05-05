import { z, type ZodTypeAny } from 'zod';

export class EnvValidationError extends Error {
  constructor(
    public readonly issues: z.ZodIssue[],
    appName?: string,
  ) {
    const lines = issues.map((issue) => {
      const path = issue.path.join('.') || '<root>';
      return `  - ${path}: ${issue.message}`;
    });
    const prefix = appName ? `[${appName}] ` : '';
    super(`${prefix}Environment validation failed:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export interface EnvValidatorOptions {
  appName?: string;
  source?: NodeJS.ProcessEnv;
}

export function createEnvValidator<TSchema extends ZodTypeAny>(
  schema: TSchema,
  options: EnvValidatorOptions = {},
): z.infer<TSchema> {
  const source = options.source ?? process.env;
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues, options.appName);
  }
  return result.data;
}
