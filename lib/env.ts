import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1).default("file:./dev.db"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  AI_SUMMARY_ENABLED: z.enum(["true", "false"]).default("false"),
  AI_SUMMARY_API_URL: z.string().url().optional().or(z.literal("")),
  AI_SUMMARY_API_KEY: z.string().min(1).optional(),
  AI_SUMMARY_MODEL: z.string().min(1).default("configured-model"),
  AI_SUMMARY_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
});

const parsedEnvironment = environmentSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  AI_SUMMARY_ENABLED: process.env.AI_SUMMARY_ENABLED,
  AI_SUMMARY_API_URL: process.env.AI_SUMMARY_API_URL,
  AI_SUMMARY_API_KEY: process.env.AI_SUMMARY_API_KEY,
  AI_SUMMARY_MODEL: process.env.AI_SUMMARY_MODEL,
  AI_SUMMARY_TIMEOUT_MS: process.env.AI_SUMMARY_TIMEOUT_MS,
});

if (!parsedEnvironment.success) {
  throw new Error(
    `Invalid environment configuration: ${parsedEnvironment.error.message}`,
  );
}

export const env = parsedEnvironment.data;
