import test from "node:test";
import assert from "node:assert/strict";

import {
    MIN_BOOKING_LEAD_MINUTES,
    addDaysToDateKey,
    doesSlotOverlap,
    isSlotBeyondMinimumLead,
    isSlotBlockedByException,
    toMinutes,
    zonedDateTimeToUtcMs,
} from "../js/logic/bookingAvailability.js";

test("student booking requires a six-hour lead", () => {
    const now = Date.UTC(2026, 6, 24, 10, 0);
    assert.equal(MIN_BOOKING_LEAD_MINUTES, 360);
    assert.equal(isSlotBeyondMinimumLead(now + 359 * 60000, now), false);
    assert.equal(isSlotBeyondMinimumLead(now + 360 * 60000, now), true);
});

test("toMinutes parses valid times", () => {
    assert.equal(toMinutes("00:00"), 0);
    assert.equal(toMinutes("13:45"), 825);
});

test("toMinutes rejects missing and malformed values", () => {
    assert.equal(toMinutes(""), null);
    assert.equal(toMinutes("invalid"), null);
});

test("addDaysToDateKey crosses month and year boundaries", () => {
    assert.equal(addDaysToDateKey("2026-01-31", 1), "2026-02-01");
    assert.equal(addDaysToDateKey("2026-12-31", 1), "2027-01-01");
});

test("zonedDateTimeToUtcMs preserves UTC wall time", () => {
    assert.equal(
        zonedDateTimeToUtcMs("UTC", 2026, 7, 24, 10, 30),
        Date.UTC(2026, 6, 24, 10, 30)
    );
});

test("doesSlotOverlap treats touching lesson boundaries as available", () => {
    const booked = new Map([
        ["first", { id: "first", start: 1000, end: 4000 }],
    ]);
    assert.equal(doesSlotOverlap(3999, 1, booked), true);
    assert.equal(doesSlotOverlap(4000, 1, booked), false);
});

test("isSlotBlockedByException detects manual busy ranges", () => {
    const slotStart = Date.UTC(2026, 6, 24, 10, 0);
    const blocked = isSlotBlockedByException(slotStart, 50, {
        bookingSettings: {
            timezone: "UTC",
            exceptions: [{ date: "2026-07-24", start: "10:30", end: "11:30" }],
        },
        runtimeBusyBlocks: [],
        getLocalTimezone: () => "UTC",
    });
    assert.equal(blocked, true);
});

test("isSlotBlockedByException supports overnight ranges", () => {
    const slotStart = Date.UTC(2026, 6, 25, 0, 15);
    const blocked = isSlotBlockedByException(slotStart, 30, {
        bookingSettings: {
            timezone: "UTC",
            exceptions: [{ date: "2026-07-24", start: "23:30", end: "01:00" }],
        },
        runtimeBusyBlocks: [],
        getLocalTimezone: () => "UTC",
    });
    assert.equal(blocked, true);
});
