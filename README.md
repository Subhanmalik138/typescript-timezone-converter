# tzc — Timezone Converter CLI

Convert times between IANA timezones from the command line, with daylight
saving time handled properly — including the two cases most converters get
wrong: wall-clock times that happen **twice** (fall-back) and times that
**never happen** (spring-forward).

Zero runtime dependencies. All zone data comes from the platform's ICU
database through Node's built-in `Intl` API, so there is no bundled tz
database to keep in sync.

## Install

```bash
npm install -g typescript-timezone-converter
# or run from source:
npm install
npm run build
```

Requires Node.js >= 22.6.

## Usage

```bash
# Convert one time into one or more zones
tzc convert 2026-11-23T15:00 --from Asia/Karachi --to America/New_York
# 2026-11-23T15:00:00 Asia/Karachi  →  2026-11-23T05:00:00 America/New_York (EST, UTC-05:00)

tzc convert 2026-11-23T15:00 --from Asia/Karachi --to America/New_York --to Europe/London --to Asia/Tokyo

# Current time in several zones
tzc now --in Asia/Karachi --in Europe/London --in America/New_York

# A zone's offset (and whether DST is in effect), now or at a given date
tzc offset Asia/Kathmandu
tzc offset America/New_York --at 2026-07-01

# How far apart two zones are (DST-aware — the answer changes by season)
tzc diff Asia/Karachi America/New_York --at 2026-01-15
tzc diff Asia/Karachi America/New_York --at 2026-07-15

# List common zones with their current offsets
tzc zones
```

Add `--format human` for a readable form (`Mon, 23 Nov 2026, 05:00:00 EST`),
`--format unix` for Unix seconds, or `--json` on any command for
machine-readable output.

A bare date means midnight: `tzc convert 2026-11-23 --from UTC --to Asia/Karachi`.

## DST edge cases

```bash
# 01:30 on 2026-11-01 happens twice in New York — tzc says so and uses the first.
$ tzc convert 2026-11-01T01:30 --from America/New_York --to UTC
Note: 2026-11-01T01:30:00 happens twice in America/New_York (DST fall-back); showing the first occurrence.
2026-11-01T01:30:00 America/New_York  →  2026-11-01T05:30:00 UTC (UTC, UTC+00:00)

# 02:30 on 2026-03-08 never happens — the clock jumps 02:00 → 03:00.
$ tzc convert 2026-03-08T02:30 --from America/New_York --to UTC
Error: 2026-03-08T02:30:00 does not exist in America/New_York (DST gap — clocks jump to 2026-03-08T03:00:00)
```

## Library use

The core engine is importable as well as a CLI:

```ts
import { convert, parseDateTime, formatInstant } from "typescript-timezone-converter";

const result = convert(parseDateTime("2026-11-23T15:00"), "Asia/Karachi", "America/New_York");
console.log(formatInstant(result.instant, "America/New_York", "human"));
// Mon, 23 Nov 2026, 05:00:00 EST
```

Key exports: `convert`, `resolveWallTime`, `getOffsetMinutes`,
`getZoneInfo`, `isDst`, `diffMinutes`, `parseDateTime`, `formatInstant`,
`COMMON_ZONES`.

## How it works

1. **Offset from `Intl`.** A zone's UTC offset at an instant is derived by
   formatting that instant in the zone, re-reading the parts as if they
   were UTC, and measuring the difference. No tz database, no lookup tables.
2. **Wall time → instant by fixed-point iteration.** Guess the instant from
   the wall time, read the offset there, correct, repeat. Two iterations
   converge for every real wall time.
3. **Round-trip verification.** The candidate instant is formatted back in
   the zone: if the parts don't match, the time fell in the spring-forward
   gap. If the same parts also map through the offset in effect two hours
   later, the time is ambiguous and both instants are returned.
4. **DST detection without hemisphere assumptions.** A zone observes DST
   when its January and July offsets differ and the current offset is the
   larger one — so Sydney's January DST is handled exactly like New York's
   July DST.

## Design decisions

- **Zero dependencies, platform ICU.** Shipping a tz database means
  shipping stale data; Node already embeds the same database the OS uses.
- **Wall-clock input, instant output.** Users think in wall times
  ("15:00 in Karachi"); the engine converts to an absolute instant first
  and only then renders it elsewhere, which is what makes DST transitions
  fall out of the math instead of needing special cases.
- **Explicit edge-case results, not silent guesses.** Ambiguity and gaps
  are first-class return values (`resolveWallTime` returns a status), so
  the CLI can warn instead of quietly picking a wrong instant.
- **Fractional offsets are ordinary data.** Kathmandu's +05:45 and similar
  offsets flow through the same minute-based arithmetic — nothing assumes
  whole hours.

## Run tests

```bash
npm test
```

## License

MIT — see [LICENSE](LICENSE).
