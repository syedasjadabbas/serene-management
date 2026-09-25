/**
 * RFC 4180 CSV. Every field is quoted when it contains a comma, quote,
 * CR or LF; quotes are doubled. A field starting with =, +, - or @ is
 * prefixed with an apostrophe so spreadsheet programs never evaluate it as
 * a formula (CSV injection), unless it is a plain number.
 */
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@]/.test(text) && !NUMBER.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | boolean | null | undefined)[])[],
): string {
  return [header, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}
