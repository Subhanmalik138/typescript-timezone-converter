#!/usr/bin/env node
/**
 * tzc — timezone converter CLI.
 *
 *   tzc convert 2026-11-23T15:00 --from Asia/Karachi --to America/New_York --to Europe/London
 *   tzc now --in Asia/Karachi --in America/New_York
 *   tzc offset Asia/Kathmandu
 *   tzc diff Asia/Karachi America/New_York
 *   tzc zones
 *
 * All output is plain text by default; add --json for machine-readable output.
 */

import {
  COMMON_ZONES,
  convert,
  diffMinutes,
  formatInstant,
  formatOffset,
  formatOffsetLong,
  formatWallTime,
  getZoneInfo,
  instantToWallTime,
  isValidZone,
  parseDateTime,
  resolveWallTime,
  type OutputFormat,
} from "./timezone.js";

interface GlobalOptions {
  json: boolean;
  format: OutputFormat;
}

function printUsage(): void {
  console.log(`tzc — convert times between IANA timezones (DST-aware)

Usage:
  tzc convert <datetime> --from <zone> --to <zone> [--to <zone> ...] [--format iso|human|unix] [--json]
  tzc now [--in <zone> ...] [--format iso|human|unix] [--json]
  tzc offset <zone> [--at <datetime>] [--json]
  tzc diff <zoneA> <zoneB> [--at <datetime>] [--json]
  tzc zones [--json]

Datetime format: YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss] (a space works instead of T).
A bare date means midnight. Zones are IANA names, e.g. Asia/Karachi, America/New_York.

Examples:
  tzc convert 2026-11-23T15:00 --from Asia/Karachi --to America/New_York
  tzc now --in Asia/Karachi --in Europe/London --in America/New_York
  tzc offset Asia/Kathmandu --at 2026-06-01
  tzc diff Asia/Karachi America/New_York --at 2026-07-01`);
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Parse flags of the form --key value, --key=value, --flag, and positionals. */
function parseArgs(argv: string[]): {
  positionals: string[];
  options: Map<string, string[]>;
  flags: Set<string>;
} {
  const positionals: string[] = [];
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        const key = arg.slice(2, eq);
        pushOption(options, key, arg.slice(eq + 1));
      } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) {
        pushOption(options, arg.slice(2), argv[++i]!);
      } else {
        flags.add(arg.slice(2));
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      fail(`Unknown short flag: ${arg} (use --long-form flags)`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, options, flags };
}

function pushOption(options: Map<string, string[]>, key: string, value: string): void {
  const existing = options.get(key) ?? [];
  existing.push(value);
  options.set(key, existing);
}

function globalOptions(
  options: Map<string, string[]>,
  flags: Set<string>,
): GlobalOptions {
  const json = flags.has("json");
  const formatRaw = options.get("format")?.[0] ?? "iso";
  if (formatRaw !== "iso" && formatRaw !== "human" && formatRaw !== "unix") {
    fail(`Unknown --format "${formatRaw}" — expected iso, human, or unix`);
  }
  return { json, format: formatRaw };
}

function requireZones(zones: string[]): void {
  for (const zone of zones) {
    if (!isValidZone(zone)) {
      fail(
        `Unknown timezone: ${zone} (run "tzc zones" for a list of common zones)`,
      );
    }
  }
}

function parseAt(
  options: Map<string, string[]>,
): { wall: ReturnType<typeof parseDateTime>; instant: Date } {
  const raw = options.get("at")?.[0];
  if (raw === undefined) {
    const now = new Date();
    return { wall: instantToWallTime(now, "UTC"), instant: now };
  }
  const wall = parseDateTime(raw);
  // --at is read as a UTC wall time: the instant it names, nothing more.
  return { wall, instant: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)) };
}

function cmdConvert(args: string[]): void {
  const { positionals, options, flags } = parseArgs(args);
  const g = globalOptions(options, flags);
  if (positionals.length !== 1) {
    fail("convert needs exactly one datetime, e.g. tzc convert 2026-11-23T15:00 --from Asia/Karachi --to America/New_York");
  }
  const from = options.get("from")?.[0];
  const tos = options.get("to") ?? [];
  if (!from) fail("convert needs --from <zone>");
  if (tos.length === 0) fail("convert needs at least one --to <zone>");
  requireZones([from, ...tos]);

  const wall = parseDateTime(positionals[0]!);
  const resolved = resolveWallTime(wall, from);
  if (resolved.status === "nonexistent") {
    const shifted = resolved.shiftedTo
      ? formatWallTime(instantToWallTime(resolved.shiftedTo, from))
      : "unknown";
    fail(
      `${formatWallTime(wall)} does not exist in ${from} (DST gap — clocks jump to ${shifted})`,
    );
  }
  if (resolved.status === "ambiguous") {
    console.error(
      `Note: ${formatWallTime(wall)} happens twice in ${from} (DST fall-back); showing the first occurrence.`,
    );
  }

  const results = tos.map((to) => {
    const r = convert(wall, from, to);
    return {
      zone: to,
      datetime: formatInstant(r.instant, to, g.format),
      offset: formatOffset(r.outputOffsetMinutes),
      abbreviation: r.outputAbbreviation,
    };
  });

  if (g.json) {
    console.log(
      JSON.stringify(
        {
          input: formatWallTime(wall),
          from,
          unix: Math.floor(resolved.instants[0]!.getTime() / 1000),
          ambiguous: resolved.status === "ambiguous",
          results,
        },
        null,
        2,
      ),
    );
    return;
  }
  const inputLine = `${formatWallTime(wall)} ${from}`;
  for (const r of results) {
    console.log(`${inputLine}  →  ${r.datetime} ${r.zone} (${r.abbreviation}, UTC${r.offset})`);
  }
}

function cmdNow(args: string[]): void {
  const { options, flags } = parseArgs(args);
  const g = globalOptions(options, flags);
  const zones = options.get("in") ?? ["UTC", "Asia/Karachi", "Europe/London", "America/New_York"];
  requireZones(zones);
  const now = new Date();
  if (g.json) {
    console.log(
      JSON.stringify(
        {
          unix: Math.floor(now.getTime() / 1000),
          zones: zones.map((zone) => ({
            zone,
            datetime: formatInstant(now, zone, g.format),
            offset: formatOffset(getZoneInfo(now, zone).offsetMinutes),
            abbreviation: getZoneInfo(now, zone).abbreviation,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const zone of zones) {
    const info = getZoneInfo(now, zone);
    console.log(
      `${formatInstant(now, zone, g.format)}  ${zone} (${info.abbreviation}, UTC${formatOffset(info.offsetMinutes)})`,
    );
  }
}

function cmdOffset(args: string[]): void {
  const { positionals, options, flags } = parseArgs(args);
  const g = globalOptions(options, flags);
  if (positionals.length !== 1) fail("offset needs exactly one zone, e.g. tzc offset Asia/Kathmandu");
  const zone = positionals[0]!;
  requireZones([zone]);
  const { instant } = parseAt(options);
  const info = getZoneInfo(instant, zone);
  if (g.json) {
    console.log(
      JSON.stringify(
        {
          zone,
          at: formatInstant(instant, "UTC", "iso"),
          offsetMinutes: info.offsetMinutes,
          offset: formatOffset(info.offsetMinutes),
          abbreviation: info.abbreviation,
          isDst: info.isDst,
        },
        null,
        2,
      ),
    );
    return;
  }
  const dst = info.isDst ? " (DST in effect)" : "";
  console.log(
    `${zone}: UTC${formatOffset(info.offsetMinutes)} (${formatOffsetLong(info.offsetMinutes)}), ${info.abbreviation}${dst}`,
  );
}

function cmdDiff(args: string[]): void {
  const { positionals, options, flags } = parseArgs(args);
  const g = globalOptions(options, flags);
  if (positionals.length !== 2) fail("diff needs exactly two zones, e.g. tzc diff Asia/Karachi America/New_York");
  const zoneA = positionals[0]!;
  const zoneB = positionals[1]!;
  requireZones([zoneA, zoneB]);
  const { instant } = parseAt(options);
  const minutes = diffMinutes(instant, zoneA, zoneB);
  const hours = minutes / 60;
  if (g.json) {
    console.log(
      JSON.stringify(
        { zoneA, zoneB, at: formatInstant(instant, "UTC", "iso"), differenceMinutes: minutes, differenceHours: hours },
        null,
        2,
      ),
    );
    return;
  }
  const ahead = minutes > 0 ? "ahead of" : minutes < 0 ? "behind" : "the same as";
  console.log(
    `${zoneA} is ${formatOffsetLong(minutes).replace("+", "").replace("-", "")} ${ahead} ${zoneB} (${formatOffsetLong(minutes)})`,
  );
}

function cmdZones(args: string[]): void {
  const { flags } = parseArgs(args);
  const json = flags.has("json");
  const now = new Date();
  const rows = COMMON_ZONES.map(({ zone, label }) => {
    const info = getZoneInfo(now, zone);
    return { zone, label, offset: formatOffset(info.offsetMinutes), abbreviation: info.abbreviation };
  });
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const row of rows) {
    console.log(`${row.zone.padEnd(24)} ${row.label.padEnd(14)} UTC${row.offset} ${row.abbreviation}`);
  }
}

export function main(argv: string[]): void {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "convert":
        cmdConvert(rest);
        break;
      case "now":
        cmdNow(rest);
        break;
      case "offset":
        cmdOffset(rest);
        break;
      case "diff":
        cmdDiff(rest);
        break;
      case "zones":
        cmdZones(rest);
        break;
      case "--help":
      case "-h":
      case "help":
      case undefined:
        printUsage();
        break;
      default:
        fail(`Unknown command: ${command} (run "tzc --help" for usage)`);
    }
  } catch (err) {
    if (err instanceof Error) fail(err.message);
    throw err;
  }
}

main(process.argv.slice(2));
