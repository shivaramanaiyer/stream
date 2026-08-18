import { createHash } from "crypto";

// Postgres truncates identifiers at 63 bytes.
export const POSTGRES_MAX_IDENTIFIER_LENGTH = 63;
// Tools downstream of stream append their own suffixes to the database name
// (`_template`, `_test`, pytest-xdist's `_gw0`, numeric copies, ...). Reserve room
// for those so the suffixed name still fits in a Postgres identifier.
export const DB_NAME_SUFFIX_RESERVE = 13;

const DB_NAME_HASH_LENGTH = 6;
const DB_NAME_BASE_BUDGET = 16;
const DB_NAME_MIN_LENGTH = 16;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-") || "stream";
}

export function sanitizeDbName(name: string, maxLength?: number): string {
  let sanitized = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  sanitized = sanitized.replace(/^_+|_+$/g, "");
  if (!sanitized) sanitized = "db";
  if (/^[0-9]/.test(sanitized)) sanitized = `db_${sanitized}`;
  if (maxLength !== undefined && sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    sanitized = sanitized.replace(/_+$/g, "");
  }
  return sanitized;
}

// The configured limit is only ever an upper bound: it is clamped so a suffixed
// copy of the name still fits in POSTGRES_MAX_IDENTIFIER_LENGTH.
export function effectiveDbNameLength(maxLength: number): number {
  const ceiling = POSTGRES_MAX_IDENTIFIER_LENGTH - DB_NAME_SUFFIX_RESERVE;
  const requested = Number.isFinite(maxLength) ? Math.floor(maxLength) : ceiling;
  return Math.max(DB_NAME_MIN_LENGTH, Math.min(requested, ceiling));
}

function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, DB_NAME_HASH_LENGTH);
}

function trimTail(value: string, keep: number): string {
  return value.slice(0, Math.max(0, keep)).replace(/_+$/g, "");
}

// Builds `<base>__<lane>`, shortened to fit the effective limit. When it does not
// fit, both halves are truncated and a hash of the full name is appended so long
// branch names cannot collide with each other.
export function buildDbName(base: string, lane: string, maxLength: number): string {
  const limit = effectiveDbNameLength(maxLength);
  const combined = sanitizeDbName(`${base}__${lane}`);
  if (combined.length <= limit) return combined;

  const suffix = `_${shortHash(combined)}`;
  const budget = limit - suffix.length;
  const safeBase = sanitizeDbName(base);
  const safeLane = sanitizeDbName(lane);
  const baseKeep = Math.min(safeBase.length, Math.max(1, Math.min(DB_NAME_BASE_BUDGET, budget - 4)));
  const laneKeep = budget - baseKeep - 2;

  const head = trimTail(safeBase, baseKeep) || "db";
  const tail = trimTail(safeLane, laneKeep);
  const name = tail ? `${head}__${tail}${suffix}` : `${head}${suffix}`;
  return sanitizeDbName(name, limit);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
