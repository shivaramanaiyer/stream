export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "stream";
}

export function sanitizeDbName(name: string, maxLength: number): string {
  let sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  sanitized = sanitized.replace(/^_+|_+$/g, "");
  if (!sanitized) sanitized = "db";
  if (/^[0-9]/.test(sanitized)) sanitized = `db_${sanitized}`;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    sanitized = sanitized.replace(/_+$/g, "");
  }
  return sanitized;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
