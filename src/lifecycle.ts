import type {
  OkfRawConcept,
  OkfStatus,
  OkfVerification,
  TrustTier
} from "./types.js";

type LifecycleSubject = OkfRawConcept | Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataOf(subject: LifecycleSubject): Record<string, unknown> {
  if ("body" in subject && "metadata" in subject && isRecord(subject.metadata)) {
    return subject.metadata;
  }
  return isRecord(subject) ? subject : {};
}

export function normalizeVerified(
  value: OkfVerification | readonly OkfVerification[]
): OkfVerification[];
export function normalizeVerified(value: unknown): Record<string, unknown>[];
export function normalizeVerified(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

export function isOkfActor(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return (
    /^(?:human|process):\S+$/u.test(value) ||
    /^[^/\s]+\/[^/\s]+$/u.test(value)
  );
}

export function deriveTrustTier(subject: LifecycleSubject): TrustTier {
  const actors = normalizeVerified(metadataOf(subject).verified)
    .flatMap((verification) =>
      typeof verification.by === "string" &&
      isOkfActor(verification.by) &&
      isIsoDateTime(verification.at)
        ? [verification.by]
        : []
    );

  if (actors.length === 0) {
    return "unverified";
  }
  return actors.some((actor) => actor.startsWith("human:"))
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

export function isIsoDateTime(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|[+-](\d{2}):(\d{2}))?$/u.exec(
    value
  );
  if (match === null || !isIsoDate(match[1])) {
    return false;
  }

  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] === undefined ? 0 : Number(match[4]);
  const fraction = match[5];
  const offsetHour = match[6] === undefined ? 0 : Number(match[6]);
  const offsetMinute = match[7] === undefined ? 0 : Number(match[7]);
  const hasNonZeroFraction = fraction !== undefined && /[1-9]/u.test(fraction);

  if (minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    return false;
  }
  return (
    hour < 24 ||
    (hour === 24 && minute === 0 && second === 0 && !hasNonZeroFraction)
  );
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
