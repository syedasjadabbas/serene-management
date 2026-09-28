import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Loads `.env` from the working directory if it exists, WITHOUT overriding
 * variables already set in the environment (a process manager's values win).
 * Uses Node's own parser, so operational commands need no dotenv package.
 */
export function loadEnvFileIfPresent(path = ".env"): boolean {
  if (!existsSync(path)) return false;
  const values = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
