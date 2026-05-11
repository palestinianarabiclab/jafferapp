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
        const body = { action, ...payload };
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
            allowGet ? 15000 : 12000
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

async function fetchBusyBlocksFromAppsScript({ days = 30, timeZone = "Africa/Cairo" } = {}) {
    return callAppsScript("getBusy", { days, timeZone }, { allowGet: true });
}

async function getAppsScriptEmailQuota() {
    return callAppsScript("getEmailQuota", {}, { allowGet: true });
}

async function installLessonReminderTrigger() {
    return callAppsScript("installReminderTrigger", {}, { allowGet: true });
}

async function sendLessonReminderCheck() {
    return callAppsScript("sendReminderCheck", {}, { allowGet: true });
}

async function createBookingViaAppsScript(payload) {
    return callAppsScript("createBooking", payload);
}

async function deleteBookingViaAppsScript(payload) {
    return callAppsScript("deleteBooking", payload);
}

async function syncPendingBookingsViaAppsScript({ limit = 10 } = {}) {
    try {
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
        for (const doc of pendingDocs) {
            const booking = doc.data();
            if (!booking || !booking.slot || booking.status === "canceled") continue;
            const result = await createBookingViaAppsScript({
                bookingId: doc.id,
                slot: booking.slot,
                durationMinutes: booking.slotMinutes || window.bookingSettings?.slotMinutes || 50,
                timeZone: booking.timezone || window.bookingSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Cairo",
                name: booking.name || "",
                email: booking.email || "",
                phone: booking.phone || "",
                notes: booking.notes || "",
            });
            if (result?.success) {
                await window.db.collection("bookings").doc(doc.id).set({
                    calendarSynced: true,
                    googleCalendarEventId: result.eventId || null,
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
            }
        }
        return {
            success: failedCount === 0,
            syncedCount,
            failedCount,
            message: failedCount ? `Synced ${syncedCount} bookings. ${failedCount} failed.` : `Synced ${syncedCount} bookings.`,
        };
    } catch (err) {
        return { success: false, message: err?.message || String(err), syncedCount: 0, failedCount: 0 };
    }
}

window.saveAppsScriptSettings = saveAppsScriptSettings;
window.testAppsScriptConnection = testAppsScriptConnection;
window.fetchBusyBlocksFromAppsScript = fetchBusyBlocksFromAppsScript;
window.getAppsScriptEmailQuota = getAppsScriptEmailQuota;
window.installLessonReminderTrigger = installLessonReminderTrigger;
window.sendLessonReminderCheck = sendLessonReminderCheck;
window.createBookingViaAppsScript = createBookingViaAppsScript;
window.deleteBookingViaAppsScript = deleteBookingViaAppsScript;
window.syncPendingBookingsViaAppsScript = syncPendingBookingsViaAppsScript;
