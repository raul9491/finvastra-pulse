/**
 * server/crm2/core.ts — the CRM 2.0 request primitives, lifted verbatim from
 * server/crm2.ts (2026-07-22, Phase 3 crm2 split). Pure + self-contained: the
 * typed ApiError, constant-time secret compare, PAN/mobile regexes, and the
 * body-validation helpers (reqStr/optStr/reqEnum/optNum/optMoney/optPct/strArr/
 * optTs/rejectFullAadhaar). No Deps closure — safe to share across the crm2
 * route modules. Behaviour unchanged.
 */
import crypto from "crypto";
import { Timestamp } from "firebase-admin/firestore";

/** Typed 4xx error — handlers throw it; the wrapper maps it to a JSON response. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

// Constant-time secret compare (avoids timing side-channels). A non-string
// header value or any length mismatch is treated as not-matching — identical
// behavior to the previous `===` string compare.
export function safeEqual(a?: string | string[], b?: string): boolean {
  if (typeof a !== "string" || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;

export const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export function reqStr(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (!isStr(v)) throw new ApiError(400, `${field} is required`);
  return v.trim();
}
export function optStr(body: Record<string, unknown>, field: string): string | null {
  const v = body[field];
  return isStr(v) ? v.trim() : null;
}
export function reqEnum<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const v = body[field];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ApiError(400, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}
export function optNum(body: Record<string, unknown>, field: string): number | null {
  const v = body[field];
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ApiError(400, `${field} must be a finite number`);
  return n;
}
/** Client-supplied money AMOUNT: finite and never negative (reject, don't clamp). */
export function optMoney(body: Record<string, unknown>, field: string): number | null {
  const n = optNum(body, field);
  if (n != null && n < 0) throw new ApiError(400, `${field} must not be negative`);
  return n;
}
/** Client-supplied PERCENTAGE: finite and within 0–100 (reject, don't clamp). */
export function optPct(body: Record<string, unknown>, field: string): number | null {
  const n = optNum(body, field);
  if (n != null && (n < 0 || n > 100)) throw new ApiError(400, `${field} must be between 0 and 100`);
  return n;
}
export function strArr(body: Record<string, unknown>, field: string): string[] {
  const v = body[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new ApiError(400, `${field} must be an array of strings`);
  }
  return v as string[];
}
/** ISO date string → Timestamp (null passthrough). */
export function optTs(body: Record<string, unknown>, field: string) {
  const v = body[field];
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) throw new ApiError(400, `${field} must be an ISO date`);
  return Timestamp.fromDate(d);
}
/** Hard guardrail: reject anything that looks like a full Aadhaar number. */
export function rejectFullAadhaar(body: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string" && /^\d{12}$/.test(v.replace(/[\s-]/g, "")) && /aadhaar/i.test(k)) {
      throw new ApiError(400, `${k}: full Aadhaar numbers are never stored — send only the last 4 digits`);
    }
  }
}

export const optBool = (b: Record<string, unknown>, f: string): boolean | undefined =>
  (b[f] === undefined ? undefined : b[f] === true);
export const optEnum = (b: Record<string, unknown>, f: string, allowed: string[]): string | null | undefined => {
  if (b[f] === undefined) return undefined;
  if (b[f] === null || b[f] === "") return null;
  const v = String(b[f]);
  if (!allowed.includes(v)) throw new ApiError(400, `${f} must be one of: ${allowed.join(", ")}`);
  return v;
};
