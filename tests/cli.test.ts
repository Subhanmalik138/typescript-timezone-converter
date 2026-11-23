import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = new URL("../src/cli.js", import.meta.url).pathname;

async function tzc(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await run(process.execPath, [CLI, ...args]);
  return { stdout, stderr };
}

describe("CLI", () => {
  it("convert prints the destination time", async () => {
    const { stdout } = await tzc(
      "convert", "2026-11-23T15:00",
      "--from", "Asia/Karachi", "--to", "America/New_York",
    );
    assert.match(stdout, /2026-11-23T05:00:00/);
    assert.match(stdout, /America\/New_York/);
    assert.match(stdout, /EST/);
  });

  it("convert supports multiple --to zones and --json", async () => {
    const { stdout } = await tzc(
      "convert", "2026-11-23T15:00",
      "--from", "Asia/Karachi",
      "--to", "America/New_York", "--to", "Europe/London",
      "--json",
    );
    const parsed = JSON.parse(stdout) as {
      input: string;
      results: Array<{ zone: string; datetime: string }>;
    };
    assert.equal(parsed.input, "2026-11-23T15:00:00");
    assert.equal(parsed.results.length, 2);
    assert.equal(parsed.results[0]!.zone, "America/New_York");
    assert.equal(parsed.results[1]!.zone, "Europe/London");
    assert.match(parsed.results[1]!.datetime, /2026-11-23T10:00:00\+00:00/);
  });

  it("convert warns on an ambiguous time but still converts", async () => {
    const { stdout, stderr } = await tzc(
      "convert", "2026-11-01T01:30",
      "--from", "America/New_York", "--to", "UTC",
    );
    assert.match(stderr, /happens twice/);
    assert.match(stdout, /2026-11-01T05:30:00/);
  });

  it("convert refuses a nonexistent time", async () => {
    await assert.rejects(
      tzc("convert", "2026-03-08T02:30", "--from", "America/New_York", "--to", "UTC"),
      /does not exist/,
    );
  });

  it("offset reports a fractional offset", async () => {
    const { stdout } = await tzc("offset", "Asia/Kathmandu");
    assert.match(stdout, /UTC\+05:45/);
  });

  it("diff reports the gap between two zones", async () => {
    const { stdout } = await tzc(
      "diff", "Asia/Karachi", "America/New_York", "--at", "2026-01-15T12:00",
    );
    assert.match(stdout, /10h ahead/);
  });

  it("zones lists common zones", async () => {
    const { stdout } = await tzc("zones");
    assert.match(stdout, /Asia\/Karachi/);
    assert.match(stdout, /America\/New_York/);
  });

  it("rejects an unknown zone", async () => {
    await assert.rejects(
      tzc("offset", "Mars/Olympus"),
      /Unknown timezone/,
    );
  });
});
