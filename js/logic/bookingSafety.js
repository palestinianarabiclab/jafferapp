export function calculatePurchasedLessonCredits({ balance = 0, lessonCredits, totalPaid = 0, lessonPrice = 0 } = {}) {
    const safePrice = Number(lessonPrice);
    const safeBalance = Number(balance);
    const safePaid = Number(totalPaid);
    const explicitCredits = Number.isFinite(Number(lessonCredits))
        ? Math.max(0, Math.floor(Number(lessonCredits)))
        : null;
    if (!(safePrice > 0)) return explicitCredits ?? 0;
    if (explicitCredits === null) return Math.max(0, Math.floor((Number.isFinite(safeBalance) ? safeBalance : 0) / safePrice));
    const unallocatedBalance = Math.max(0, (Number.isFinite(safeBalance) ? safeBalance : 0) - (Number.isFinite(safePaid) ? safePaid : 0));
    return explicitCredits + Math.floor(unallocatedBalance / safePrice);
}

export function selectAvailableCreditUnit(totalCredits, occupiedUnits = []) {
    const occupied = new Set(occupiedUnits.map(Number));
    const limit = Math.min(500, Math.max(0, Math.floor(Number(totalCredits) || 0)));
    for (let unit = 1; unit <= limit; unit += 1) {
        if (!occupied.has(unit)) return unit;
    }
    return null;
}

export function calculatePostConsumptionLessonCredits({ balance = 0, lessonCredits = 0, totalPaid = 0, lessonPrice = 0 } = {}) {
    const price = Number(lessonPrice);
    const cashCredits = price > 0
        ? Math.max(0, Math.floor((Number(balance || 0) - Number(totalPaid || 0)) / price))
        : 0;
    return cashCredits > 0
        ? Math.max(0, Number(lessonCredits || 0))
        : Math.max(0, Number(lessonCredits || 0) - 1);
}

export function getLessonEndAt(booking = {}) {
    const explicitConsumeAfter = Number(booking.consumeAfter || 0);
    if (explicitConsumeAfter > 0) return explicitConsumeAfter;
    return Number(booking.slot || 0) + Math.max(1, Number(booking.durationMinutes || booking.slotMinutes || 50)) * 60000;
}

export function getBookingIntervalClaimIds(slot, durationMinutes, bucketMinutes = 5) {
    const start = Math.trunc(Number(slot || 0));
    const duration = Math.max(1, Number(durationMinutes || 50));
    const bucketMs = Math.max(1, Number(bucketMinutes || 5)) * 60000;
    if (!start) return [];
    const firstBucket = Math.floor(start / bucketMs);
    const endExclusive = start + duration * 60000;
    const lastBucket = Math.floor((endExclusive - 1) / bucketMs);
    const ids = [];
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        ids.push(`interval_${bucketMinutes}_${bucket}`);
    }
    return ids;
}

export function isLessonHistorical(booking = {}, now = Date.now()) {
    return getLessonEndAt(booking) <= Number(now);
}

export function isChargeableLateCancellation(booking = {}, cutoffMs = 12 * 60 * 60 * 1000) {
    const status = String(booking.status || "booked").toLowerCase();
    const canceledBy = String(booking.canceledBy || "").toLowerCase();
    const canceledAt = Number(booking.canceledAt || 0);
    const slot = Number(booking.slot || 0);
    return Boolean(
        booking.studentUid &&
        booking.isFreeTrial !== true &&
        status === "canceled" &&
        canceledBy === "student" &&
        canceledAt > 0 &&
        slot > 0 &&
        slot - canceledAt < Number(cutoffMs)
    );
}

export function shouldConsumeLesson(booking = {}, now = Date.now(), ledgerExists = false) {
    const status = String(booking.status || "booked").toLowerCase();
    const lateCancellation = isChargeableLateCancellation(booking);
    return Boolean(
        booking.studentUid &&
        (status !== "canceled" || lateCancellation) &&
        booking.lessonConsumed !== true &&
        !booking.balanceChargedAt &&
        booking.balanceCharged !== true &&
        !ledgerExists &&
        (lateCancellation || getLessonEndAt(booking) <= now)
    );
}

export function getBookingSlotClaimId(slot) {
    return `slot_${Math.trunc(Number(slot || 0))}`;
}
