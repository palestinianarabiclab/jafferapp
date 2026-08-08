export const NOTIFICATION_STATES = Object.freeze({
    PENDING: "pending",
    SENDING: "sending",
    SENT: "sent",
    FAILED: "failed",
    SKIPPED: "skipped",
});

export const MAX_NOTIFICATION_ATTEMPTS = 8;

export function isValidNotificationEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim().toLowerCase());
}

export function getNotificationJobId(bookingId, notificationType, operationVersion, recipientType) {
    return ["booking", bookingId, notificationType, Math.trunc(Number(operationVersion || 0)), recipientType]
        .map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "_"))
        .join("_");
}

export function getNotificationRetryAt(attempts = 0, now = Date.now()) {
    const count = Math.max(0, Math.floor(Number(attempts) || 0));
    return Number(now) + Math.min(24 * 60, Math.pow(2, Math.min(count, 10))) * 60000;
}

export function createNotificationJob({ bookingId, notificationType, operationVersion, recipientType, recipientEmail, actor = "system", now = Date.now() }) {
    const email = String(recipientEmail || "").trim().toLowerCase();
    const valid = isValidNotificationEmail(email);
    const id = getNotificationJobId(bookingId, notificationType, operationVersion, recipientType);
    return {
        id,
        bookingId: String(bookingId),
        recipientType,
        recipientEmail: email,
        notificationType,
        operationVersion: Math.trunc(Number(operationVersion || 0)),
        actor,
        state: valid ? NOTIFICATION_STATES.PENDING : NOTIFICATION_STATES.SKIPPED,
        attempts: 0,
        createdAt: Number(now),
        sentAt: 0,
        lastAttemptAt: 0,
        nextRetryAt: valid ? Number(now) : 0,
        lastError: valid ? "" : `Missing or invalid ${recipientType} email.`,
        idempotencyKey: id,
    };
}

export function shouldAttemptNotification(job = {}, now = Date.now()) {
    if (![NOTIFICATION_STATES.PENDING, NOTIFICATION_STATES.FAILED].includes(String(job.state || ""))) return false;
    if (Number(job.attempts || 0) >= MAX_NOTIFICATION_ATTEMPTS) return false;
    return Number(job.nextRetryAt || 0) <= Number(now);
}

export function isNotificationSuperseded(job = {}, booking = {}) {
    return job.notificationType === "reschedule"
        && Number(booking.rescheduledAt || 0) > Number(job.operationVersion || 0);
}

export function notificationPatchDoesNotTouchBookingSafety(patch = {}) {
    const protectedFields = ["balance", "lessonCredits", "reservationState", "reservationClaimId", "slot", "consumeAfter", "lessonConsumed", "googleCalendarEventId"];
    return protectedFields.every((field) => !Object.prototype.hasOwnProperty.call(patch, field));
}

export function shouldWaitForMeetLink(job = {}, booking = {}) {
    return job.notificationType === "created" && !String(booking.meetingUrl || "").trim();
}

export function applyNotificationAttempt(job = {}, { success = false, error = "", now = Date.now() } = {}) {
    if (job.state === NOTIFICATION_STATES.SENT || job.state === NOTIFICATION_STATES.SKIPPED) return { ...job };
    const attempts = Number(job.attempts || 0) + 1;
    if (success) {
        return { ...job, state: NOTIFICATION_STATES.SENT, attempts, sentAt: Number(now), lastAttemptAt: Number(now), nextRetryAt: 0, lastError: "" };
    }
    return {
        ...job,
        state: NOTIFICATION_STATES.FAILED,
        attempts,
        lastAttemptAt: Number(now),
        nextRetryAt: attempts >= MAX_NOTIFICATION_ATTEMPTS ? 0 : getNotificationRetryAt(attempts, now),
        lastError: String(error || "Email delivery failed.").slice(0, 1000),
    };
}
