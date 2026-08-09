import type {
  OkfConcept,
  OkfStatus,
  OkfVerification,
  TrustTier
} from "./types.js";

type LifecycleSubject = OkfConcept | Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataOf(subject: LifecycleSubject): Record<string, unknown> {
  if ("body" in subject && "metadata" in subject && isRecord(subject.metadata)) {
    return subject.metadata;
  }
  return isRecord(subject) ? subject : {};
}

export function normalizeVerified(value: unknown): OkfVerification[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord) as OkfVerification[];
  }
  return isRecord(value) ? [value as OkfVerification] : [];
}

export function deriveTrustTier(subject: LifecycleSubject): TrustTier {
  const verifications = normalizeVerified(metadataOf(subject).verified).filter(
    (verification) =>
      typeof verification.by === "string" && verification.by.trim().length > 0
  );

  if (verifications.length === 0) {
    return "unverified";
  }
  return verifications.some((verification) => verification.by.startsWith("human:"))
    ? "human-reviewed"
    : "machine-confirmed";
}

export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isStale(subject: LifecycleSubject, today = new Date()): boolean {
  const staleAfter = metadataOf(subject).stale_after;
  if (
    typeof staleAfter !== "string" ||
    !isIsoDate(staleAfter) ||
    Number.isNaN(today.valueOf())
  ) {
    return false;
  }
  return today.toISOString().slice(0, 10) >= staleAfter;
}

export function getStatus(subject: LifecycleSubject): OkfStatus {
  const status = metadataOf(subject).status;
  return status === "draft" || status === "deprecated" || status === "stable"
    ? status
    : "stable";
}
