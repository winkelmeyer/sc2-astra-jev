import "dotenv/config";

export const SC2_ROOT = process.env.SC2_ROOT ?? "/Applications/StarCraft II";
export const SC2_PORT = Number(process.env.SC2_PORT ?? 8167);
export const JEV_MODEL = "typesafe-ai/jev";
export const ASTRA_MODEL = "openai/gpt-6-astra";
export const JEV_INTERVAL_LOOPS = 11;
export const STEP_SIZE = 2;
export const JEV_CONCURRENCY = 8;
export const ASTRA_TIMEOUT_MS = 90_000;
