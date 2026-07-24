/**
 * The CRM 2.0 lead enums — category, source and status.
 *
 * Hoisted out of registerCrm2Routes (2026-07-23) so both crm2.ts and the
 * extracted leadRoutes.ts can import them; they are used file-wide (public
 * intake, CRUD, promote, the SLA sweep). Verbatim — same tuples, same order, so
 * every reqEnum() check behaves identically.
 */
export const LEAD_CATEGORIES = ["LOAN", "WEALTH", "INSURANCE", "CIBIL_CHECK", "PARTNER_DSA", "GENERAL"] as const;
export const LEAD_SOURCES = ["WEBSITE", "JUSTDIAL", "REFERRAL_CLIENT", "REFERRAL_SUBDSA", "ADS", "WALKIN", "COLD_CALL"] as const;
export const LEAD_STATUSES = ["NEW", "QUEUED", "ASSIGNED", "ATTEMPTED", "CONTACTED", "QUALIFIED", "JUNK_DUPLICATE", "NOT_INTERESTED", "NOT_ELIGIBLE", "CONVERTED", "DROPPED"] as const;
export const DROP_REASONS = ["RATE", "AVAILED_ELSEWHERE", "NOT_ELIGIBLE", "UNREACHABLE", "DOCS_ISSUE"] as const;
