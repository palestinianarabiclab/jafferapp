export const MIN_BOOKING_LEAD_MINUTES = 6 * 60;

export function isSlotBeyondMinimumLead(
    slotStartMs,
    nowMs = Date.now(),
    minimumLeadMinutes = MIN_BOOKING_LEAD_MINUTES
) {
    return Number.isFinite(slotStartMs)
        && slotStartMs >= nowMs + Math.max(0, minimumLeadMinutes) * 60000;
}

export function toMinutes(timeStr) {
    if (!timeStr || !timeStr.includes(":")) return null;
    const [h, m] = timeStr.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
}

export function addDaysToDateKey(dateKey, days) {
    const [y, m, d] = dateKey.split("-").map(Number);
    const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    base.setUTCDate(base.getUTCDate() + days);
    return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export function getZonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const data = {};
    parts.forEach((part) => {
        if (part.type !== "literal") data[part.type] = part.value;
    });
    return {
        year: Number(data.year),
        month: Number(data.month),
        day: Number(data.day),
        hour: Number(data.hour),
        minute: Number(data.minute),
        second: Number(data.second),
        weekday: data.weekday,
    };
}

function getZonedDateKey(date, timeZone) {
    const parts = getZonedParts(date, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getTimeZoneOffsetMs(timeZone, date) {
    const parts = getZonedParts(date, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    return asUtc - date.getTime();
}

export function zonedDateTimeToUtcMs(timeZone, year, month, day, hour, minute) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    const offset = getTimeZoneOffsetMs(timeZone, new Date(utcGuess));
    return utcGuess - offset;
}

export function isSlotBlockedByException(slotStartMs, slotMinutes, { bookingSettings, runtimeBusyBlocks, getLocalTimezone }) {
    const combinedBlocks = [
        ...(Array.isArray(bookingSettings.exceptions) ? bookingSettings.exceptions : []),
        ...(Array.isArray(runtimeBusyBlocks) ? runtimeBusyBlocks : []),
    ];
    if (!combinedBlocks.length) return false;
    const teacherTimezone = bookingSettings.timezone || getLocalTimezone() || "UTC";
    const slotEndMs = slotStartMs + slotMinutes * 60000;
    return combinedBlocks.some((ex) => {
        if (!ex || !ex.date) return false;
        if (Number.isFinite(ex.startMs) && Number.isFinite(ex.endMs)) {
            return slotStartMs < Number(ex.endMs) && slotEndMs > Number(ex.startMs);
        }
        const exStart = toMinutes(ex.start);
        const exEnd = toMinutes(ex.end);
        if (exStart === null || exEnd === null) return false;
        const [year, month, day] = ex.date.split("-").map(Number);
        if (!year || !month || !day) return false;
        const exStartMs = zonedDateTimeToUtcMs(
            teacherTimezone,
            year,
            month,
            day,
            Math.floor(exStart / 60),
            exStart % 60
        );
        const endDateKey = exEnd <= exStart ? addDaysToDateKey(ex.date, 1) : ex.date;
        const [endYear, endMonth, endDay] = endDateKey.split("-").map(Number);
        const exEndMs = zonedDateTimeToUtcMs(
            teacherTimezone,
            endYear,
            endMonth,
            endDay,
            Math.floor(exEnd / 60),
            exEnd % 60
        );
        return slotStartMs < exEndMs && slotEndMs > exStartMs;
    });
}

const bookedSlotsCache = new Map();
const BOOKED_SLOTS_CACHE_MS = 60000;

export function invalidateBookedSlotsCache() {
    bookedSlotsCache.clear();
}

export async function getBookedSlotsMap(startMs, endMs, { db, bookingSettings }) {
    const cacheKey = `${startMs}:${endMs}:${bookingSettings.totalSlotMinutes || bookingSettings.slotMinutes || 50}`;
    const cached = bookedSlotsCache.get(cacheKey);
    if (cached && Date.now() - cached.at < BOOKED_SLOTS_CACHE_MS) {
        return cached.value;
    }
    const booked = new Map();
    const occupiedMinutes = bookingSettings.totalSlotMinutes || bookingSettings.slotMinutes || 50;
    try {
        const snap = await db
            .collection("publicBookings")
            .where("slot", ">=", startMs - occupiedMinutes * 60000)
            .where("slot", "<", endMs)
            .get();
        snap.forEach((doc) => {
            const data = doc.data();
            if (!data || !data.slot) return;
            const status = (data.status || "booked").toLowerCase();
            if (status === "canceled") return;
            const bookingDuration = Number(data.durationMinutes || occupiedMinutes);
            const bookingBreak = Number(bookingSettings.breakMinutes || 0);
            booked.set(doc.id, {
                id: doc.id,
                start: Number(data.slot),
                end: Number(data.slot) + (bookingDuration + bookingBreak) * 60000,
                status,
                ...data,
            });
        });
    } catch {}
    bookedSlotsCache.set(cacheKey, {
        at: Date.now(),
        value: booked,
    });
    return booked;
}

export function doesSlotOverlap(slotStartMs, slotMinutes, bookedMap, excludeBookingId = null) {
    const slotEndMs = slotStartMs + slotMinutes * 60000;
    return Array.from(bookedMap.values()).some((booking) => {
        if (!booking || !booking.start || !booking.end) return false;
        if (excludeBookingId && booking.id === excludeBookingId) return false;
        return slotStartMs < booking.end && slotEndMs > booking.start;
    });
}

export async function findBookingConflict(slotStartMs, deps, { excludeBookingId = null } = {}) {
    const occupiedMinutes = deps.bookingSettings.totalSlotMinutes || deps.bookingSettings.slotMinutes || 50;
    const slotEndMs = slotStartMs + occupiedMinutes * 60000;
    if (isSlotBlockedByException(slotStartMs, occupiedMinutes, deps)) {
        return {
            id: "calendar-busy",
            start: slotStartMs,
            end: slotEndMs,
            status: "busy",
            reason: "Google Calendar busy block",
        };
    }
    const booked = await getBookedSlotsMap(slotStartMs, slotEndMs, deps);
    const match = Array.from(booked.values()).find((booking) => {
        if (!booking || !booking.start || !booking.end) return false;
        if (excludeBookingId && booking.id === excludeBookingId) return false;
        return slotStartMs < booking.end && slotEndMs > booking.start;
    });
    return match || null;
}

export async function getSchedulableSlots(daysToShow = 14, deps, options = {}) {
    const { bookingSettings, getLocalTimezone, getDateKey, runtimeBusyBlocks } = deps;
    const stepMinutes = 30;
    const slotMinutes = bookingSettings.slotMinutes || 50;
    const occupiedMinutes = bookingSettings.totalSlotMinutes || slotMinutes;
    const teacherTimezone = bookingSettings.timezone || getLocalTimezone() || "UTC";
    const now = Date.now();
    const requestedRangeStartMs = Number.isFinite(options.rangeStartMs)
        ? Number(options.rangeStartMs)
        : now;
    const requestedRangeEndMs = Number.isFinite(options.rangeEndMs)
        ? Number(options.rangeEndMs)
        : (requestedRangeStartMs + (daysToShow + 3) * 24 * 60 * 60 * 1000);
    const minimumLeadMinutes = Number.isFinite(options.minimumLeadMinutes)
        ? Math.max(0, Number(options.minimumLeadMinutes))
        : 0;
    const effectiveRangeStartMs = Math.max(
        now + minimumLeadMinutes * 60000,
        requestedRangeStartMs
    );
    const teacherRangeStart = getZonedDateKey(
        new Date(effectiveRangeStartMs - 24 * 60 * 60 * 1000),
        teacherTimezone
    );
    const teacherRangeEnd = getZonedDateKey(
        new Date(requestedRangeEndMs + 24 * 60 * 60 * 1000),
        teacherTimezone
    );
    const teacherDateKeys = [];
    for (
        let dateKey = teacherRangeStart;
        dateKey <= teacherRangeEnd;
        dateKey = addDaysToDateKey(dateKey, 1)
    ) {
        teacherDateKeys.push(dateKey);
    }

    function addCandidateRange(dateKey, rangeStartMin, rangeEndMin) {
        const [year, month, day] = dateKey.split("-").map(Number);
        if (!Number.isFinite(rangeStartMin) || !Number.isFinite(rangeEndMin)) return;
        if (rangeEndMin <= rangeStartMin) return;
        for (let minute = rangeStartMin; minute + occupiedMinutes <= rangeEndMin; minute += stepMinutes) {
            const hour = Math.floor(minute / 60);
            const mins = minute % 60;
            const ts = zonedDateTimeToUtcMs(teacherTimezone, year, month, day, hour, mins);
            if (ts >= effectiveRangeStartMs && ts < requestedRangeEndMs) {
                candidateStarts.push(ts);
            }
        }
    }

    const candidateStarts = [];
    teacherDateKeys.forEach((dateKey) => {
        const [year, month, day] = dateKey.split("-").map(Number);
        const weekday = getZonedParts(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)), teacherTimezone).weekday;
        const info = bookingSettings.days[weekday];
        if (!info || !info.enabled) return;
        const startMin = toMinutes(info.start);
        const endMin = toMinutes(info.end);
        if (startMin === null || endMin === null) return;
        if (endMin > startMin) {
            addCandidateRange(dateKey, startMin, endMin);
        } else {
            addCandidateRange(dateKey, startMin, 24 * 60);
            const nextDateKey = addDaysToDateKey(dateKey, 1);
            addCandidateRange(nextDateKey, 0, endMin);
        }
    });

    if (!candidateStarts.length) return [];

    const searchStart = Math.min(...candidateStarts);
    const searchEnd = Math.max(...candidateStarts) + occupiedMinutes * 60000;
    const booked = await getBookedSlotsMap(searchStart, searchEnd, deps);
    return candidateStarts
        .map((ts) => {
            const blockedByException = isSlotBlockedByException(ts, occupiedMinutes, { bookingSettings, runtimeBusyBlocks, getLocalTimezone });
            const blockedByBooking = doesSlotOverlap(ts, occupiedMinutes, booked, options.excludeBookingId);
            const available = !blockedByException && !blockedByBooking;
            return {
                startMs: ts,
                dateKey: getDateKey(new Date(ts)),
                available,
                reason: blockedByException ? "Busy" : blockedByBooking ? "Booked" : "",
            };
        })
        .sort((a, b) => a.startMs - b.startMs);
}

export async function getAvailableSlots(daysToShow = 14, deps, options = {}) {
    const schedule = await getSchedulableSlots(daysToShow, deps, options);
    return schedule.filter((slot) => slot.available).map((slot) => new Date(slot.startMs));
}
