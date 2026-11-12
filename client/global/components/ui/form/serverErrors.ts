import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type { ClientApiError } from "@/global/api/errors";

/**
 * Pure mapping of a server `VALIDATION_FAILED.details.fields` record onto
 * form fields: fields the form knows become per-field messages, the rest are
 * returned as `unmapped` so the caller can show them in the dialog alert.
 * `known` is the form's field names; without it every key is mapped.
 */
export function mapServerFieldErrors(
  fieldErrors: Record<string, string[]>,
  known?: readonly string[],
): { fields: [string, string][]; unmapped: string[] } {
  const fields: [string, string][] = [];
  const unmapped: string[] = [];
  for (const [name, messages] of Object.entries(fieldErrors)) {
    const message = messages[0];
    if (!message) continue;
    if (!known || known.includes(name)) fields.push([name, message]);
    else unmapped.push(`${name}: ${message}`);
  }
  return { fields, unmapped };
}

/**
 * Puts a failed mutation's field errors on the form (`setError`, type
 * "server", cleared by the next change of that field). Returns true when at
 * least one field was set. The dialog still shows `error.message` on top.
 */
export function applyServerError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  error: ClientApiError | null,
  known?: readonly string[],
): boolean {
  if (!error) return false;
  const { fields } = mapServerFieldErrors(error.fieldErrors, known);
  for (const [name, message] of fields) {
    setError(name as Path<T>, { type: "server", message });
  }
  return fields.length > 0;
}
