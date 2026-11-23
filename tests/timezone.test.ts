import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMON_ZONES,
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
} from "../src/timezone.js";

/** Instant helper: Date.UTC with readable month (1-12). */
function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

describe("isValidZone", () => {
  it("accepts real IANA names", () => {
    assert.equal(isValidZone("Asia/Karachi"), true);
    assert.equal(isValidZone("America/New_York"), true);
    assert.equal(isValidZone("UTC"), true);
    assert.equal(isValidZone("Asia/Kathmandu"), true);
  });

  it("rejects made-up names", () => {
    assert.equal(isValidZone("Mars/Olympus"), false);
    assert.equal(isValidZone("Not/AZone"), false);
    assert.equal(isValidZone(""), false);
  });

  it("every zone in COMMON_ZONES is valid", () => {
    for (const { zone } of COMMON_ZONES) {
      assert.equal(isValidZone(zone), true, zone);
    }
  });
});

describe("getOffsetMinutes", () => {
  it("Karachi is always +5h (no DST)", () => {
    assert.equal(getOffsetMinutes(utc(2026, 1, 15), "Asia/Karachi"), 300);
    assert.equal(getOffsetMinutes(utc(2026, 7, 15), "Asia/Karachi"), 300);
  });

  it("New York is -5h in winter, -4h in summer", () => {
    assert.equal(getOffsetMinutes(utc(2026, 1, 15), "America/New_York"), -300);
    assert.equal(getOffsetMinutes(utc(2026, 7, 15), "America/New_York"), -240);
  });

  it("Kathmandu is +5:45 (fractional offset)", () => {
    assert.equal(getOffsetMinutes(utc(2026, 3, 1), "Asia/Kathmandu"), 345);
  });

  it("Sydney flips the other way (southern hemisphere)", () => {
    assert.equal(getOffsetMinutes(utc(2026, 1, 15), "Australia/Sydney"), 660);
    assert.equal(getOffsetMinutes(utc(2026, 7, 15), "Australia/Sydney"), 600);
  });

  it("UTC is always zero", () => {
    assert.equal(getOffsetMinutes(utc(2026, 6, 1, 12), "UTC"), 0);
  });
});

describe("isDst", () => {
  it("New York observes DST in July, not January", () => {
    assert.equal(isDst(utc(2026, 7, 15), "America/New_York"), true);
    assert.equal(isDst(utc(2026, 1, 15), "America/New_York"), false);
  });

  it("Sydney observes DST in January, not July", () => {
    assert.equal(isDst(utc(2026, 1, 15), "Australia/Sydney"), true);
    assert.equal(isDst(utc(2026, 7, 15), "Australia/Sydney"), false);
  });

  it("Karachi never observes DST", () => {
    assert.equal(isDst(utc(2026, 1, 15), "Asia/Karachi"), false);
    assert.equal(isDst(utc(2026, 7, 15), "Asia/Karachi"), false);
  });
});

describe("getZoneInfo / getAbbreviation", () => {
  it("reports offset, abbreviation and DST flag together", () => {
    const winter = getZoneInfo(utc(2026, 1, 15), "America/New_York");
    assert.equal(winter.offsetMinutes, -300);
    assert.equal(winter.abbreviation, "EST");
    assert.equal(winter.isDst, false);

    const summer = getZoneInfo(utc(2026, 7, 15), "America/New_York");
    assert.equal(summer.offsetMinutes, -240);
    assert.equal(summer.abbreviation, "EDT");
    assert.equal(summer.isDst, true);
  });

  it("Karachi's abbreviation falls back to a GMT offset (ICU has no PKT short name)", () => {
    // Node's ICU only ships short names for some zones (EST, EDT); for the
    // rest it renders GMT+offset, which is still unambiguous and correct.
    assert.equal(getAbbreviation(utc(2026, 5, 1), "Asia/Karachi"), "GMT+5");
  });
});

describe("instantToWallTime", () => {
  it("renders an instant in the zone's wall clock", () => {
    // 2026-11-23 10:00 UTC == 15:00 in Karachi.
    assert.deepEqual(instantToWallTime(utc(2026, 11, 23, 10), "Asia/Karachi"), {
      year: 2026, month: 11, day: 23, hour: 15, minute: 0, second: 0,
    });
  });

  it("rolls the date back across midnight", () => {
    // 2026-11-23 02:00 UTC == 2026-11-22 21:00 in New York (EST).
    assert.deepEqual(instantToWallTime(utc(2026, 11, 23, 2), "America/New_York"), {
      year: 2026, month: 11, day: 22, hour: 21, minute: 0, second: 0,
    });
  });
});

describe("resolveWallTime", () => {
  it("resolves an ordinary wall time to one instant", () => {
    const r = resolveWallTime(
      { year: 2026, month: 11, day: 23, hour: 15, minute: 0, second: 0 },
      "Asia/Karachi",
    );
    assert.equal(r.status, "ok");
    assert.equal(r.instants.length, 1);
    assert.equal(r.instants[0]!.getTime(), utc(2026, 11, 23, 10).getTime());
  });

  it("detects a fall-back ambiguous time and returns both instants", () => {
    // 2026-11-01 01:30 happens twice in New York (EDT then EST).
    const r = resolveWallTime(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      "America/New_York",
    );
    assert.equal(r.status, "ambiguous");
    assert.equal(r.instants.length, 2);
    assert.equal(r.instants[0]!.getTime(), utc(2026, 11, 1, 5, 30).getTime());
    assert.equal(r.instants[1]!.getTime(), utc(2026, 11, 1, 6, 30).getTime());
  });

  it("detects a spring-forward nonexistent time", () => {
    // 2026-03-08 02:30 never happens in New York; clocks jump to 03:00.
    const r = resolveWallTime(
      { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
      "America/New_York",
    );
    assert.equal(r.status, "nonexistent");
    assert.equal(r.instants.length, 0);
    assert.ok(r.shiftedTo);
    assert.equal(r.shiftedTo.getTime(), utc(2026, 3, 8, 7, 30).getTime());
  });

  it("times just outside the transitions are unambiguous", () => {
    const before = resolveWallTime(
      { year: 2026, month: 3, day: 8, hour: 1, minute: 30, second: 0 },
      "America/New_York",
    );
    assert.equal(before.status, "ok");
    const after = resolveWallTime(
      { year: 2026, month: 3, day: 8, hour: 3, minute: 30, second: 0 },
      "America/New_York",
    );
    assert.equal(after.status, "ok");
  });
});

describe("convert", () => {
  it("converts Karachi 15:00 to New York 05:00 in November", () => {
    const r = convert(
      { year: 2026, month: 11, day: 23, hour: 15, minute: 0, second: 0 },
      "Asia/Karachi",
      "America/New_York",
    );
    assert.deepEqual(r.output, {
      year: 2026, month: 11, day: 23, hour: 5, minute: 0, second: 0,
    });
    assert.equal(r.outputAbbreviation, "EST");
    assert.equal(r.instant.getTime(), utc(2026, 11, 23, 10).getTime());
  });

  it("uses the summer offset when DST is in effect", () => {
    const r = convert(
      { year: 2026, month: 7, day: 1, hour: 15, minute: 0, second: 0 },
      "Asia/Karachi",
      "America/New_York",
    );
    // 15:00 PKT == 10:00 UTC == 06:00 EDT.
    assert.equal(r.output.hour, 6);
    assert.equal(r.outputAbbreviation, "EDT");
  });

  it("handles fractional offsets (Kathmandu +5:45)", () => {
    const r = convert(
      { year: 2026, month: 3, day: 1, hour: 12, minute: 0, second: 0 },
      "UTC",
      "Asia/Kathmandu",
    );
    assert.equal(r.output.hour, 17);
    assert.equal(r.output.minute, 45);
  });

  it("converts across the date line", () => {
    const r = convert(
      { year: 2026, month: 11, day: 23, hour: 22, minute: 0, second: 0 },
      "Asia/Tokyo",
      "America/Los_Angeles",
    );
    // 22:00 JST == 13:00 UTC == 05:00 PST, same day.
    assert.equal(r.output.day, 23);
    assert.equal(r.output.hour, 5);
  });

  it("throws for a nonexistent source time", () => {
    assert.throws(
      () =>
        convert(
          { year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
          "America/New_York",
          "UTC",
        ),
      /does not exist/,
    );
  });

  it("resolves an ambiguous source time to its first occurrence", () => {
    const r = convert(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      "America/New_York",
      "UTC",
    );
    assert.equal(r.instant.getTime(), utc(2026, 11, 1, 5, 30).getTime());
  });

  it("throws for an unknown zone", () => {
    assert.throws(
      () => convert(parseDateTime("2026-11-23T15:00"), "Mars/Olympus", "UTC"),
      /Unknown timezone/,
    );
  });
});

describe("diffMinutes", () => {
  it("Karachi is 10h ahead of New York in winter, 9h in summer", () => {
    assert.equal(diffMinutes(utc(2026, 1, 15), "Asia/Karachi", "America/New_York"), 600);
    assert.equal(diffMinutes(utc(2026, 7, 15), "Asia/Karachi", "America/New_York"), 540);
  });

  it("a zone diffed with itself is zero", () => {
    assert.equal(diffMinutes(utc(2026, 5, 1), "UTC", "UTC"), 0);
  });
});

describe("parseDateTime", () => {
  it("parses full datetimes with T or space separators", () => {
    assert.deepEqual(parseDateTime("2026-11-23T15:30:45"), {
      year: 2026, month: 11, day: 23, hour: 15, minute: 30, second: 45,
    });
    assert.deepEqual(parseDateTime("2026-11-23 15:30"), {
      year: 2026, month: 11, day: 23, hour: 15, minute: 30, second: 0,
    });
  });

  it("treats a bare date as midnight", () => {
    assert.deepEqual(parseDateTime("2026-11-23"), {
      year: 2026, month: 11, day: 23, hour: 0, minute: 0, second: 0,
    });
  });

  it("rejects impossible dates and malformed input", () => {
    assert.throws(() => parseDateTime("2026-02-30"), /Invalid date/);
    assert.throws(() => parseDateTime("2026-13-01"), /Invalid month/);
    assert.throws(() => parseDateTime("2026-11-23T25:00"), /Invalid time/);
    assert.throws(() => parseDateTime("tomorrow"), /Cannot parse/);
    assert.throws(() => parseDateTime("2026/11/23"), /Cannot parse/);
  });
});

describe("formatting", () => {
  it("formatOffset renders signed HH:MM", () => {
    assert.equal(formatOffset(330), "+05:30");
    assert.equal(formatOffset(-240), "-04:00");
    assert.equal(formatOffset(0), "+00:00");
    assert.equal(formatOffset(345), "+05:45");
  });

  it("formatOffsetLong renders a readable offset", () => {
    assert.equal(formatOffsetLong(330), "+5h 30m");
    assert.equal(formatOffsetLong(-240), "-4h");
    assert.equal(formatOffsetLong(45), "+45m");
  });

  it("formatWallTime renders ISO-like wall time", () => {
    assert.equal(
      formatWallTime({ year: 2026, month: 1, day: 5, hour: 9, minute: 4, second: 3 }),
      "2026-01-05T09:04:03",
    );
  });

  it("formatInstant renders ISO with the zone offset", () => {
    assert.equal(
      formatInstant(utc(2026, 11, 23, 10), "Asia/Karachi", "iso"),
      "2026-11-23T15:00:00+05:00",
    );
  });

  it("formatInstant renders Unix seconds", () => {
    assert.equal(
      formatInstant(utc(2026, 11, 23, 10), "UTC", "unix"),
      String(Math.floor(utc(2026, 11, 23, 10).getTime() / 1000)),
    );
  });

  it("formatInstant renders a human-readable string with abbreviation", () => {
    assert.equal(
      formatInstant(utc(2026, 11, 23, 10), "America/New_York", "human"),
      "Mon, 23 Nov 2026, 05:00:00 EST",
    );
  });
});
