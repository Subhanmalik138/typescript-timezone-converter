/**
 * Timezone conversion engine.
 *
 * Everything is built on the platform's ICU data via `Intl.DateTimeFormat`,
 * so there are no runtime dependencies and no bundled tz database to keep
 * in sync. The core trick is deriving a zone's UTC offset from the parts
 * `Intl` formats for a given instant, then inverting that mapping to turn
 * a wall-clock reading in a zone back into an absolute instant — with
 * explicit handling for the two awkward cases DST creates: times that
 * happen twice (fall-back) and times that never happen (spring-forward).
 */

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
}

export type ResolveStatus = "ok" | "ambiguous" | "nonexistent";

export interface ResolvedWallTime {
  status: ResolveStatus;
  /** The instant(s) the wall time maps to. One for "ok", two for "ambiguous", zero for "nonexistent". */
  instants: Date[];
  /**
   * For a nonexistent time, the first valid instant after the gap
   * (i.e. where the clock actually lands), so callers can suggest it.
   */
  shiftedTo?: Date;
}

export interface ZoneInfo {
  zone: string;
  /** UTC offset in minutes (e.g. -300 for EST, +330 for IST). */
  offsetMinutes: number;
  /** Short abbreviation such as "EST" or "GMT+5" (ICU's short name for the zone). */
  abbreviation: string;
  /** True when daylight saving time is in effect at the given instant. */
  isDst: boolean;
}

export interface ConversionResult {
  input: WallTime;
  fromZone: string;
  toZone: string;
  instant: Date;
  /** The instant rendered back in the destination zone. */
  output: WallTime;
  outputOffsetMinutes: number;
  outputAbbreviation: string;
}

const MS_PER_MINUTE = 60_000;

/** A curated list of the zones people actually convert between. */
export const COMMON_ZONES: ReadonlyArray<{ zone: string; label: string }> = [
  { zone: "UTC", label: "UTC" },
  { zone: "America/New_York", label: "New York" },
  { zone: "America/Chicago", label: "Chicago" },
  { zone: "America/Denver", label: "Denver" },
  { zone: "America/Los_Angeles", label: "Los Angeles" },
  { zone: "America/Toronto", label: "Toronto" },
  { zone: "America/Mexico_City", label: "Mexico City" },
  { zone: "America/Sao_Paulo", label: "Sao Paulo" },
  { zone: "America/Bogota", label: "Bogota" },
  { zone: "America/Anchorage", label: "Anchorage" },
  { zone: "Atlantic/Reykjavik", label: "Reykjavik" },
  { zone: "Europe/London", label: "London" },
  { zone: "Europe/Paris", label: "Paris" },
  { zone: "Europe/Berlin", label: "Berlin" },
  { zone: "Europe/Madrid", label: "Madrid" },
  { zone: "Europe/Moscow", label: "Moscow" },
  { zone: "Europe/Istanbul", label: "Istanbul" },
  { zone: "Africa/Cairo", label: "Cairo" },
  { zone: "Africa/Lagos", label: "Lagos" },
  { zone: "Asia/Dubai", label: "Dubai" },
  { zone: "Asia/Tehran", label: "Tehran" },
  { zone: "Asia/Karachi", label: "Karachi" },
  { zone: "Asia/Kolkata", label: "Kolkata" },
  { zone: "Asia/Kathmandu", label: "Kathmandu" },
  { zone: "Asia/Dhaka", label: "Dhaka" },
  { zone: "Asia/Bangkok", label: "Bangkok" },
  { zone: "Asia/Jakarta", label: "Jakarta" },
  { zone: "Asia/Manila", label: "Manila" },
  { zone: "Asia/Singapore", label: "Singapore" },
  { zone: "Asia/Shanghai", label: "Shanghai" },
  { zone: "Asia/Tokyo", label: "Tokyo" },
  { zone: "Asia/Seoul", label: "Seoul" },
  { zone: "Australia/Sydney", label: "Sydney" },
  { zone: "Australia/Melbourne", label: "Melbourne" },
  { zone: "Pacific/Auckland", label: "Auckland" },
];

/** True when `zone` is a real IANA timezone name the runtime knows about. */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Throw a clear error for an unknown zone; otherwise return it unchanged. */
export function assertValidZone(zone: string): string {
  if (!isValidZone(zone)) {
    throw new Error(`Unknown timezone: ${zone}`);
  }
  return zone;
}

function partsFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function readParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      out[part.type] = Number(part.value);
    }
  }
  return out;
}

/** Render an instant as wall-clock parts in `zone`. */
export function instantToWallTime(date: Date, zone: string): WallTime {
  assertValidZone(zone);
  const p = readParts(partsFormatter(zone), date);
  return {
    year: p.year!,
    month: p.month!,
    day: p.day!,
    hour: p.hour! % 24,
    minute: p.minute!,
    second: p.second!,
  };
}

/**
 * The zone's UTC offset in minutes at a given instant.
 * Derived by formatting the instant in the zone, re-reading those parts
 * as if they were UTC, and measuring the difference.
 */
export function getOffsetMinutes(date: Date, zone: string): number {
  assertValidZone(zone);
  const wall = instantToWallTime(date, zone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Truncate toward zero: sub-minute skew comes from the discarded
  // milliseconds of the input, never from a real zone offset.
  return Math.round((asUtc - date.getTime()) / MS_PER_MINUTE);
}

/** Short abbreviation for the zone at an instant, e.g. "EST" or "GMT+5". */
export function getAbbreviation(date: Date, zone: string): string {
  assertValidZone(zone);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
    hour: "2-digit",
  });
  for (const part of fmt.formatToParts(date)) {
    if (part.type === "timeZoneName") return part.value;
  }
  return formatOffset(getOffsetMinutes(date, zone));
}

/**
 * Is daylight saving time in effect in `zone` at this instant?
 * A zone observes DST when its January and July offsets differ and the
 * current offset is the larger (clocks-forward) one. Works for both
 * hemispheres because it never assumes which half of the year is summer.
 */
export function isDst(date: Date, zone: string): boolean {
  assertValidZone(zone);
  const jan = getOffsetMinutes(
    new Date(Date.UTC(date.getUTCFullYear(), 0, 1)),
    zone,
  );
  const jul = getOffsetMinutes(
    new Date(Date.UTC(date.getUTCFullYear(), 6, 1)),
    zone,
  );
  if (jan === jul) return false;
  return getOffsetMinutes(date, zone) === Math.max(jan, jul);
}

/** Everything worth knowing about a zone at one instant. */
export function getZoneInfo(date: Date, zone: string): ZoneInfo {
  assertValidZone(zone);
  return {
    zone,
    offsetMinutes: getOffsetMinutes(date, zone),
    abbreviation: getAbbreviation(date, zone),
    isDst: isDst(date, zone),
  };
}

function wallTimeToUtcMs(wall: WallTime): number {
  return Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
}

function sameWallTime(a: WallTime, b: WallTime): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * Turn a wall-clock reading in `zone` into absolute instant(s).
 *
 * Two fixed-point iterations converge on the right offset for ordinary
 * times. A round-trip check then separates the three cases:
 *  - the parts survive the round trip: the time is real and unique;
 *  - the same parts also map through the offset in effect a couple of
 *    hours later: the time happens twice (fall-back);
 *  - the parts do not survive: the time falls inside the spring-forward
 *    gap and never happens.
 */
export function resolveWallTime(wall: WallTime, zone: string): ResolvedWallTime {
  assertValidZone(zone);
  const wallMs = wallTimeToUtcMs(wall);

  let utcMs = wallMs - getOffsetMinutes(new Date(wallMs), zone) * MS_PER_MINUTE;
  utcMs = wallMs - getOffsetMinutes(new Date(utcMs), zone) * MS_PER_MINUTE;

  if (!sameWallTime(instantToWallTime(new Date(utcMs), zone), wall)) {
    // Inside the spring-forward gap: the clock jumps from 02:00 to 03:00,
    // so 02:30 never exists. Report the instant the clock lands on.
    const shifted = wallMs - getOffsetMinutes(new Date(utcMs), zone) * MS_PER_MINUTE;
    return { status: "nonexistent", instants: [], shiftedTo: new Date(shifted) };
  }

  // Same wall time through the offset two hours later => a second occurrence.
  const laterOffset = getOffsetMinutes(new Date(utcMs + 2 * 60 * MS_PER_MINUTE), zone);
  const secondMs = wallMs - laterOffset * MS_PER_MINUTE;
  if (
    secondMs !== utcMs &&
    sameWallTime(instantToWallTime(new Date(secondMs), zone), wall)
  ) {
    const first = new Date(Math.min(utcMs, secondMs));
    const second = new Date(Math.max(utcMs, secondMs));
    return { status: "ambiguous", instants: [first, second] };
  }

  return { status: "ok", instants: [new Date(utcMs)] };
}

/**
 * Convert a wall-clock time in `fromZone` to the same instant in `toZone`.
 * Ambiguous source times resolve to their first occurrence; nonexistent
 * source times throw, with the shifted instant named in the message.
 */
export function convert(
  wall: WallTime,
  fromZone: string,
  toZone: string,
): ConversionResult {
  assertValidZone(fromZone);
  assertValidZone(toZone);
  const resolved = resolveWallTime(wall, fromZone);
  if (resolved.status === "nonexistent") {
    const shifted = resolved.shiftedTo
      ? formatWallTime(instantToWallTime(resolved.shiftedTo, fromZone))
      : "unknown";
    throw new Error(
      `${formatWallTime(wall)} does not exist in ${fromZone} (DST gap — clocks jump to ${shifted})`,
    );
  }
  const instant = resolved.instants[0]!;
  return {
    input: wall,
    fromZone,
    toZone,
    instant,
    output: instantToWallTime(instant, toZone),
    outputOffsetMinutes: getOffsetMinutes(instant, toZone),
    outputAbbreviation: getAbbreviation(instant, toZone),
  };
}

/** Signed difference `zoneA - zoneB` in minutes at an instant. */
export function diffMinutes(date: Date, zoneA: string, zoneB: string): number {
  return getOffsetMinutes(date, zoneA) - getOffsetMinutes(date, zoneB);
}

const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/**
 * Parse `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `YYYY-MM-DD HH:mm[:ss]`.
 * A bare date means midnight. Throws on malformed input or impossible
 * calendar dates (2026-02-30, month 13, hour 25, ...).
 */
export function parseDateTime(input: string): WallTime {
  const trimmed = input.trim();
  const m = DATE_TIME_RE.exec(trimmed);
  if (!m) {
    throw new Error(
      `Cannot parse datetime "${input}" — expected YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss]`,
    );
  }
  const wall: WallTime = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] === undefined ? 0 : Number(m[4]),
    minute: m[5] === undefined ? 0 : Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
  };
  if (wall.month < 1 || wall.month > 12) {
    throw new Error(`Invalid month in "${input}"`);
  }
  if (wall.hour > 23 || wall.minute > 59 || wall.second > 59) {
    throw new Error(`Invalid time in "${input}"`);
  }
  // Reject impossible days (Feb 30, Apr 31, ...) via a UTC round trip.
  const probe = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
  );
  if (
    probe.getUTCFullYear() !== wall.year ||
    probe.getUTCMonth() !== wall.month - 1 ||
    probe.getUTCDate() !== wall.day
  ) {
    throw new Error(`Invalid date in "${input}"`);
  }
  return wall;
}

/** `2026-11-23T14:30:00` — no offset, just the wall-clock reading. */
export function formatWallTime(wall: WallTime): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${wall.year}-${p(wall.month)}-${p(wall.day)}T${p(wall.hour)}:${p(wall.minute)}:${p(wall.second)}`
  );
}

/** `+05:30`, `-04:00`, `+00:00`. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `+5h 30m`, `-4h`, `+45m` — the human-readable form of an offset. */
export function formatOffsetLong(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

export type OutputFormat = "iso" | "human" | "unix";

/** Render an instant in a zone: ISO with offset, human-readable, or Unix seconds. */
export function formatInstant(
  date: Date,
  zone: string,
  format: OutputFormat,
): string {
  assertValidZone(zone);
  const wall = instantToWallTime(date, zone);
  const offset = getOffsetMinutes(date, zone);
  switch (format) {
    case "unix":
      return String(Math.floor(date.getTime() / 1000));
    case "human": {
      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const weekday = days[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()];
      const p = (n: number) => String(n).padStart(2, "0");
      return (
        `${weekday}, ${wall.day} ${months[wall.month - 1]} ${wall.year}, ` +
        `${p(wall.hour)}:${p(wall.minute)}:${p(wall.second)} ${getAbbreviation(date, zone)}`
      );
    }
    case "iso":
    default: {
      const p = (n: number) => String(n).padStart(2, "0");
      return (
        `${wall.year}-${p(wall.month)}-${p(wall.day)}T${p(wall.hour)}:${p(wall.minute)}:${p(wall.second)}` +
        formatOffset(offset)
      );
    }
  }
}
