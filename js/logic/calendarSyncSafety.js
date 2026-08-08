export const CALENDAR_SYNC_STATES = Object.freeze({
    PENDING_CREATE: "pending-create",
    SYNCED: "synced",
    PENDING_UPDATE: "pending-update",
    PENDING_DELETE: "pending-delete",
    CONFLICT: "conflict",
    FAILED: "failed",
    EXTERNALLY_MODIFIED: "externally-modified",
    EXTERNALLY_DELETED: "externally-deleted",
});

export function getNextCalendarRetryAt(attempts = 0, now = Date.now()) {
    const safeAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
    const delayMinutes = Math.min(24 * 60, Math.pow(2, Math.min(safeAttempts, 8)));
    return Number(now) + delayMinutes * 60000;
}

export function buildPendingCalendarState(action, previous = {}, now = Date.now()) {
    const stateByAction = {
        create: CALENDAR_SYNC_STATES.PENDING_CREATE,
        update: CALENDAR_SYNC_STATES.PENDING_UPDATE,
        delete: CALENDAR_SYNC_STATES.PENDING_DELETE,
    };
    return {
        calendarSynced: false,
        calendarSyncState: stateByAction[action] || CALENDAR_SYNC_STATES.FAILED,
        calendarSyncAttempts: Number(previous.calendarSyncAttempts || 0),
        calendarSyncLastError: "",
        calendarNextRetryAt: Number(now),
    };
}

export function chooseCanonicalCalendarEvent(events = [], booking = {}) {
    const expectedId = String(booking.googleCalendarEventId || "");
    const normalized = events.filter(Boolean);
    return normalized.find((event) => String(event.id || event.eventId || "") === expectedId)
        || normalized.slice().sort((a, b) => Number(a.created || a.start || 0) - Number(b.created || b.start || 0))[0]
        || null;
}

export function dedupeCalendarMirrors(events = [], platformBookingIds = []) {
    const platformIds = new Set(platformBookingIds.map(String));
    const seenExternal = new Set();
    return events.filter((event) => {
        const bookingId = String(event?.bookingId || "");
        if (bookingId && platformIds.has(bookingId)) return false;
        const key = `${event?.calendarId || ""}:${event?.eventId || event?.sourceEventId || ""}`;
        if (seenExternal.has(key)) return false;
        seenExternal.add(key);
        return true;
    });
}

export function shouldRefreshTeacherCalendar({ visible = true, active = true, lastRefreshAt = 0, now = Date.now(), minimumIntervalMs = 60000 } = {}) {
    return Boolean(visible && active && Number(now) - Number(lastRefreshAt || 0) >= Number(minimumIntervalMs));
}

export function classifyCalendarReconciliation(booking = {}, calendarEvent = null) {
    if (!calendarEvent) return "externally-deleted";
    const eventStart = Number(calendarEvent.startMs || calendarEvent.start || 0);
    const eventEnd = Number(calendarEvent.endMs || calendarEvent.end || 0);
    const durationMinutes = eventEnd > eventStart ? Math.round((eventEnd - eventStart) / 60000) : 0;
    if (eventStart !== Number(booking.slot || 0) || durationMinutes !== Number(booking.durationMinutes || booking.slotMinutes || 50)) {
        return "externally-modified";
    }
    return "synced";
}
