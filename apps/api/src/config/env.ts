import { z } from 'zod';

/** Parses "true"/"false"/"1"/"0" (and unset → default). Anything else is a config error. */
const boolFlag = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be true or false' });
      return z.NEVER;
    });

const int = (defaultValue: number, min = 0) => z.coerce.number().int().min(min).default(defaultValue);

// Domain limits (DOMAIN config defaults) are added once contract v1.1 fixes them.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1),
  DATABASE_URL: z.string().min(1, 'is required'),

  // Feature flags (CLAUDE.md §8): default OFF for the pilot.
  PAYMENTS_ENABLED: boolFlag(false),
  GOOGLE_LOGIN_ENABLED: boolFlag(false),

  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
});

export type Env = z.output<typeof envSchema>;

/** Validates process env. Throws one readable error listing every invalid variable. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}
