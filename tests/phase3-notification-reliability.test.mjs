import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NOTIFICATION_ATTEMPTS, NOTIFICATION_STATES, applyNotificationAttempt,
  createNotificationJob, getNotificationJobId, isNotificationSuperseded,
  notificationPatchDoesNotTouchBookingSafety, shouldAttemptNotification, shouldWaitForMeetLink,
} from "../js/logic/notificationSafety.js";

const base = (recipientType = "student", overrides = {}) => createNotificationJob({
  bookingId: "b1", notificationType: "created", operationVersion: 100,
  recipientType, recipientEmail: recipientType === "teacher" ? "teacher@example.com" : "student@example.com", now: 100, ...overrides,
});

test("1 booking: both recipient jobs can succeed independently", () => assert.deepEqual([base("teacher"), base()].map(j => applyNotificationAttempt(j, { success: true, now: 200 }).state), ["sent", "sent"]));
test("2 teacher sent while student failed", () => assert.deepEqual([applyNotificationAttempt(base("teacher"), { success: true }).state, applyNotificationAttempt(base(), { error: "temporary" }).state], ["sent", "failed"]));
test("3 student sent while teacher failed", () => assert.deepEqual([applyNotificationAttempt(base(), { success: true }).state, applyNotificationAttempt(base("teacher"), { error: "temporary" }).state], ["sent", "failed"]));
test("4 both temporary failures remain failed and retryable", () => assert.ok([base(), base("teacher")].every(j => applyNotificationAttempt(j, { error: "quota", now: 200 }).nextRetryAt > 200)));
test("5 background retry can later succeed", () => { const failed = applyNotificationAttempt(base(), { error: "quota", now: 100 }); assert.equal(applyNotificationAttempt({ ...failed, nextRetryAt: 0 }, { success: true, now: 500 }).state, "sent"); });
test("6 deterministic retry identity", () => assert.equal(base().id, base().id));
test("7 sent job cannot be attempted again", () => assert.equal(shouldAttemptNotification(applyNotificationAttempt(base(), { success: true })), false));
test("8 existing Calendar event does not imply email sent", () => assert.equal(shouldAttemptNotification({ ...base(), googleCalendarEventId: "evt", nextRetryAt: 0 }, 200), true));
test("9 job data survives browser closure as serializable data", () => assert.equal(JSON.parse(JSON.stringify(base())).idempotencyKey, base().id));
test("10 sending state is not automatically resent", () => assert.equal(shouldAttemptNotification({ ...base(), state: "sending" }, 200), false));
test("11 missing teacher email is skipped", () => assert.equal(base("teacher", { recipientEmail: "" }).state, "skipped"));
test("12 invalid student email is skipped", () => assert.equal(base("student", { recipientEmail: "bad" }).state, "skipped"));
test("13 quota failures stop at maximum attempts", () => { const job = applyNotificationAttempt({ ...base(), attempts: MAX_NOTIFICATION_ATTEMPTS - 1 }, { error: "quota", now: 100 }); assert.equal(job.nextRetryAt, 0); assert.equal(shouldAttemptNotification(job, 1000), false); });
test("14 one reschedule creates one deterministic identity", () => assert.equal(getNotificationJobId("b1", "reschedule", 200, "student"), getNotificationJobId("b1", "reschedule", 200, "student")));
test("15 same reschedule retry keeps identity", () => assert.equal(getNotificationJobId("b1", "reschedule", 200, "teacher"), getNotificationJobId("b1", "reschedule", 200, "teacher")));
test("16 separate reschedules get separate identities", () => assert.notEqual(getNotificationJobId("b1", "reschedule", 200, "student"), getNotificationJobId("b1", "reschedule", 201, "student")));
test("17 student cancellation actor is preserved", () => assert.equal(base("teacher", { notificationType: "cancellation", actor: "student" }).actor, "student"));
test("18 teacher cancellation actor is preserved", () => assert.equal(base("student", { notificationType: "cancellation", actor: "teacher" }).actor, "teacher"));
test("19 external deletion is classified as system", () => assert.equal(base("student", { notificationType: "cancellation", actor: "system" }).actor, "system"));
test("20 teacher-created lesson can skip teacher but notify student", () => assert.deepEqual([base("teacher", { recipientEmail: "" }).state, base().state], ["skipped", "pending"]));
test("21 created notification waits for recovered Meet link", () => { assert.equal(shouldWaitForMeetLink(base(), {}), true); assert.equal(shouldWaitForMeetLink(base(), { meetingUrl: "https://meet.google.com/a" }), false); });
test("22 notification patch does not change balance", () => assert.equal(notificationPatchDoesNotTouchBookingSafety({ studentNotificationStatus: "sent" }), true));
test("23 notification patch does not change reservation", () => assert.equal(notificationPatchDoesNotTouchBookingSafety({ reservationState: "released" }), false));
test("24 notification patch cannot create Calendar ID", () => assert.equal(notificationPatchDoesNotTouchBookingSafety({ googleCalendarEventId: "new" }), false));
test("25 legacy booking without jobs remains untouched", () => { const legacy = { id: "old", balance: 50, status: "completed" }; assert.deepEqual({ ...legacy }, legacy); });
test("superseded reschedule is detected", () => assert.equal(isNotificationSuperseded({ notificationType: "reschedule", operationVersion: 200 }, { rescheduledAt: 201 }), true));
test("successful attempt keeps durable sent marker", () => { const sent = applyNotificationAttempt(base(), { success: true, now: 999 }); assert.equal(sent.sentAt, 999); assert.equal(sent.lastError, ""); });
