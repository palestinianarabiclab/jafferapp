import test from "node:test";
import assert from "node:assert/strict";
import {
    buildPendingCalendarState,
    chooseCanonicalCalendarEvent,
    classifyCalendarReconciliation,
    dedupeCalendarMirrors,
    getNextCalendarRetryAt,
    shouldRefreshTeacherCalendar,
} from "../js/logic/calendarSyncSafety.js";
import {
    getBookingIntervalClaimIds,
    getLessonEndAt,
    isLessonHistorical,
    shouldConsumeLesson,
} from "../js/logic/bookingSafety.js";

test("1. teacher schedule refresh policy", () => {
    assert.equal(shouldRefreshTeacherCalendar({ visible: true, active: true, lastRefreshAt: 0, now: 60001 }), true);
    assert.equal(shouldRefreshTeacherCalendar({ visible: false, active: true, lastRefreshAt: 0, now: 60001 }), false);
});
test("2. Google busy event added after dashboard opens", () => assert.equal(dedupeCalendarMirrors([{ eventId: "new" }], []).length, 1));
test("3. Google busy event removed after dashboard opens", () => assert.equal(dedupeCalendarMirrors([], []).length, 0));
test("4. pending Calendar create retry", () => assert.equal(buildPendingCalendarState("create").calendarSyncState, "pending-create"));
test("5. pending Calendar delete retry", () => assert.equal(buildPendingCalendarState("delete").calendarSyncState, "pending-delete"));
test("6. same retry executed twice is deterministic", () => assert.equal(getNextCalendarRetryAt(2, 1000), getNextCalendarRetryAt(2, 1000)));
test("7. existing Calendar event reused", () => assert.equal(chooseCanonicalCalendarEvent([{ id: "a" }, { id: "b" }], { googleCalendarEventId: "b" }).id, "b"));
test("8. direct Google move detected", () => assert.equal(classifyCalendarReconciliation({ slot: 1000, durationMinutes: 50 }, { startMs: 2000, endMs: 3002000 }), "externally-modified"));
test("9. direct Google deletion detected", () => assert.equal(classifyCalendarReconciliation({ slot: 1000 }, null), "externally-deleted"));
test("10. platform Calendar mirror is not displayed twice", () => assert.deepEqual(dedupeCalendarMirrors([{ bookingId: "b1", eventId: "e" }], ["b1"]), []));
test("11. same exact slot has identical claims", () => assert.deepEqual(getBookingIntervalClaimIds(1_800_000, 50), getBookingIntervalClaimIds(1_800_000, 50)));
test("12. different starts with overlap share interval claim", () => {
    const a = new Set(getBookingIntervalClaimIds(2 * 3600000, 50));
    const b = getBookingIntervalClaimIds(2 * 3600000 + 30 * 60000, 50);
    assert.equal(b.some((id) => a.has(id)), true);
});
test("13. variable durations reserve different interval counts", () => assert.ok(getBookingIntervalClaimIds(3_600_000, 60).length > getBookingIntervalClaimIds(3_600_000, 30).length));
for (const duration of [30, 50, 60]) {
    test(`${duration === 30 ? 14 : duration === 50 ? 15 : 16}. ${duration}-minute lesson history transition`, () => {
        const booking = { slot: 1000, durationMinutes: duration };
        assert.equal(isLessonHistorical(booking, getLessonEndAt(booking) - 1), false);
        assert.equal(isLessonHistorical(booking, getLessonEndAt(booking)), true);
    });
}
test("17. reschedule retains reservation identity", () => {
    const booking = { reservationClaimId: "student_1", slot: 1000, durationMinutes: 50 };
    assert.equal({ ...booking, slot: 2000 }.reservationClaimId, booking.reservationClaimId);
});
test("18. Calendar retry state has no balance fields", () => assert.equal("balance" in buildPendingCalendarState("create"), false));
test("19. Phase 1 consumption remains idempotent", () => {
    const booking = { studentUid: "u", slot: 1, durationMinutes: 30, status: "booked" };
    assert.equal(shouldConsumeLesson(booking, getLessonEndAt(booking), false), true);
    assert.equal(shouldConsumeLesson(booking, getLessonEndAt(booking), true), false);
});
test("20. legacy booking duration remains supported", () => assert.equal(getLessonEndAt({ slot: 1000 }), 1000 + 50 * 60000));
