async function readBookingSettingsDoc() {
    try {
        const snap = await window.db.collection("bookingSettings").doc("primary").get();
        return snap.exists ? (snap.data() || {}) : {};
    } catch {
        return {};
    }
}

async function readTeacherAppsScriptSettings() {
    try {
        const user = window.firebase?.auth()?.currentUser;
        if (!user) return {};
        const snap = await window.db.collection("teachers").doc(user.uid).get();
        const data = snap.exists ? (snap.data() || {}) : {};
        return data.appsScript || {};
    } catch {
        return {};
    }
}

const appsScriptUrlCache = {
    value: "",
    expiresAt: 0,
};

function normalizeWebAppUrl(url) {
    return (url || "").trim();
}

function toQueryString(payload) {
    return new URLSearchParams(
        Object.entries(payload).map(([key, value]) => [key, String(value)])
    ).toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } finally {
        window.clearTimeout(timeoutId);
    }
}

async function parseAppsScriptResponse(response) {
    const text = await response.text();
    if (!response.ok) {
        let parsedError = null;
        try {
            parsedError = text ? JSON.parse(text) : null;
        } catch {}
        return {
            success: false,
            message: parsedError?.message || `Apps Script request failed (${response.status}).`,
        };
    }
    try {
        return text ? JSON.parse(text) : {};
    } catch (err) {
        return {
            success: false,
            message: err?.message || "Apps Script returned invalid JSON.",
        };
    }
}

async function getAppsScriptWebAppUrl() {
    if (appsScriptUrlCache.value && Date.now() < appsScriptUrlCache.expiresAt) {
        return appsScriptUrlCache.value;
    }
    const teacherSettings = await readTeacherAppsScriptSettings();
    if (teacherSettings.webAppUrl) {
        appsScriptUrlCache.value = normalizeWebAppUrl(teacherSettings.webAppUrl);
        appsScriptUrlCache.expiresAt = Date.now() + 60000;
        return appsScriptUrlCache.value;
    }
    const bookingData = await readBookingSettingsDoc();
    appsScriptUrlCache.value = normalizeWebAppUrl(bookingData.appsScript?.webAppUrl || "");
    appsScriptUrlCache.expiresAt = Date.now() + 60000;
    return appsScriptUrlCache.value;
}

async function callAppsScript(action, payload = {}, { allowGet = false } = {}) {
    const webAppUrl = await getAppsScriptWebAppUrl();
    if (!webAppUrl) {
        return { success: false, message: "Apps Script Web App URL is not configured." };
    }

    try {
        const currentUser = window.firebase?.auth()?.currentUser;
        const authToken = allowGet || !currentUser ? "" : await currentUser.getIdToken();
        const body = { action, ...payload, ...(authToken ? { authToken } : {}) };
        const requestUrl = allowGet ? `${webAppUrl}?${toQueryString(body)}` : webAppUrl;
        const res = await fetchWithTimeout(
            requestUrl,
            allowGet
                ? { method: "GET" }
                : {
                    method: "POST",
                    headers: { "Content-Type": "text/plain;charset=utf-8" },
                    body: JSON.stringify(body),
                },
            allowGet ? 15000 : 30000
        );
        return parseAppsScriptResponse(res);
    } catch (err) {
        return { success: false, message: err?.message || String(err) };
    }
}

async function saveAppsScriptSettings({ webAppUrl }) {
    const user = window.firebase?.auth()?.currentUser;
    if (!user) return { success: false, message: "Teacher is not logged in." };
    const normalizedUrl = normalizeWebAppUrl(webAppUrl);
    let teacherWriteOk = false;
    let bookingWriteOk = false;
    let lastError = null;

    try {
        await window.db.collection("teachers").doc(user.uid).set({
            appsScript: {
                webAppUrl: normalizedUrl,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            }
        }, { merge: true });
        teacherWriteOk = true;
    } catch (err) {
        lastError = err;
    }

    try {
        await window.db.collection("bookingSettings").doc("primary").set({
            appsScript: {
                webAppUrl: normalizedUrl,
                enabled: !!normalizedUrl,
                updatedAt: Date.now(),
            }
        }, { merge: true });
        bookingWriteOk = true;
    } catch (err) {
        lastError = err;
    }

    if (teacherWriteOk && bookingWriteOk) {
        appsScriptUrlCache.value = normalizedUrl;
        appsScriptUrlCache.expiresAt = Date.now() + 60000;
        return { success: true, message: normalizedUrl ? "Apps Script URL saved." : "Apps Script URL cleared." };
    }

    if (teacherWriteOk || bookingWriteOk) {
        return { success: true, message: "Apps Script URL saved partially. Recheck teacher settings after publishing rules." };
    }

    return { success: false, message: lastError?.message || String(lastError) };
}

async function testAppsScriptConnection() {
    return callAppsScript("test", {}, { allowGet: true });
}

async function fetchBusyBlocksFromAppsScript({ days = 30, timeZone = "Africa/Cairo", includeTeacherDetails = false, force = false } = {}) {
    return callAppsScript(
        includeTeacherDetails ? "getTeacherBusy" : "getBusy",
        { days, timeZone, fresh: force === true },
        { allowGet: !includeTeacherDetails }
    );
}

async function createBusyBlockViaAppsScript({ slot, durationMinutes = 60, title = "Busy" } = {}) {
    return callAppsScript("createBusyBlock", { slot, durationMinutes, title });
}

async function sendReviewRequestViaAppsScript({ studentId, siteUrl } = {}) {
    return callAppsScript("sendReviewRequest", { studentId, siteUrl });
}

async function notifyNewStudentSignupViaAppsScript({ studentId } = {}) {
    return callAppsScript("notifyNewStudentSignup", { studentId });
}

async function sendStudentBookingInvitationViaAppsScript({ studentId } = {}) {
    return callAppsScript("sendStudentBookingInvitation", { studentId });
}

async function getPreplyStatisticsViaAppsScript({ days = 730 } = {}) {
    return callAppsScript("getPreplyStatistics", { days });
}

async function getPreplyReviewsViaAppsScript() {
    return callAppsScript("getPreplyReviews");
}

async function getAppsScriptEmailQuota() {
    return callAppsScript("getEmailQuota");
}

async function installLessonReminderTrigger() {
    return callAppsScript("installReminderTrigger");
}

async function sendLessonReminderCheck() {
    return callAppsScript("sendReminderCheck");
}

async function createBookingViaAppsScript(payload) {
    return callAppsScript("createBooking", payload);
}

async function deleteBookingViaAppsScript(payload) {
    return callAppsScript("deleteBooking", payload);
}

async function rescheduleBookingViaAppsScript(payload) {
    return callAppsScript("rescheduleBooking", payload);
}

async function syncPendingBookingsViaAppsScript({ limit = 10 } = {}) {
    try {
        const bookingData = await readBookingSettingsDoc();
        const snap = await window.db
            .collection("bookings")
            .where("calendarSynced", "==", false)
            .limit(limit)
            .get();
        const pendingDocs = snap.docs.sort((a, b) => {
            const aTs = a.data()?.createdAt || 0;
            const bTs = b.data()?.createdAt || 0;
            return aTs - bTs;
        });
        let syncedCount = 0;
        let failedCount = 0;
        const failedDetails = [];
        for (const doc of pendingDocs) {
            const booking = doc.data();
            if (!booking || !booking.slot) continue;
            if (["externally-modified", "conflict"].includes(String(booking.calendarSyncState || ""))) continue;
            if (booking.status === "canceled") {
                if (!booking.calendarDeletePending) continue;
                const deleteResult = await deleteBookingViaAppsScript({
                    bookingId: doc.id,
                    eventId: booking.googleCalendarEventId || "",
                    slot: booking.slot,
                    canceledBy: booking.canceledBy || "Teacher",
                });
                if (deleteResult?.success) {
                    await window.db.collection("bookings").doc(doc.id).set({
                        calendarDeletePending: false,
                        calendarSyncState: "externally-deleted",
                        calendarLastSyncedAt: Date.now(),
                        calendarLastCheckedAt: Date.now(),
                        calendarNextRetryAt: 0,
                        calendarSyncLastError: "",
                        updatedAt: Date.now(),
                        history: window.firebase.firestore.FieldValue.arrayUnion({
                            at: Date.now(),
                            action: "calendar-deletion-synced",
                            by: "system",
                        }),
                    }, { merge: true });
                    syncedCount += 1;
                } else {
                    failedCount += 1;
                    const attempts = Number(booking.calendarSyncAttempts || 0) + 1;
                    const failedAt = Date.now();
                    await window.db.collection("bookings").doc(doc.id).set({
                        calendarSyncState: "pending-delete",
                        calendarSyncAttempts: attempts,
                        calendarSyncLastAttemptAt: failedAt,
                        calendarNextRetryAt: failedAt + Math.min(1440, Math.pow(2, Math.min(attempts, 8))) * 60000,
                        calendarSyncLastError: String(deleteResult?.message || "Calendar deletion failed.").slice(0, 1000),
                        updatedAt: failedAt,
                    }, { merge: true }).catch(() => {});
                    failedDetails.push(`${booking.name || booking.email || "Canceled booking"}: ${deleteResult?.message || "Calendar deletion failed"}`);
                }
                continue;
            }
            const isPendingUpdate = booking.calendarSyncState === "pending-update";
            const result = isPendingUpdate
                ? await rescheduleBookingViaAppsScript({
                    bookingId: doc.id,
                    eventId: booking.googleCalendarEventId || "",
                    oldSlot: Number(booking.rescheduledFrom || booking.slot || 0),
                    newSlot: Number(booking.slot || 0),
                    durationMinutes: booking.durationMinutes || booking.slotMinutes || window.bookingSettings?.slotMinutes || 50,
                })
                : await createBookingViaAppsScript({
                    bookingId: doc.id,
                    slot: booking.slot,
                    durationMinutes: booking.durationMinutes || booking.slotMinutes || window.bookingSettings?.slotMinutes || 50,
                    timeZone: booking.timezone || window.bookingSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Cairo",
                    name: booking.name || "",
                    email: booking.email || "",
                    phone: booking.phone || "",
                    notes: booking.notes || "",
                    teacherEmail: bookingData.contactEmail || "",
                });
            if (result?.success) {
                await window.db.collection("bookings").doc(doc.id).set({
                    calendarSynced: true,
                    calendarSyncState: "synced",
                    calendarLastSyncedAt: Date.now(),
                    calendarLastCheckedAt: Date.now(),
                    calendarNextRetryAt: 0,
                    calendarSyncLastError: "",
                    googleCalendarEventId: result.eventId || null,
                    meetingUrl: result.meetingUrl || "",
                    history: window.firebase.firestore.FieldValue.arrayUnion({
                        at: Date.now(),
                        action: "apps_script_synced",
                        by: "system"
                    })
                }, { merge: true });
                await window.db.collection("publicBookings").doc(doc.id).set({
                    calendarSynced: true,
                    updatedAt: Date.now(),
                }, { merge: true });
                syncedCount += 1;
            } else {
                failedCount += 1;
                const attempts = Number(booking.calendarSyncAttempts || 0) + 1;
                const failedAt = Date.now();
                await window.db.collection("bookings").doc(doc.id).set({
                    calendarSyncAttempts: attempts,
                    calendarSyncLastAttemptAt: failedAt,
                    calendarNextRetryAt: failedAt + Math.min(1440, Math.pow(2, Math.min(attempts, 8))) * 60000,
                    calendarSyncLastError: String(result?.message || "Calendar sync failed.").slice(0, 1000),
                    calendarSyncState: booking.status === "canceled" ? "pending-delete" : "failed",
                    updatedAt: failedAt,
                }, { merge: true }).catch(() => {});
                const slotLabel = booking.slot
                    ? new Date(Number(booking.slot)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                    : doc.id;
                failedDetails.push(`${booking.name || booking.email || "Booking"} (${slotLabel}): ${result?.message || "Unknown Apps Script error"}`);
            }
        }
        const details = failedDetails.length ? ` Details: ${failedDetails.slice(0, 3).join(" | ")}` : "";
        return {
            success: failedCount === 0,
            syncedCount,
            failedCount,
            failedDetails,
            message: failedCount ? `Synced ${syncedCount} bookings. ${failedCount} failed.${details}` : `Synced ${syncedCount} bookings.`,
        };
    } catch (err) {
        return { success: false, message: err?.message || String(err), syncedCount: 0, failedCount: 0 };
    }
}

window.saveAppsScriptSettings = saveAppsScriptSettings;
window.testAppsScriptConnection = testAppsScriptConnection;
window.fetchBusyBlocksFromAppsScript = fetchBusyBlocksFromAppsScript;
window.createBusyBlockViaAppsScript = createBusyBlockViaAppsScript;
window.sendReviewRequestViaAppsScript = sendReviewRequestViaAppsScript;
window.notifyNewStudentSignupViaAppsScript = notifyNewStudentSignupViaAppsScript;
window.sendStudentBookingInvitationViaAppsScript = sendStudentBookingInvitationViaAppsScript;
window.getPreplyStatisticsViaAppsScript = getPreplyStatisticsViaAppsScript;
window.getPreplyReviewsViaAppsScript = getPreplyReviewsViaAppsScript;
window.getAppsScriptEmailQuota = getAppsScriptEmailQuota;
window.installLessonReminderTrigger = installLessonReminderTrigger;
window.sendLessonReminderCheck = sendLessonReminderCheck;
window.createBookingViaAppsScript = createBookingViaAppsScript;
window.deleteBookingViaAppsScript = deleteBookingViaAppsScript;
window.rescheduleBookingViaAppsScript = rescheduleBookingViaAppsScript;
window.syncPendingBookingsViaAppsScript = syncPendingBookingsViaAppsScript;
