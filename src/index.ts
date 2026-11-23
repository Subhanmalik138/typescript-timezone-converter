/**
 * tzc — timezone converter CLI.
 *
 * Public API: DST-aware conversion between IANA timezones, built on the
 * platform's ICU data via `Intl` — no runtime dependencies.
 *
 * @example
 * ```ts
 * import { convert, parseDateTime, formatInstant } from "typescript-timezone-converter";
 *
 * const result = convert(parseDateTime("2026-11-23T15:00"), "Asia/Karachi", "America/New_York");
 * console.log(formatInstant(result.instant, "America/New_York", "human"));
 * // Mon, 23 Nov 2026, 05:00:00 EST
 * ```
 */
export {
  COMMON_ZONES,
  assertValidZone,
  convert,
  diffMinutes,
  formatInstant,
  formatOffset,
  formatOffsetLong,
  formatWallTime,
  getAbbreviation,
  getOffsetMinutes,
  getZoneInfo,
  instantToWallTime,
  isDst,
  isValidZone,
  parseDateTime,
  resolveWallTime,
} from "./timezone.js";
export type {
  ConversionResult,
  OutputFormat,
  ResolveStatus,
  ResolvedWallTime,
  WallTime,
  ZoneInfo,
} from "./timezone.js";
