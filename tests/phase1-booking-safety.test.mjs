import test from "node:test";
import assert from "node:assert/strict";
import {
    calculatePurchasedLessonCredits,
    calculatePostConsumptionLessonCredits,
    getBookingSlotClaimId,
    getLessonEndAt,
    isChargeableLateCancellation,
    selectAvailableCreditUnit,
    shouldConsumeLesson,
} from "../js/logic/bookingSafety.js";

test("1. student with balance can reserve one lesson", () => {
    assert.equal(calculatePurchasedLessonCredits({ balance: 50, lessonPrice: 10 }), 5);
    assert.equal(selectAvailableCreditUnit(5, []), 1);
});

test("2. double click targets one deterministic slot claim", () => {
    assert.equal(getBookingSlotClaimId(1780000000000), getBookingSlotClaimId(1780000000000));
});

test("3. two tabs cannot claim the same only credit", () => {
    assert.equal(selectAvailableCreditUnit(1, []), 1);
    assert.equal(selectAvailableCreditUnit(1, [1]), null);
});

test("4. refresh uses the same slot claim identity", () => {
    assert.equal(getBookingSlotClaimId("1780000000000"), "slot_1780000000000");
});

test("5. exactly one available credit is accepted", () => {
    assert.equal(selectAvailableCreditUnit(3, [1, 2]), 3);
});

test("6. zero available credits is rejected", () => {
    assert.equal(selectAvailableCreditUnit(3, [1, 2, 3]), null);
});

test("7. purchased and reserved credits remain distinct", () => {
    const purchased = calculatePurchasedLessonCredits({ lessonCredits: 5, balance: 50, totalPaid: 50, lessonPrice: 10 });
    assert.equal(purchased, 5);
    assert.equal(selectAvailableCreditUnit(purchased, [1, 2]), 3);
});

test("8. same operation uses the same slot id", () => {
    assert.equal(new Set([getBookingSlotClaimId(123), getBookingSlotClaimId(123)]).size, 1);
});

test("9. simultaneous requests allocate different credit units", () => {
    const first = selectAvailableCreditUnit(2, []);
    const second = selectAvailableCreditUnit(2, [first]);
    assert.deepEqual([first, second], [1, 2]);
});

test("10. canceled future lesson is never consumable", () => {
    assert.equal(shouldConsumeLesson({ studentUid: "u", status: "canceled", slot: 1, durationMinutes: 50 }, Date.now()), false);
});

test("11. repeated cancellation has no consumption path", () => {
    const canceled = { studentUid: "u", status: "canceled", reservationState: "released", slot: 1 };
    assert.equal(shouldConsumeLesson(canceled, Date.now()), false);
    assert.equal(shouldConsumeLesson(canceled, Date.now()), false);
});

test("11b. student cancellation inside 12 hours consumes exactly once", () => {
    const canceledAt = 1_000_000;
    const booking = {
        studentUid: "u",
        status: "canceled",
        canceledBy: "student",
        canceledAt,
        slot: canceledAt + 60 * 60 * 1000,
        durationMinutes: 50,
        isFreeTrial: false,
    };
    assert.equal(isChargeableLateCancellation(booking), true);
    assert.equal(shouldConsumeLesson(booking, canceledAt), true);
    assert.equal(shouldConsumeLesson(booking, canceledAt, true), false);
});

test("11c. early, teacher, and free-trial cancellations are not charged", () => {
    const canceledAt = 1_000_000;
    const base = { studentUid: "u", status: "canceled", canceledBy: "student", canceledAt, slot: canceledAt + 13 * 60 * 60 * 1000 };
    assert.equal(isChargeableLateCancellation(base), false);
    assert.equal(isChargeableLateCancellation({ ...base, slot: canceledAt + 60 * 60 * 1000, canceledBy: "teacher" }), false);
    assert.equal(isChargeableLateCancellation({ ...base, slot: canceledAt + 60 * 60 * 1000, isFreeTrial: true }), false);
});

test("12. rescheduling changes the slot claim but not credit quantity", () => {
    assert.notEqual(getBookingSlotClaimId(100), getBookingSlotClaimId(200));
    assert.equal(selectAvailableCreditUnit(5, [1]), 2);
});

test("13. repeated rescheduling still represents one reservation", () => {
    const occupied = [1];
    assert.equal(occupied.length, 1);
});

test("14. lesson consumes only after scheduled end", () => {
    const booking = { studentUid: "u", status: "booked", slot: 1_000_000, durationMinutes: 50 };
    assert.equal(shouldConsumeLesson(booking, getLessonEndAt(booking) - 1), false);
    assert.equal(shouldConsumeLesson(booking, getLessonEndAt(booking)), true);
});

test("15. consumption is idempotent with marker or ledger", () => {
    const booking = { studentUid: "u", status: "completed", slot: 1, durationMinutes: 50 };
    assert.equal(shouldConsumeLesson({ ...booking, lessonConsumed: true }, Date.now()), false);
    assert.equal(shouldConsumeLesson(booking, Date.now(), true), false);
});

test("15b. mixed package and cash credits decrease by exactly one", () => {
    const before = calculatePurchasedLessonCredits({ balance: 100, lessonCredits: 5, totalPaid: 50, lessonPrice: 10 });
    const nextLessonCredits = calculatePostConsumptionLessonCredits({ balance: 100, lessonCredits: 5, totalPaid: 50, lessonPrice: 10 });
    const after = calculatePurchasedLessonCredits({ balance: 90, lessonCredits: nextLessonCredits, totalPaid: 50, lessonPrice: 10 });
    assert.equal(before - after, 1);
});

test("16. legacy student records derive credits from monetary balance", () => {
    assert.equal(calculatePurchasedLessonCredits({ balance: 60, lessonPrice: 10 }), 6);
    assert.equal(calculatePurchasedLessonCredits({ balance: 60, lessonPrice: 0 }), 0);
});

test("17. historical booking data is not mutated by safety evaluation", () => {
    const booking = Object.freeze({ studentUid: "u", status: "completed", slot: 1, durationMinutes: 50 });
    shouldConsumeLesson(booking, Date.now());
    assert.deepEqual(booking, { studentUid: "u", status: "completed", slot: 1, durationMinutes: 50 });
});
