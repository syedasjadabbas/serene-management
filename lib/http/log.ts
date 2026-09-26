import { databaseErrorCode } from "@/lib/db/transaction";

/**
 * Server error logging without personal data or secrets (G12). Database
 * errors are logged by code only: Prisma messages embed the query arguments
 * and PostgreSQL details quote the offending values. Other errors keep their
 * stack, with anything that looks like an e-mail address, a token or a
 * connection string masked.
 */

const REDACTIONS: [RegExp, string][] = [
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [
    /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    "$1$2[redacted]",
  ],
  [/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]"],
  [/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]"],
];

export function redact(text: string): string {
  return REDACTIONS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}

interface LoggedError {
  name: string;
  code?: string;
  message?: string;
  stack?: string;
}

/** The loggable description of an error: never query arguments, row values or secrets. */
export function describeError(error: unknown): LoggedError {
  const name =
    error instanceof Error
      ? error.name || error.constructor.name
      : typeof error === "object" && error !== null
        ? "NonError"
        : typeof error;
  const prismaCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const sqlState = databaseErrorCode(error);
  const isDatabase =
    sqlState !== undefined || name.startsWith("PrismaClient") || /^P\d{4}$/.test(prismaCode ?? "");
  if (isDatabase) return { name, code: sqlState ?? prismaCode };
  if (!(error instanceof Error)) return { name };
  return {
    name,
    message: redact(error.message),
    ...(error.stack ? { stack: redact(error.stack) } : {}),
  };
}

export function logServerError(label: string, error: unknown, requestId?: string): void {
  console.error(requestId ? `[${requestId}] ${label}` : label, describeError(error));
}
