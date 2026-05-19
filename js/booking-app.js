import {
    createInitialBookingSettings,
    ensureBookingSettingsShape,
    getDefaultBookingSettings,
    saveBookingSettingsToCloud,
} from "./logic/bookingSettingsStore.js";
import {
    createInitialContactSettings,
    saveContactSettingsToCloud,
    buildWhatsAppUrl,
} from "./logic/contactSettingsStore.js";
import {
    loadBookingStatusByEmail,
    submitGuestBooking,
} from "./logic/guestBookingFlow.js";
import {
    renderTeacherBookings,
    cancelBooking,
    rescheduleBooking,
    clearAllBookings,
} from "./logic/teacherBookingAdmin.js";
import {
    bootstrapTeacherAccess,
    resolveUserRole,
} from "./logic/authFlows.js";
import {
    getSchedulableSlots,
    getAvailableSlots,
    findBookingConflict,
    addDaysToDateKey,
    getZonedParts,
    zonedDateTimeToUtcMs,
} from "./logic/bookingAvailability.js";

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_TIMEZONE = "Africa/Cairo";
const GOOGLE_BUSY_REFRESH_MS = 60000;
const STUDENT_CHANGE_CUTOFF_MS = 12 * 60 * 60 * 1000;
const BUSY_BLOCKS_CACHE_MS = 60000;

const state = {
    bookingSettings: ensureBookingSettingsShape(createInitialBookingSettings()),
    contactSettings: createInitialContactSettings(),
    runtimeBusyBlocks: [],
    selectedSlotMs: null,
    selectedDateKey: "",
    visibleDateKey: "",
    bookingWeekOffset: 0,
    currentUser: null,
    currentRole: "",
    studentProfile: null,
    studentAuthMode: "login",
    teacherUser: null,
    teacherRole: "",
    bookingCache: new Map(),
    studentCache: new Map(),
    googleCalendarMessage: "",
    busyRefreshTimer: null,
    balanceReconcileTimer: null,
    studentProfileUnsubscribe: null,
    busyRefreshInFlight: null,
    googleCalendarModuleLoading: null,
    publicSettingsLoaded: false,
    bookingCalendarLoaded: false,
    publicSettingsInFlight: null,
    bookingCalendarInFlight: null,
    busyBlocksFetchedAt: 0,
    busyBlocksRangeDays: 0,
    busySyncReady: false,
    busySyncMessage: "",
    rescheduleModal: {
        role: "",
        bookingId: "",
        booking: null,
        weekOffset: 0,
        selectedSlot: 0,
        allowCustom: false,
    },
};

const els = {};

function qs(id) {
    return document.getElementById(id);
}

function cacheDom() {
    [
        "bookingTimezoneLabel",
        "appLoadingOverlay",
        "appLoadingText",
        "bookingWeekPrev",
        "bookingWeekNext",
        "bookingWeekLabel",
        "bookingWeeklyGrid",
        "bookingEmptyState",
        "bookingInfo",
        "selectedTimeDisplay",
        "bookingForm",
        "bookingAccountSummary",
        "studentBalanceCard",
        "studentBalanceValue",
        "studentLessonPriceValue",
        "bookingWebsite",
        "bookingSubmit",
        "bookingMsg",
        "studentAuthModal",
        "studentAuthForm",
        "studentAuthHint",
        "studentAuthBadge",
        "studentLoginModeBtn",
        "studentSignupModeBtn",
        "studentNameField",
        "studentName",
        "studentPhoneField",
        "studentPhoneCountry",
        "studentPhone",
        "studentEmail",
        "studentPassword",
        "studentAuthSubmit",
        "studentLogoutBtn",
        "studentAuthMsg",
        "bookingStatusEmail",
        "bookingStatusBtn",
        "bookingStatusList",
        "bookingStatusMsg",
        "contactWhatsAppBtn",
        "contactEmailBtn",
        "bookingSuccessModal",
        "bookingSuccessText",
        "rescheduleModal",
        "rescheduleModalHint",
        "rescheduleWeekPrev",
        "rescheduleWeekNext",
        "rescheduleWeekLabel",
        "rescheduleGrid",
        "rescheduleCustomFields",
        "rescheduleCustomDate",
        "rescheduleCustomTime",
        "rescheduleMsg",
        "rescheduleConfirmBtn",
        "openStudentGateBtn",
        "openTeacherGateBtn",
        "teacherLoginModal",
        "teacherLoginForm",
        "teacherEmail",
        "teacherPassword",
        "teacherLoginSubmit",
        "teacherLoginMsg",
        "teacherLogoutBtn",
        "teacherAuthBadge",
        "teacherAuthMsg",
        "teacherDashboard",
        "teacherTimezone",
        "teacherSlotMinutes",
        "teacherBreakMinutes",
        "teacherDaysGrid",
        "availabilityForm",
        "availabilityMsg",
        "teacherResetAvailabilityBtn",
        "contactSettingsForm",
        "teacherWhatsapp",
        "teacherContactEmail",
        "contactMsg",
        "appsScriptForm",
        "teacherAppsScriptUrl",
        "appsScriptMsg",
        "appsScriptTestBtn",
        "appsScriptRefreshBusyBtn",
        "appsScriptQuotaBtn",
        "appsScriptInstallReminderBtn",
        "appsScriptReminderCheckBtn",
        "appsScriptBalanceCheckBtn",
        "appsScriptEmailQuota",
        "appsScriptEmailQuotaValue",
        "exceptionForm",
        "exceptionDate",
        "exceptionStart",
        "exceptionEnd",
        "exceptionNote",
        "exceptionToggle",
        "exceptionBody",
        "exceptionList",
        "exceptionMsg",
        "clearExceptionsBtn",
        "teacherBookingMsg",
        "teacherBookingList",
        "teacherStudentsMsg",
        "teacherStudentsList",
        "refreshStudentsBtn",
        "reconcileBalancesBtn",
        "refreshBookingsBtn",
        "clearBookingsBtn",
        "googleCalendarStatus",
        "googleConnectBtn",
        "googleDisconnectBtn",
        "googleImportBtn",
        "googleTestPreplyBtn",
        "teacherPreplyCalendarId",
        "savePreplyBtn",
    ].forEach((id) => {
        els[id] = qs(id);
    });
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[char]));
}

function isLocalDevHost() {
    const host = window.location.hostname || "";
    return host === "localhost" || host === "127.0.0.1" || host === "";
}

function ensureEmailJsInit() {
    const cfg = window.emailJsConfig || {};
    if (!cfg.publicKey) return false;
    try {
        if (window.emailjs && typeof window.emailjs.init === "function") {
            window.emailjs.init(cfg.publicKey);
            return true;
        }
    } catch {}
    return false;
}

async function sendBookingEmail(payload) {
    const cfg = window.emailJsConfig || {};
    if (!cfg.publicKey || !cfg.serviceId || !cfg.templateId) return false;
    if (!ensureEmailJsInit()) return false;

    try {
        await window.emailjs.send(cfg.serviceId, cfg.templateId, {
            to_email: (payload.recipientEmail || "").trim(),
            student_name: payload.name || "",
            student_email: payload.email || "",
            student_phone: payload.phone || "",
            slot_time: payload.slot || "",
            notes: payload.notes || "",
            student_timezone: payload.studentTimeZone || "",
            student_locale: payload.studentLocale || "",
            teacher_timezone: payload.teacherTimeZone || "",
            booking_reasons: payload.reasons || "",
            booking_level: payload.level || "",
            booking_lessons_per_month: payload.lessonsPerMonth || "",
            booking_country_hint: payload.countryHint || "",
            booking_summary: payload.summary || "",
        });
        return true;
    } catch {
        return false;
    }
}

function loadScriptOnce(src) {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") return Promise.resolve();
    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
        });
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.defer = true;
        script.addEventListener("load", () => {
            script.dataset.loaded = "true";
            resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
        document.head.appendChild(script);
    });
}

async function ensureGoogleCalendarModuleLoaded() {
    if (window.connectToGoogleCalendar && window.importGoogleCalendarEventsToBusyBlocks) return;
    if (!state.googleCalendarModuleLoading) {
        state.googleCalendarModuleLoading = loadScriptOnce("./js/google-calendar.js").finally(() => {
            state.googleCalendarModuleLoading = null;
        });
    }
    await state.googleCalendarModuleLoading;
}

function setStatus(element, message, tone = "") {
    if (!element) return;
    element.textContent = message || "";
    element.classList.remove("is-error", "is-success");
    if (tone === "error") element.classList.add("is-error");
    if (tone === "success") element.classList.add("is-success");
}

let appLoadingCount = 0;

function setAppLoading(loading, message = "Loading...") {
    if (!els.appLoadingOverlay) return;
    appLoadingCount = Math.max(0, appLoadingCount + (loading ? 1 : -1));
    if (loading && els.appLoadingText) {
        els.appLoadingText.textContent = message || "Loading...";
    }
    const isActive = appLoadingCount > 0;
    els.appLoadingOverlay.classList.toggle("is-active", isActive);
    els.appLoadingOverlay.setAttribute("aria-hidden", isActive ? "false" : "true");
}

function waitForLoadingPaint() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
}

async function withAppLoading(message, task) {
    try {
        setAppLoading(true, message);
        await waitForLoadingPaint();
        return await task();
    } finally {
        setAppLoading(false);
    }
}

function setButtonLoading(button, loading, loadingText = "") {
    if (!button) return;
    const label = button.querySelector(".btn__label");
    if (loading) {
        if (!button.dataset.loadingWasDisabled) {
            button.dataset.loadingWasDisabled = button.disabled ? "true" : "false";
        }
        button.dataset.idleLabel = label?.textContent || button.textContent || "";
        if (label && loadingText) label.textContent = loadingText;
        if (!label && loadingText) {
            button.textContent = loadingText;
        }
        if (!button.querySelector(".btn__spinner")) {
            const spinner = document.createElement("span");
            spinner.className = "btn__spinner";
            spinner.setAttribute("aria-hidden", "true");
            button.appendChild(spinner);
        }
        button.disabled = true;
        button.classList.add("is-loading");
        return;
    }
    if (label) label.textContent = button.dataset.idleLabel || label.textContent;
    if (!label && button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    button.disabled = button.dataset.loadingWasDisabled === "true";
    delete button.dataset.loadingWasDisabled;
    button.classList.remove("is-loading");
}

async function withButtonLoading(button, loadingText, task) {
    return withAppLoading(loadingText || "Loading...", async () => {
        try {
            setButtonLoading(button, true, loadingText);
            return await task();
        } finally {
            setButtonLoading(button, false);
        }
    });
}

function normalizeAppsScriptStudentError(result, fallbackMessage) {
    const message = String(result?.message || "");
    if (message.toLowerCase().includes("unknown action")) {
        return "Apps Script needs a new deployment before students can cancel or reschedule.";
    }
    return message || fallbackMessage;
}

function isAlreadyDeletedCalendarEvent(result) {
    const message = [
        result?.message,
        result?.error,
        result?.ignoredError,
    ].filter(Boolean).join(" ").toLowerCase();
    return Boolean(result?.alreadyDeleted)
        || message.includes("already removed")
        || message.includes("already been deleted")
        || message.includes("does not exist");
}

function getLocalTimezone() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    } catch {
        return DEFAULT_TIMEZONE;
    }
}

function getTeacherTimezone() {
    return state.bookingSettings.timezone || DEFAULT_TIMEZONE;
}

function getDisplayTimezone() {
    return getLocalTimezone();
}

function formatSlotTime(ts) {
    const timezone = getDisplayTimezone();
    return new Date(ts).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: timezone,
    });
}

function getDateKey(date, timeZone = getDisplayTimezone()) {
    const parts = getZonedParts(date, timeZone);
    const year = parts.year;
    const month = String(parts.month).padStart(2, "0");
    const day = String(parts.day).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getTimeKey(date, timeZone = getDisplayTimezone()) {
    const parts = getZonedParts(date, timeZone);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function getScheduleStartDateKey(offset = 0, timeZone = getDisplayTimezone()) {
    const nowParts = getZonedParts(new Date(), timeZone);
    const todayKey = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-${String(nowParts.day).padStart(2, "0")}`;
    return addDaysToDateKey(todayKey, offset * 7);
}

function formatDateKey(dateKey, options = {}) {
    const [year, month, day] = String(dateKey || "").split("-").map(Number);
    if (!year || !month || !day) return dateKey || "";
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toLocaleDateString([], {
        ...options,
        timeZone: getDisplayTimezone(),
    });
}

function getCustomTeacherSlotMs(item) {
    const date = item.querySelector(".booking-resched-date")?.value || "";
    const time = item.querySelector(".booking-resched-time")?.value || "";
    if (!date || !time) return 0;
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return zonedDateTimeToUtcMs(getTeacherTimezone(), year, month, day, hour, minute);
}

function getModalCustomSlotMs() {
    const date = els.rescheduleCustomDate?.value || "";
    const time = els.rescheduleCustomTime?.value || "";
    if (!date || !time) return 0;
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
    return zonedDateTimeToUtcMs(getTeacherTimezone(), year, month, day, hour, minute);
}

function hashEmail(email) {
    const normalized = String(email || "").trim().toLowerCase();
    const encoder = new TextEncoder();
    return crypto.subtle.digest("SHA-256", encoder.encode(normalized)).then((buffer) =>
        Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("")
    );
}

function normalizePhoneNumber() {
    const prefix = (els.studentPhoneCountry?.value || "").trim();
    const raw = (els.studentPhone?.value || "").replace(/[^0-9]/g, "");
    if (!raw) return "";
    const local = raw.replace(/^0+/, "");
    return `${prefix}${local}`;
}

function isStudentSignedIn() {
    return Boolean(state.currentUser && state.currentRole === "student");
}

function getStudentName() {
    return (state.studentProfile?.name || state.currentUser?.displayName || "Student").trim();
}

function getStudentPhone() {
    return (state.studentProfile?.phone || "").trim();
}

function toMoneyValue(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
    return toMoneyValue(value).toLocaleString([], {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

function getStudentBalance() {
    return toMoneyValue(state.studentProfile?.balance);
}

function getStudentLessonPrice() {
    return toMoneyValue(state.studentProfile?.lessonPrice);
}

function updateStudentBalanceUi() {
    const signedIn = isStudentSignedIn();
    if (els.studentBalanceCard) {
        els.studentBalanceCard.hidden = !signedIn;
    }
    if (!signedIn) return;
    if (els.studentBalanceValue) {
        els.studentBalanceValue.textContent = formatMoney(getStudentBalance());
    }
    if (els.studentLessonPriceValue) {
        const price = getStudentLessonPrice();
        els.studentLessonPriceValue.textContent = price ? `Lesson price: ${formatMoney(price)}` : "Lesson price: not set";
    }
}

function updateBookingSubmitState() {
    if (!els.bookingSubmit) return;
    els.bookingSubmit.disabled = !state.selectedSlotMs || !isStudentSignedIn();
}

function setStudentAuthMode(mode) {
    state.studentAuthMode = mode === "signup" ? "signup" : "login";
    if (els.studentAuthForm) {
        els.studentAuthForm.classList.toggle("is-signup-mode", state.studentAuthMode === "signup");
        els.studentAuthForm.classList.toggle("is-login-mode", state.studentAuthMode !== "signup");
    }
    if (els.studentNameField) {
        els.studentNameField.hidden = state.studentAuthMode !== "signup";
    }
    if (els.studentPhoneField) {
        els.studentPhoneField.hidden = state.studentAuthMode !== "signup";
    }
    if (els.studentAuthSubmit) {
        const label = els.studentAuthSubmit.querySelector(".btn__label");
        if (label) {
            label.textContent = state.studentAuthMode === "signup" ? "Create Account" : "Sign In";
        } else {
            els.studentAuthSubmit.textContent = state.studentAuthMode === "signup" ? "Create Account" : "Sign In";
        }
    }
    els.studentLoginModeBtn?.classList.toggle("btn--primary", state.studentAuthMode === "login");
    els.studentLoginModeBtn?.classList.toggle("btn--outline", state.studentAuthMode !== "login");
    els.studentSignupModeBtn?.classList.toggle("btn--primary", state.studentAuthMode === "signup");
    els.studentSignupModeBtn?.classList.toggle("btn--outline", state.studentAuthMode !== "signup");
    setStatus(els.studentAuthMsg, "");
}

function updateStudentAuthUi() {
    const signedIn = isStudentSignedIn();
    if (els.studentAuthBadge) {
        els.studentAuthBadge.textContent = signedIn ? (state.currentUser.email || "Student") : "Signed out";
    }
    if (els.studentAuthHint) {
        els.studentAuthHint.textContent = signedIn
            ? `Ready to book as ${getStudentName()}.`
            : "Create an account or sign in before booking.";
    }
    if (els.bookingAccountSummary) {
        els.bookingAccountSummary.textContent = signedIn
            ? `Booking as ${getStudentName()} (${state.currentUser.email || ""}).`
            : "Sign in, choose a time, then confirm your lesson.";
    }
    if (els.studentLogoutBtn) {
        els.studentLogoutBtn.hidden = !signedIn;
    }
    updateStudentBalanceUi();
    updateBookingSubmitState();
}

function stopStudentProfileListener() {
    if (typeof state.studentProfileUnsubscribe === "function") {
        state.studentProfileUnsubscribe();
    }
    state.studentProfileUnsubscribe = null;
}

function startStudentProfileListener() {
    stopStudentProfileListener();
    if (!window.db || !state.currentUser || state.currentRole !== "student") return;
    state.studentProfileUnsubscribe = window.db
        .collection("users")
        .doc(state.currentUser.uid)
        .onSnapshot((snap) => {
            if (!snap.exists) return;
            state.studentProfile = snap.data() || {};
            updateStudentAuthUi();
        }, (error) => {
            console.warn("Could not watch student profile.", error);
        });
}

function setSelectedSlot(slotMs) {
    state.selectedSlotMs = slotMs;
    const slotDate = slotMs ? new Date(slotMs) : null;
    state.selectedDateKey = slotDate ? getDateKey(slotDate) : "";
    state.visibleDateKey = state.selectedDateKey || state.visibleDateKey;
    window.selectedDate = slotDate ? getDateKey(slotDate) : "";
    window.selectedTime = slotDate ? getTimeKey(slotDate) : "";

    if (slotDate && els.bookingInfo && els.selectedTimeDisplay) {
        els.bookingInfo.hidden = false;
        els.selectedTimeDisplay.textContent = slotDate.toLocaleString([], {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: getDisplayTimezone(),
        });
        updateBookingSubmitState();
    } else if (els.bookingInfo) {
        els.bookingInfo.hidden = true;
        updateBookingSubmitState();
    }
}

function syncBookingGridSelection() {
    document.querySelectorAll(".slot-btn").forEach((button) => {
        button.classList.toggle("is-selected", Number(button.dataset.slotStart || 0) === Number(state.selectedSlotMs || 0));
    });
    document.querySelectorAll(".booking-day-column").forEach((column) => {
        column.classList.toggle("is-focused", column.dataset.dateKey === state.visibleDateKey);
    });
}

function bookingDeps() {
    return {
        db: window.db,
        bookingSettings: state.bookingSettings,
        runtimeBusyBlocks: state.runtimeBusyBlocks,
        getLocalTimezone,
        getDateKey,
    };
}

async function refreshRuntimeBusyBlocks({ force = false, minDays = 0 } = {}) {
    const daysToFetch = Math.max(8, Number(minDays || 0), (state.bookingWeekOffset + 1) * 7 + 1);
    const requestedDays = Math.min(daysToFetch, 90);
    if (
        !force
        && state.busySyncReady
        && Date.now() - state.busyBlocksFetchedAt < BUSY_BLOCKS_CACHE_MS
        && state.busyBlocksRangeDays >= requestedDays
    ) {
        return state.runtimeBusyBlocks;
    }
    if (state.busyRefreshInFlight) {
        return state.busyRefreshInFlight;
    }
    state.busyRefreshInFlight = refreshRuntimeBusyBlocksNow({ force, minDays }).finally(() => {
        state.busyRefreshInFlight = null;
    });
    return state.busyRefreshInFlight;
}

async function refreshRuntimeBusyBlocksNow({ force = false, minDays = 0 } = {}) {
    const daysToFetch = Math.max(8, Number(minDays || 0), (state.bookingWeekOffset + 1) * 7 + 1);
    const requestedDays = Math.min(daysToFetch, 90);
    if (
        !force
        && state.busySyncReady
        && Date.now() - state.busyBlocksFetchedAt < BUSY_BLOCKS_CACHE_MS
        && state.busyBlocksRangeDays >= requestedDays
    ) {
        return state.runtimeBusyBlocks;
    }
    if (typeof window.fetchBusyBlocksFromAppsScript !== "function") {
        state.runtimeBusyBlocks = [];
        state.busyBlocksRangeDays = 0;
        state.busySyncReady = false;
        state.busySyncMessage = "Calendar sync is not available right now.";
        return;
    }
    const result = await window.fetchBusyBlocksFromAppsScript({
        days: requestedDays,
        timeZone: getTeacherTimezone(),
    });
    state.busySyncReady = !!(result?.success && Array.isArray(result.busyBlocks));
    state.busySyncMessage = state.busySyncReady ? "" : (result?.message || "Could not reach Google Calendar sync.");
    state.runtimeBusyBlocks = state.busySyncReady
        ? [...result.busyBlocks].sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0))
        : [];
    state.busyBlocksRangeDays = state.busySyncReady ? requestedDays : 0;
    state.busyBlocksFetchedAt = Date.now();
}

async function refreshGoogleBusyAndCalendar({ silent = true } = {}) {
    await refreshRuntimeBusyBlocks();
    await renderBookingCalendar();
    if (!silent) {
        setStatus(
            els.bookingMsg,
            state.busySyncReady && state.runtimeBusyBlocks.length
                ? "Calendar availability refreshed."
                : state.busySyncReady
                    ? "Calendar availability checked."
                    : "Calendar sync is unavailable. Please try again in a moment.",
            state.busySyncReady ? "success" : "error"
        );
    }
}

function startGoogleBusyAutoRefresh() {
    if (state.busyRefreshTimer) return;
    state.busyRefreshTimer = window.setInterval(() => {
        const studentScreen = document.getElementById("student-screen");
        if (!studentScreen?.classList.contains("app-screen--active")) return;
        ensureBookingCalendarLoaded({ force: true }).catch(console.error);
    }, GOOGLE_BUSY_REFRESH_MS);
}

async function loadPublicSettings({ force = false } = {}) {
    if (state.publicSettingsLoaded && !force) return;
    if (state.publicSettingsInFlight && !force) {
        await state.publicSettingsInFlight;
        return;
    }
    state.publicSettingsInFlight = (async () => {
        const publicSnap = await window.db.collection("bookingSettings").doc("primary").get();
        const publicData = publicSnap.exists ? (publicSnap.data() || {}) : {};
        state.bookingSettings = ensureBookingSettingsShape({
            ...getDefaultBookingSettings(DEFAULT_TIMEZONE),
            ...publicData,
        });
        state.contactSettings = {
            ...createInitialContactSettings(),
            whatsapp: typeof publicData.whatsapp === "string" ? publicData.whatsapp : "",
            email: typeof publicData.contactEmail === "string" ? publicData.contactEmail : "",
            sitePrice: typeof publicData.sitePrice === "string" ? publicData.sitePrice : "",
        };
        window.bookingSettings = state.bookingSettings;
        state.publicSettingsLoaded = true;
    })();
    try {
        await state.publicSettingsInFlight;
    } finally {
        state.publicSettingsInFlight = null;
    }
}

async function ensureBookingCalendarLoaded({ force = false } = {}) {
    if (state.bookingCalendarLoaded && !force) return;
    if (state.bookingCalendarInFlight && !force) {
        await state.bookingCalendarInFlight;
        return;
    }
    state.bookingCalendarInFlight = (async () => {
        await Promise.all([
            loadPublicSettings({ force }),
            refreshRuntimeBusyBlocks({ force }),
        ]);
        await renderBookingCalendar();
        state.bookingCalendarLoaded = true;
    })();
    try {
        await state.bookingCalendarInFlight;
    } finally {
        state.bookingCalendarInFlight = null;
    }
}

async function renderBookingCalendar() {
    if (!window.db) return;
    const timezone = getDisplayTimezone();
    if (els.bookingTimezoneLabel) {
        els.bookingTimezoneLabel.textContent = `Showing times in ${timezone}`;
    }

    if (!state.busySyncReady) {
        setSelectedSlot(null);
        if (els.bookingWeeklyGrid) els.bookingWeeklyGrid.innerHTML = "";
        if (els.bookingEmptyState) {
            els.bookingEmptyState.hidden = false;
            els.bookingEmptyState.textContent = state.busySyncMessage
                || "Calendar sync is unavailable. Please refresh in a moment.";
        }
        return;
    }

    const weekStartDateKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
    const weekEndDateKey = addDaysToDateKey(weekStartDateKey, 7);
    const [startYear, startMonth, startDay] = weekStartDateKey.split("-").map(Number);
    const [endYear, endMonth, endDay] = weekEndDateKey.split("-").map(Number);
    const weekStart = new Date(zonedDateTimeToUtcMs(timezone, startYear, startMonth, startDay, 0, 0));
    const weekEnd = new Date(zonedDateTimeToUtcMs(timezone, endYear, endMonth, endDay, 0, 0));
    const schedule = await getSchedulableSlots(7, bookingDeps(), {
        rangeStartMs: weekStart.getTime(),
        rangeEndMs: weekEnd.getTime(),
    });
    const slotsByDate = new Map();
    schedule.forEach((slot) => {
        if (!slot.available) return;
        const slotDateKey = getDateKey(new Date(slot.startMs), timezone);
        if (!slotsByDate.has(slotDateKey)) {
            slotsByDate.set(slotDateKey, []);
        }
        slotsByDate.get(slotDateKey).push(slot);
    });
    const days = [];

    for (let i = 0; i < 7; i += 1) {
        const dateKey = addDaysToDateKey(weekStartDateKey, i);
        const slots = slotsByDate.get(dateKey) || [];
        days.push({
            dateKey,
            slots,
            firstSlotMs: slots[0]?.startMs || null,
        });
    }

    const fallbackVisibleDate = days.find((day) => day.dateKey === state.visibleDateKey)
        ? state.visibleDateKey
        : (days.find((day) => day.slots.length)?.dateKey || days[0]?.dateKey || "");
    state.visibleDateKey = fallbackVisibleDate;

    if (els.bookingWeekLabel) {
        const weekLabelEndKey = addDaysToDateKey(weekStartDateKey, 6);
        els.bookingWeekLabel.textContent = `${formatDateKey(weekStartDateKey, { month: "short", day: "numeric" })} - ${formatDateKey(weekLabelEndKey, { month: "short", day: "numeric" })}`;
    }

    if (!els.bookingWeeklyGrid) return;
    els.bookingWeeklyGrid.innerHTML = "";
    let hasAny = false;

    days.forEach((day) => {
        const column = document.createElement("div");
        column.className = `booking-day-column${day.slots.length ? "" : " is-empty"}${day.dateKey === state.visibleDateKey ? " is-focused" : ""}`;
        column.dataset.dateKey = day.dateKey;
        const header = document.createElement("div");
        header.className = "booking-day-header";
        header.innerHTML = `
            <div class="booking-day-label">${escapeHtml(formatDateKey(day.dateKey, { weekday: "long" }))}</div>
            <div class="booking-day-date">${escapeHtml(formatDateKey(day.dateKey, { month: "short", day: "numeric" }))}</div>
        `;
        column.appendChild(header);

        const body = document.createElement("div");
        body.className = "booking-day-slots";

        if (!day.slots.length) {
            const empty = document.createElement("div");
            empty.className = "booking-day-empty";
            empty.textContent = "No open times";
            body.appendChild(empty);
        } else {
            hasAny = true;
            day.slots.forEach((slot) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `slot-btn${state.selectedSlotMs === slot.startMs ? " is-selected" : ""}`;
                btn.dataset.slotStart = String(slot.startMs);
                btn.textContent = new Date(slot.startMs).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: timezone,
                });
                btn.addEventListener("click", () => {
                    state.visibleDateKey = day.dateKey;
                    setSelectedSlot(slot.startMs);
                    syncBookingGridSelection();
                });
                body.appendChild(btn);
            });
        }

        column.appendChild(body);
        els.bookingWeeklyGrid.appendChild(column);
    });

    if (els.bookingEmptyState) {
        els.bookingEmptyState.hidden = hasAny;
    }

    if (state.selectedSlotMs) {
        const stillAvailable = schedule.some((slot) => slot.available && slot.startMs === state.selectedSlotMs);
        if (!stillAvailable) setSelectedSlot(null);
    }
}

async function loadBookingStatus(email) {
    if (state.currentUser) {
        await loadStudentBookings();
        return;
    }
    await loadBookingStatusByEmail({
        db: window.db,
        email,
        bookingStatusList: els.bookingStatusList,
        bookingStatusMsg: els.bookingStatusMsg,
        hashEmail,
        escapeHtml,
        formatSlotTime,
    });
}

async function loadStudentBookings() {
    if (!els.bookingStatusList) return;
    els.bookingStatusList.innerHTML = "";
    if (!state.currentUser || state.currentRole !== "student") {
        els.bookingStatusList.innerHTML = "<div class=\"small-note\">Sign in to see your bookings.</div>";
        return;
    }
    try {
        let snap;
        try {
            snap = await window.db
                .collection("bookings")
                .where("studentUid", "==", state.currentUser.uid)
                .orderBy("slot", "desc")
                .limit(10)
                .get();
        } catch (queryError) {
            const code = queryError?.code || "";
            const message = String(queryError?.message || "");
            const needsIndex = code === "failed-precondition" || message.toLowerCase().includes("index");
            if (!needsIndex) {
                throw queryError;
            }
            snap = await window.db
                .collection("bookings")
                .where("studentUid", "==", state.currentUser.uid)
                .limit(50)
                .get();
        }
        const rows = [];
        snap.forEach((doc) => rows.push({ id: doc.id, ...(doc.data() || {}) }));
        rows.sort((a, b) => (b.slot || 0) - (a.slot || 0));
        if (!rows.length) {
            els.bookingStatusList.innerHTML = "<div class=\"small-note\">No bookings yet.</div>";
            return;
        }
        els.bookingStatusList.innerHTML = rows.slice(0, 10).map((b) => {
            const status = (b.status || "booked").toLowerCase();
            const label = status === "canceled" ? "Canceled" : status === "rescheduled" ? "Rescheduled" : "Booked";
            const canCancel = status !== "canceled";
            const canReschedule = status !== "canceled" && Number(b.slot || 0) - Date.now() >= STUDENT_CHANGE_CUTOFF_MS;
            const isLateWindow = status !== "canceled" && Number(b.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS;
            const cutoffNote = isLateWindow
                ? "<div class=\"small-note\">Rescheduling closes 12 hours before the lesson. Late cancellation may still charge the lesson price.</div>"
                : "";
            return `
                <div class="booking-status-item" data-student-booking-id="${escapeHtml(b.id)}">
                    <div><strong>${escapeHtml(formatSlotTime(b.slot))}</strong></div>
                    <div>Status: ${escapeHtml(label)}</div>
                    ${cutoffNote}
                    <div class="booking-item__actions">
                        <button class="btn btn--ghost btn--small" data-student-action="cancel" ${canCancel ? "" : "disabled"}>Cancel</button>
                        <button class="btn btn--outline btn--small" data-student-action="reschedule" ${canReschedule ? "" : "disabled"}>Reschedule</button>
                    </div>
                    <div class="booking-item__resched"></div>
                </div>
            `;
        }).join("");
    } catch (error) {
        console.error("Could not load student bookings.", error);
        els.bookingStatusList.innerHTML = "<div class=\"small-note\">Unable to load your bookings right now.</div>";
    }
}

async function cancelStudentBooking(bookingId) {
    const snap = await window.db.collection("bookings").doc(bookingId).get();
    const booking = snap.data() || {};
    if (booking.studentUid !== state.currentUser?.uid) throw new Error("This booking does not belong to your account.");
    const isLateCancel = Number(booking.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS;
    if ((booking.googleCalendarEventId || bookingId) && typeof window.deleteBookingViaAppsScript === "function") {
        const result = await window.deleteBookingViaAppsScript({
            eventId: booking.googleCalendarEventId,
            bookingId,
            slot: booking.slot || 0,
            durationMinutes: booking.slotMinutes || state.bookingSettings.slotMinutes || 50,
            timeZone: booking.timezone || getTeacherTimezone(),
            teacherEmail: (state.contactSettings?.email || "").trim(),
            name: booking.name || getStudentName(),
            email: booking.email || state.currentUser?.email || "",
            phone: booking.phone || getStudentPhone(),
            notes: booking.notes || "",
            canceledBy: "Student",
        });
        if (result?.success === false && !isAlreadyDeletedCalendarEvent(result)) {
            throw new Error(normalizeAppsScriptStudentError(result, "Could not remove this booking from Google Calendar."));
        }
    }
    await window.db.collection("bookings").doc(bookingId).set({
        status: "canceled",
        updatedAt: Date.now(),
        calendarSynced: false,
        canceledAt: Date.now(),
        canceledBy: "student",
        history: window.firebase.firestore.FieldValue.arrayUnion({
            at: Date.now(),
            action: "canceled",
            by: "student",
            lateChargeApplies: isLateCancel,
        }),
    }, { merge: true });
    await window.db.collection("publicBookings").doc(bookingId).set({
        status: "canceled",
        updatedAt: Date.now(),
        calendarSynced: false,
    }, { merge: true });
}

async function openStudentReschedulePanel(itemEl, bookingId) {
    const resched = itemEl.querySelector(".booking-item__resched");
    if (!resched) return;
    if (resched.classList.contains("is-open")) {
        resched.classList.remove("is-open");
        resched.innerHTML = "";
        return;
    }
    const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
    const booking = { id: bookingSnap.id, ...(bookingSnap.data() || {}) };
    if (booking.studentUid !== state.currentUser?.uid) throw new Error("This booking does not belong to your account.");
    if (Number(booking.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS) {
        throw new Error("You cannot reschedule less than 12 hours before the lesson.");
    }
    resched.classList.add("is-open");
    resched.innerHTML = "<div class=\"small-note\">Loading available times...</div>";
    await refreshRuntimeBusyBlocks();
    if (!state.busySyncReady) {
        resched.innerHTML = "<div class=\"small-note\">Calendar sync is unavailable. Please try again later.</div>";
        return;
    }
    const slots = await getAvailableSlots(30, bookingDeps(), { excludeBookingId: bookingId });
    const options = slots.slice(0, 80).map((slotDate) => {
        const ts = slotDate.getTime();
        return `<option value="${ts}">${escapeHtml(slotDate.toLocaleString())}</option>`;
    });
    if (!options.length) {
        resched.innerHTML = "<div class=\"small-note\">No available times right now.</div>";
        return;
    }
    resched.innerHTML = `
        <select class="booking-resched-select">${options.join("")}</select>
        <button class="btn btn--primary btn--small" data-student-action="confirm-reschedule">Confirm</button>
        <button class="btn btn--ghost btn--small" data-student-action="close-reschedule">Close</button>
    `;
}

async function rescheduleStudentBooking(bookingId, newSlot) {
    const snap = await window.db.collection("bookings").doc(bookingId).get();
    const booking = snap.data() || {};
    if (booking.studentUid !== state.currentUser?.uid) throw new Error("This booking does not belong to your account.");
    if (Number(booking.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS) {
        throw new Error("You cannot reschedule less than 12 hours before the lesson.");
    }
    const conflict = await findBookingConflict(newSlot, bookingDeps(), { excludeBookingId: bookingId });
    if (conflict) throw new Error("That time is no longer available.");
    if ((booking.googleCalendarEventId || bookingId) && typeof window.deleteBookingViaAppsScript === "function") {
        const deleteResult = await window.deleteBookingViaAppsScript({
            eventId: booking.googleCalendarEventId,
            bookingId,
            slot: booking.slot || 0,
        });
        if (deleteResult?.success === false && !isAlreadyDeletedCalendarEvent(deleteResult)) {
            throw new Error(normalizeAppsScriptStudentError(deleteResult, "Could not remove the old Google Calendar event."));
        }
    }
    let calendarSynced = false;
    let googleCalendarEventId = null;
    if (typeof window.createBookingViaAppsScript === "function") {
        const createResult = await window.createBookingViaAppsScript({
            bookingId,
            slot: newSlot,
            durationMinutes: state.bookingSettings.slotMinutes || 50,
            timeZone: getTeacherTimezone(),
            teacherEmail: (state.contactSettings?.email || "").trim(),
            name: booking.name || getStudentName(),
            email: booking.email || state.currentUser?.email || "",
            phone: booking.phone || getStudentPhone(),
            notes: booking.notes || "",
            studentTimeZone: getLocalTimezone(),
            studentLocale: navigator.language || "",
        });
        if (createResult?.success === false) {
            throw new Error(createResult.message || "Could not create the new Google Calendar event.");
        }
        calendarSynced = !!createResult?.success;
        googleCalendarEventId = createResult?.eventId || null;
    }
    await window.db.collection("bookings").doc(bookingId).set({
        slot: newSlot,
        status: "rescheduled",
        updatedAt: Date.now(),
        calendarSynced,
        googleCalendarEventId,
        rescheduledFrom: booking.slot,
        rescheduledAt: Date.now(),
        history: window.firebase.firestore.FieldValue.arrayUnion({
            at: Date.now(),
            action: "rescheduled",
            by: "student",
            from: booking.slot,
            to: newSlot,
        }),
    }, { merge: true });
    await window.db.collection("publicBookings").doc(bookingId).set({
        slot: newSlot,
        status: "rescheduled",
        updatedAt: Date.now(),
        calendarSynced,
        rescheduledFrom: booking.slot,
        rescheduledAt: Date.now(),
    }, { merge: true });
}

async function deleteCalendarEventForBooking(bookingId, booking) {
    if (typeof window.deleteBookingViaAppsScript !== "function") {
        return { success: false, message: "Apps Script is not available." };
    }
    return window.deleteBookingViaAppsScript({
        eventId: booking.googleCalendarEventId || "",
        bookingId,
        slot: booking.slot || 0,
    });
}

async function rescheduleTeacherBooking(bookingId, booking, newSlot) {
    const conflict = await findBookingConflict(newSlot, bookingDeps(), { excludeBookingId: bookingId });
    if (conflict) {
        throw new Error("That slot is already taken.");
    }
    const deleteResult = await deleteCalendarEventForBooking(bookingId, booking);
    if (deleteResult?.success === false && !isAlreadyDeletedCalendarEvent(deleteResult)) {
        throw new Error(normalizeAppsScriptStudentError(deleteResult, "Could not remove the old Google Calendar event."));
    }
    const createResult = await createCalendarEventForBooking(bookingId, booking, newSlot);
    if (createResult?.success === false) {
        throw new Error(createResult.message || "Could not create the new Google Calendar event.");
    }
    await rescheduleBooking({
        db: window.db,
        firebase: window.firebase,
        bookingId,
        booking,
        newSlot,
        calendarSynced: !!createResult?.success,
        googleCalendarEventId: createResult?.eventId || null,
    });
}

function resetRescheduleModal() {
    state.rescheduleModal = {
        role: "",
        bookingId: "",
        booking: null,
        weekOffset: 0,
        selectedSlot: 0,
        allowCustom: false,
    };
    if (els.rescheduleGrid) els.rescheduleGrid.innerHTML = "";
    if (els.rescheduleMsg) setStatus(els.rescheduleMsg, "");
    if (els.rescheduleCustomDate) els.rescheduleCustomDate.value = "";
    if (els.rescheduleCustomTime) els.rescheduleCustomTime.value = "";
}

function closeRescheduleModal() {
    els.rescheduleModal?.classList.remove("modal--open");
    resetRescheduleModal();
}

function setRescheduleSelectedSlot(slotMs) {
    state.rescheduleModal.selectedSlot = Number(slotMs || 0);
    document.querySelectorAll("[data-reschedule-slot]").forEach((button) => {
        button.classList.toggle("is-selected", Number(button.dataset.rescheduleSlot || 0) === state.rescheduleModal.selectedSlot);
    });
    if (state.rescheduleModal.selectedSlot) {
        if (els.rescheduleCustomDate) els.rescheduleCustomDate.value = "";
        if (els.rescheduleCustomTime) els.rescheduleCustomTime.value = "";
    }
}

async function renderRescheduleModalSlots() {
    if (!els.rescheduleGrid) return;
    setStatus(els.rescheduleMsg, "");
    els.rescheduleGrid.innerHTML = "<div class=\"small-note\">Loading available times...</div>";
    const offset = Math.max(0, state.rescheduleModal.weekOffset || 0);
    state.rescheduleModal.weekOffset = offset;
    if (els.rescheduleWeekPrev) els.rescheduleWeekPrev.disabled = offset === 0;
    const timezone = getDisplayTimezone();
    const startKey = getScheduleStartDateKey(offset, timezone);
    const endKey = addDaysToDateKey(startKey, 6);
    if (els.rescheduleWeekLabel) {
        els.rescheduleWeekLabel.textContent = `${formatDateKey(startKey, { month: "short", day: "numeric" })} - ${formatDateKey(endKey, { month: "short", day: "numeric" })}`;
    }

    await refreshRuntimeBusyBlocks({ minDays: (offset + 1) * 7 + 1 });
    const [startYear, startMonth, startDay] = startKey.split("-").map(Number);
    const weekEndKey = addDaysToDateKey(startKey, 7);
    const [endYear, endMonth, endDay] = weekEndKey.split("-").map(Number);
    const rangeStartMs = zonedDateTimeToUtcMs(timezone, startYear, startMonth, startDay, 0, 0);
    const rangeEndMs = zonedDateTimeToUtcMs(timezone, endYear, endMonth, endDay, 0, 0);
    const slots = await getAvailableSlots(7, bookingDeps(), {
        excludeBookingId: state.rescheduleModal.bookingId,
        rangeStartMs,
        rangeEndMs,
    });
    const days = Array.from({ length: 7 }, (_, index) => {
        const dateKey = addDaysToDateKey(startKey, index);
        return { dateKey, slots: [] };
    });
    const dayMap = new Map(days.map((day) => [day.dateKey, day]));
    slots.forEach((slotDate) => {
        const dateKey = getDateKey(slotDate, timezone);
        if (dayMap.has(dateKey)) {
            dayMap.get(dateKey).slots.push(slotDate);
        }
    });

    const html = days.map((day) => {
        const daySlots = day.slots
            .sort((a, b) => a.getTime() - b.getTime())
            .map((slotDate) => {
                const ts = slotDate.getTime();
                const label = slotDate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: timezone,
                });
                return `<button type="button" class="slot-btn reschedule-slot-btn" data-reschedule-slot="${ts}">${escapeHtml(label)}</button>`;
            })
            .join("");
        return `
            <div class="booking-day-column ${daySlots ? "" : "is-empty"}">
                <div class="booking-day-header">
                    <div class="booking-day-label">${escapeHtml(formatDateKey(day.dateKey, { weekday: "short" }))}</div>
                    <div class="booking-day-date">${escapeHtml(formatDateKey(day.dateKey, { month: "short", day: "numeric" }))}</div>
                </div>
                <div class="booking-day-slots">
                    ${daySlots || "<div class=\"booking-day-empty\">No times</div>"}
                </div>
            </div>
        `;
    }).join("");
    els.rescheduleGrid.innerHTML = html;
    setRescheduleSelectedSlot(state.rescheduleModal.selectedSlot);
}

async function openRescheduleModal({ role, bookingId, booking = null, allowCustom = false }) {
    if (!bookingId) return;
    let resolvedBooking = booking;
    if (!resolvedBooking) {
        const snap = await window.db.collection("bookings").doc(bookingId).get();
        resolvedBooking = { id: snap.id, ...(snap.data() || {}) };
    }
    state.rescheduleModal = {
        role,
        bookingId,
        booking: resolvedBooking,
        weekOffset: 0,
        selectedSlot: 0,
        allowCustom,
    };
    if (els.rescheduleModalHint) {
        els.rescheduleModalHint.textContent = allowCustom
            ? "Choose an available time, or enter a custom teacher time."
            : "Choose an available teacher time.";
    }
    if (els.rescheduleCustomFields) {
        els.rescheduleCustomFields.hidden = !allowCustom;
    }
    els.rescheduleModal?.classList.add("modal--open");
    await renderRescheduleModalSlots();
}

async function createCalendarEventForBooking(bookingId, booking, slot) {
    if (typeof window.createBookingViaAppsScript !== "function") {
        return { success: false, message: "Apps Script is not available." };
    }
    return window.createBookingViaAppsScript({
        bookingId,
        slot,
        durationMinutes: state.bookingSettings.slotMinutes || 50,
        timeZone: getTeacherTimezone(),
        teacherEmail: (state.contactSettings?.email || "").trim(),
        name: booking.name || "Student",
        email: booking.email || "",
        phone: booking.phone || "",
        notes: booking.notes || "",
        studentTimeZone: booking.studentTimeZone || getLocalTimezone(),
        studentLocale: booking.studentLocale || navigator.language || "",
    });
}

function wireStudentActions() {
    document.querySelectorAll("[data-target]").forEach((button) => {
        button.addEventListener("click", () => showScreen(button.getAttribute("data-target")));
    });

    els.openStudentGateBtn?.addEventListener("click", (event) => {
        if (isStudentSignedIn()) {
            withButtonLoading(event.currentTarget, "Loading...", async () => {
                showScreen("student-screen");
                await ensureBookingCalendarLoaded();
            }).catch(console.error);
            return;
        }
        els.studentAuthModal?.classList.add("modal--open");
        setStatus(els.studentAuthMsg, "");
    });

    els.openTeacherGateBtn?.addEventListener("click", (event) => {
        if (state.teacherUser && state.teacherRole === "teacher") {
            withButtonLoading(event.currentTarget, "Loading...", async () => {
                showScreen("teacher-screen");
                await refreshTeacherDashboard();
            }).catch(console.error);
            return;
        }
        els.teacherLoginModal?.classList.add("modal--open");
        setStatus(els.teacherLoginMsg, "");
    });

    els.studentLoginModeBtn?.addEventListener("click", () => setStudentAuthMode("login"));
    els.studentSignupModeBtn?.addEventListener("click", () => setStudentAuthMode("signup"));

    els.studentAuthForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!window.auth) {
            setStatus(els.studentAuthMsg, "Firebase is not configured.", "error");
            return;
        }
        const email = (els.studentEmail?.value || "").trim().toLowerCase();
        const password = els.studentPassword?.value || "";
        const name = (els.studentName?.value || "").trim().slice(0, 100);
        const phone = normalizePhoneNumber();
        try {
            setAppLoading(true, state.studentAuthMode === "signup" ? "Creating account..." : "Signing in...");
            setButtonLoading(
                els.studentAuthSubmit,
                true,
                state.studentAuthMode === "signup" ? "Creating..." : "Signing in..."
            );
            setStatus(els.studentAuthMsg, state.studentAuthMode === "signup" ? "Creating account..." : "Signing in...");
            if (state.studentAuthMode === "signup") {
                if (name.length < 2) {
                    setStatus(els.studentAuthMsg, "Please enter your full name.", "error");
                    setButtonLoading(els.studentAuthSubmit, false);
                    return;
                }
                if (!phone) {
                    setStatus(els.studentAuthMsg, "Please enter your mobile number.", "error");
                    setButtonLoading(els.studentAuthSubmit, false);
                    return;
                }
                const cred = await window.auth.createUserWithEmailAndPassword(email, password);
                await cred.user.updateProfile({ displayName: name });
                await window.db.collection("users").doc(cred.user.uid).set({
                    email,
                    name,
                    phone,
                    role: "student",
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                });
                setStatus(els.studentAuthMsg, "Account created. You can book now.", "success");
                els.studentAuthModal?.classList.remove("modal--open");
                showScreen("student-screen");
            } else {
                await window.auth.signInWithEmailAndPassword(email, password);
                setStatus(els.studentAuthMsg, "Signed in.", "success");
                els.studentAuthModal?.classList.remove("modal--open");
                showScreen("student-screen");
            }
        } catch (error) {
            setStatus(els.studentAuthMsg, error.message || "Student sign-in failed.", "error");
        } finally {
            setAppLoading(false);
            setButtonLoading(els.studentAuthSubmit, false);
        }
    });

    els.studentLogoutBtn?.addEventListener("click", async () => {
        if (!window.auth) return;
        await withButtonLoading(els.studentLogoutBtn, "Signing out...", () => window.auth.signOut());
    });

    els.bookingWeekPrev?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.bookingWeekOffset = Math.max(0, state.bookingWeekOffset - 1);
            await refreshRuntimeBusyBlocks();
            await renderBookingCalendar();
        }).catch(console.error);
    });

    els.bookingWeekNext?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.bookingWeekOffset += 1;
            await refreshRuntimeBusyBlocks();
            await renderBookingCalendar();
        }).catch(console.error);
    });

    els.bookingStatusBtn?.addEventListener("click", (event) => {
        if (!state.currentUser) {
            setStatus(els.bookingStatusMsg, "Sign in to see your bookings.", "error");
            return;
        }
        setStatus(els.bookingStatusMsg, "");
        withButtonLoading(event.currentTarget, "Refreshing...", () => loadStudentBookings()).catch(() => {
            setStatus(els.bookingStatusMsg, "Unable to load booking status right now.", "error");
        });
    });

    els.bookingStatusList?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-student-action]");
        if (!button) return;
        const item = button.closest("[data-student-booking-id]");
        const bookingId = item?.dataset.studentBookingId || "";
        const action = button.dataset.studentAction;
        if (!bookingId) return;
        const loadingTextByAction = {
            cancel: "Canceling...",
            reschedule: "Loading times...",
            "confirm-reschedule": "Rescheduling...",
        };
        const shouldShowLoading = Boolean(loadingTextByAction[action]);
        try {
            if (shouldShowLoading) {
                setAppLoading(true, loadingTextByAction[action]);
                setButtonLoading(button, true, loadingTextByAction[action]);
            }
            setStatus(els.bookingStatusMsg, "");
            if (action === "close-reschedule") {
                const panel = item.querySelector(".booking-item__resched");
                panel?.classList.remove("is-open");
                if (panel) panel.innerHTML = "";
                return;
            }
            if (action === "cancel") {
                await cancelStudentBooking(bookingId);
                setStatus(els.bookingStatusMsg, "Booking canceled.", "success");
                await loadStudentBookings();
                await renderBookingCalendar();
                return;
            }
            if (action === "reschedule") {
                const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
                const booking = { id: bookingSnap.id, ...(bookingSnap.data() || {}) };
                if (booking.studentUid !== state.currentUser?.uid) throw new Error("This booking does not belong to your account.");
                if (Number(booking.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS) {
                    throw new Error("You cannot reschedule less than 12 hours before the lesson.");
                }
                await openRescheduleModal({ role: "student", bookingId, booking, allowCustom: false });
                return;
            }
            if (action === "confirm-reschedule") {
                const newSlot = Number(item.querySelector(".booking-resched-select")?.value || 0);
                if (!newSlot) return;
                await refreshRuntimeBusyBlocks();
                if (!state.busySyncReady) {
                    setStatus(els.bookingStatusMsg, "Calendar sync is unavailable. Please try again later.", "error");
                    return;
                }
                await rescheduleStudentBooking(bookingId, newSlot);
                setStatus(els.bookingStatusMsg, "Booking rescheduled.", "success");
                await loadStudentBookings();
                await renderBookingCalendar();
            }
        } catch (error) {
            setStatus(els.bookingStatusMsg, error.message || "Could not update booking.", "error");
        } finally {
            if (shouldShowLoading) {
                setAppLoading(false);
                setButtonLoading(button, false);
            }
        }
    });

    document.querySelectorAll("[data-close-reschedule-modal]").forEach((button) => {
        button.addEventListener("click", () => closeRescheduleModal());
    });

    els.rescheduleWeekPrev?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.rescheduleModal.weekOffset = Math.max(0, Number(state.rescheduleModal.weekOffset || 0) - 1);
            await renderRescheduleModalSlots();
        }).catch((error) => {
            setStatus(els.rescheduleMsg, error.message || "Could not load available times.", "error");
        });
    });

    els.rescheduleWeekNext?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.rescheduleModal.weekOffset = Number(state.rescheduleModal.weekOffset || 0) + 1;
            await renderRescheduleModalSlots();
        }).catch((error) => {
            setStatus(els.rescheduleMsg, error.message || "Could not load available times.", "error");
        });
    });

    els.rescheduleGrid?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-reschedule-slot]");
        if (!button) return;
        setRescheduleSelectedSlot(Number(button.dataset.rescheduleSlot || 0));
        setStatus(els.rescheduleMsg, "");
    });

    [els.rescheduleCustomDate, els.rescheduleCustomTime].forEach((input) => {
        input?.addEventListener("input", () => {
            if (!state.rescheduleModal.allowCustom) return;
            state.rescheduleModal.selectedSlot = 0;
            document.querySelectorAll("[data-reschedule-slot]").forEach((button) => button.classList.remove("is-selected"));
            setStatus(els.rescheduleMsg, "");
        });
    });

    els.rescheduleConfirmBtn?.addEventListener("click", async (event) => {
        const modalState = state.rescheduleModal;
        if (!modalState.bookingId || !modalState.booking) return;
        const customSlot = modalState.allowCustom ? getModalCustomSlotMs() : 0;
        const newSlot = Number(modalState.selectedSlot || 0) || customSlot;
        if (!newSlot) {
            setStatus(els.rescheduleMsg, "Choose an available time first.", "error");
            return;
        }
        if (newSlot <= Date.now()) {
            setStatus(els.rescheduleMsg, "Choose a future time.", "error");
            return;
        }
        try {
            await withButtonLoading(event.currentTarget, "Rescheduling...", async () => {
                if (modalState.role === "student") {
                    await rescheduleStudentBooking(modalState.bookingId, newSlot);
                    setStatus(els.bookingStatusMsg, "Booking rescheduled.", "success");
                    await loadStudentBookings();
                } else {
                    await rescheduleTeacherBooking(modalState.bookingId, modalState.booking, newSlot);
                    setStatus(els.teacherBookingMsg, "Booking rescheduled.", "success");
                    await refreshTeacherBookings();
                }
                await renderBookingCalendar();
                closeRescheduleModal();
            });
        } catch (error) {
            setStatus(els.rescheduleMsg, error.message || "Could not reschedule booking.", "error");
        }
    });

    els.contactWhatsAppBtn?.addEventListener("click", () => {
        const message = "Hello, I want help with booking a lesson.";
        const url = buildWhatsAppUrl(state.contactSettings, message);
        if (!url) {
            setStatus(els.bookingMsg, "WhatsApp contact is not configured yet.", "error");
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    });

    els.contactEmailBtn?.addEventListener("click", () => {
        const email = (state.contactSettings.email || "").trim();
        if (!email) {
            setStatus(els.bookingMsg, "Contact email is not configured yet.", "error");
            return;
        }
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Lesson booking inquiry")}`;
    });

    document.querySelectorAll("[data-close-booking-success]").forEach((button) => {
        button.addEventListener("click", () => {
            els.bookingSuccessModal?.classList.remove("modal--open");
        });
    });

    document.querySelectorAll("[data-close-teacher-modal]").forEach((button) => {
        button.addEventListener("click", () => {
            els.teacherLoginModal?.classList.remove("modal--open");
        });
    });

    document.querySelectorAll("[data-close-student-modal]").forEach((button) => {
        button.addEventListener("click", () => {
            els.studentAuthModal?.classList.remove("modal--open");
        });
    });

    els.bookingForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isStudentSignedIn()) {
            setStatus(els.bookingMsg, "Please sign in as a student before booking.", "error");
            els.studentAuthModal?.classList.add("modal--open");
            return;
        }
        const email = (state.currentUser.email || "").trim().toLowerCase();
        const name = getStudentName();
        const phone = getStudentPhone();

        await withAppLoading("Confirming booking...", () => submitGuestBooking({
            db: window.db,
            bookingSettings: state.bookingSettings,
            contactSettings: state.contactSettings,
            getLocalTimezone,
            selectedSlotMs: state.selectedSlotMs,
            selectedDate: window.selectedDate,
            selectedTime: window.selectedTime,
            formValues: {
                name,
                email,
                phone,
                notes: "",
                reasonLabels: [],
                reason: "",
                level: "",
                lessonsPerMonth: "",
                honeypot: (els.bookingWebsite?.value || "").trim(),
                studentTimeZone: getLocalTimezone(),
                studentLocale: navigator.language || "",
                countryHint: "",
                recaptchaReady: true,
                studentUid: state.currentUser.uid,
            },
            bookingSubmit: els.bookingSubmit,
            bookingSubmitLabel: els.bookingSubmit?.querySelector(".btn__label"),
            bookingMsg: els.bookingMsg,
            bookingSuccessModal: els.bookingSuccessModal,
            bookingSuccessText: els.bookingSuccessText,
            bookingStatusEmail: els.bookingStatusEmail,
            refreshCalendarAvailability: async () => {
                await refreshRuntimeBusyBlocks();
                return state.busySyncReady;
            },
            findBookingConflict: async (slotMs) => {
                await refreshRuntimeBusyBlocks();
                return findBookingConflict(slotMs, bookingDeps());
            },
            buildBookingSelects: renderBookingCalendar,
            hashEmail,
            sendBookingEmail,
            createBookingViaAppsScript: window.createBookingViaAppsScript,
            loadBookingStatus,
            isLocalDevHost,
        }));
    });
}

function renderTeacherDays() {
    if (!els.teacherDaysGrid) return;
    els.teacherDaysGrid.innerHTML = "";
    DAY_KEYS.forEach((day) => {
        const item = state.bookingSettings.days[day] || { enabled: false, start: "09:00", end: "17:00" };
        const row = document.createElement("div");
        row.className = "day-row";
        row.innerHTML = `
            <div class="day-row__label">${day}</div>
            <label><input type="checkbox" data-day-enabled="${day}" ${item.enabled ? "checked" : ""} /> Enabled</label>
            <input type="time" data-day-start="${day}" value="${escapeHtml(item.start || "09:00")}" />
            <input type="time" data-day-end="${day}" value="${escapeHtml(item.end || "17:00")}" />
        `;
        els.teacherDaysGrid.appendChild(row);
    });
}

function syncTeacherFormFields() {
    if (els.teacherTimezone) els.teacherTimezone.value = state.bookingSettings.timezone || getTeacherTimezone();
    if (els.teacherSlotMinutes) els.teacherSlotMinutes.value = String(state.bookingSettings.slotMinutes || 50);
    if (els.teacherBreakMinutes) els.teacherBreakMinutes.value = String(state.bookingSettings.breakMinutes || 10);
    if (els.teacherWhatsapp) els.teacherWhatsapp.value = state.contactSettings.whatsapp || "";
    if (els.teacherContactEmail) els.teacherContactEmail.value = state.contactSettings.email || "";
    renderTeacherDays();
    renderExceptions();
}

function renderExceptions() {
    if (!els.exceptionList) return;
    const exceptions = Array.isArray(state.bookingSettings.exceptions)
        ? [...state.bookingSettings.exceptions]
        : [];
    exceptions.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));

    if (!exceptions.length) {
        els.exceptionList.innerHTML = `<div class="empty-state">No busy blocks yet.</div>`;
        return;
    }

    els.exceptionList.innerHTML = exceptions.map((item, index) => `
        <div class="exception-item">
            <div><strong>${escapeHtml(item.date || "")}</strong> ${escapeHtml(item.start || "")} - ${escapeHtml(item.end || "")}</div>
            <div class="small-note">${escapeHtml(item.note || "Busy")}</div>
            <div class="action-row">
                <button type="button" class="btn btn--ghost btn--small" data-remove-exception="${index}">Remove</button>
            </div>
        </div>
    `).join("");

    els.exceptionList.querySelectorAll("[data-remove-exception]").forEach((button) => {
        button.addEventListener("click", async () => {
            await withButtonLoading(button, "Removing...", async () => {
                const index = Number(button.getAttribute("data-remove-exception"));
                if (!Number.isInteger(index)) return;
                state.bookingSettings.exceptions.splice(index, 1);
                await saveTeacherSettings();
                renderExceptions();
                await renderBookingCalendar();
            });
        });
    });
}

async function saveBookingSettingsPublicMirror() {
    await window.db.collection("bookingSettings").doc("primary").set({
        timezone: state.bookingSettings.timezone,
        slotMinutes: state.bookingSettings.slotMinutes,
        breakMinutes: state.bookingSettings.breakMinutes,
        totalSlotMinutes: state.bookingSettings.totalSlotMinutes,
        days: state.bookingSettings.days,
        exceptions: state.bookingSettings.exceptions,
        updatedAt: Date.now(),
    }, { merge: true });
}

async function saveContactPublicMirror() {
    await window.db.collection("bookingSettings").doc("primary").set({
        whatsapp: state.contactSettings.whatsapp || "",
        contactEmail: state.contactSettings.email || "",
        updatedAt: Date.now(),
    }, { merge: true });
}

async function saveTeacherSettings() {
    state.bookingSettings = ensureBookingSettingsShape(state.bookingSettings);
    window.bookingSettings = state.bookingSettings;
    await saveBookingSettingsToCloud(window.db, state.bookingSettings);
    await saveBookingSettingsPublicMirror();
}

async function saveTeacherContactSettings() {
    await saveContactSettingsToCloud(window.db, window.firebase, state.contactSettings);
    await saveContactPublicMirror();
}

async function refreshTeacherDashboard() {
    if (!state.teacherUser || state.teacherRole !== "teacher") return;
    const teacherSnap = await window.db.collection("teachers").doc(state.teacherUser.uid).get();
    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
    state.bookingSettings = ensureBookingSettingsShape({
        ...getDefaultBookingSettings(getTeacherTimezone()),
        ...(teacherData.bookingSettings || {}),
    });
    state.contactSettings = {
        ...createInitialContactSettings(),
        ...(teacherData.contactSettings || {}),
    };
    window.bookingSettings = state.bookingSettings;
    await refreshRuntimeBusyBlocks();
    syncTeacherFormFields();
    const balanceResult = await reconcileStudentBalances();
    if (balanceResult.chargedCount && els.teacherStudentsMsg) {
        setStatus(els.teacherStudentsMsg, `Deducted ${balanceResult.chargedCount} due lesson charge${balanceResult.chargedCount === 1 ? "" : "s"}.`, "success");
    } else if (balanceResult.missingPriceCount && els.teacherStudentsMsg) {
        setStatus(els.teacherStudentsMsg, "Some due lessons were not deducted because lesson price is not set.", "error");
    }
    await refreshTeacherStudents();
    await refreshTeacherBookings();
    await refreshGoogleCalendarStatus();
    await renderBookingCalendar();
}

async function refreshTeacherBookings() {
    const balanceResult = await reconcileStudentBalances();
    if (balanceResult.chargedCount && els.teacherStudentsMsg) {
        setStatus(els.teacherStudentsMsg, `Deducted ${balanceResult.chargedCount} due lesson charge${balanceResult.chargedCount === 1 ? "" : "s"}.`, "success");
        await refreshTeacherStudents();
    }
    state.bookingCache = await renderTeacherBookings({
        db: window.db,
        teacherBookingList: els.teacherBookingList,
        bookingCache: state.bookingCache,
        escapeHtml,
        formatSlotTime,
    });
}

function startBalanceReconcileAutoRefresh() {
    if (state.balanceReconcileTimer) return;
    state.balanceReconcileTimer = window.setInterval(() => {
        if (!state.teacherUser || state.teacherRole !== "teacher") return;
        reconcileStudentBalances()
            .then(async (result) => {
                if (!result?.chargedCount) return;
                setStatus(els.teacherStudentsMsg, `Deducted ${result.chargedCount} due lesson charge${result.chargedCount === 1 ? "" : "s"}.`, "success");
                await refreshTeacherStudents();
                await refreshTeacherBookings();
            })
            .catch(console.error);
    }, 60000);
}

function stopBalanceReconcileAutoRefresh() {
    if (!state.balanceReconcileTimer) return;
    window.clearInterval(state.balanceReconcileTimer);
    state.balanceReconcileTimer = null;
}

async function refreshTeacherStudents() {
    if (!els.teacherStudentsList) return;
    els.teacherStudentsList.innerHTML = "<div class=\"small-note\">Loading students...</div>";
    state.studentCache.clear();
    try {
        const snap = await window.db.collection("users").where("role", "==", "student").get();
        const students = [];
        snap.forEach((doc) => students.push({ id: doc.id, ...(doc.data() || {}) }));
        students.sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
        if (!students.length) {
            els.teacherStudentsList.innerHTML = "<div class=\"small-note\">No students yet.</div>";
            return;
        }
        els.teacherStudentsList.innerHTML = students.map((student) => {
            state.studentCache.set(student.id, student);
            const balance = formatMoney(student.balance);
            const lessonPrice = toMoneyValue(student.lessonPrice);
            return `
                <div class="student-admin-item" data-student-id="${escapeHtml(student.id)}">
                    <button class="student-admin-item__summary" type="button" data-student-action="toggle">
                        <span>
                            <strong>${escapeHtml(student.name || "Student")}</strong>
                            <span>${escapeHtml(student.email || "")}</span>
                        </span>
                        <span class="student-admin-item__money">Balance: ${balance}</span>
                    </button>
                    <form class="student-admin-editor" data-student-editor hidden>
                        <div class="inline-fields">
                            <label class="field">
                                <span>Balance</span>
                                <input data-student-balance type="number" step="0.01" value="${escapeHtml(toMoneyValue(student.balance))}" />
                            </label>
                            <label class="field">
                                <span>Lesson Price</span>
                                <input data-student-price type="number" min="0" step="0.01" value="${escapeHtml(lessonPrice)}" />
                            </label>
                            <label class="field">
                                <span>Phone</span>
                                <input value="${escapeHtml(student.phone || "")}" disabled />
                            </label>
                        </div>
                        <div class="action-row">
                            <button class="btn btn--primary btn--small" type="submit" data-student-action="save">Save Student</button>
                        </div>
                    </form>
                </div>
            `;
        }).join("");
    } catch (error) {
        console.error("Could not load students.", error);
        els.teacherStudentsList.innerHTML = "<div class=\"small-note\">Unable to load students.</div>";
    }
}

async function saveStudentFinance(studentId, balance, lessonPrice) {
    await window.db.collection("users").doc(studentId).set({
        balance: toMoneyValue(balance),
        lessonPrice: toMoneyValue(lessonPrice),
        financeUpdatedAt: Date.now(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

async function loadBalanceChargeCandidates(now) {
    const docsById = new Map();
    const addDocs = (snap) => {
        snap.forEach((doc) => {
            docsById.set(doc.id, doc);
        });
    };

    try {
        const pastSnap = await window.db
            .collection("bookings")
            .where("slot", "<=", now)
            .orderBy("slot", "desc")
            .limit(300)
            .get();
        addDocs(pastSnap);
    } catch {
        const fallbackSnap = await window.db.collection("bookings").limit(500).get();
        addDocs(fallbackSnap);
    }

    try {
        const canceledSnap = await window.db
            .collection("bookings")
            .where("status", "==", "canceled")
            .limit(300)
            .get();
        addDocs(canceledSnap);
    } catch {}

    return Array.from(docsById.values());
}

async function reconcileStudentBalances() {
    const now = Date.now();
    const docs = await loadBalanceChargeCandidates(now);
    let chargedCount = 0;
    const studentDocs = new Map();
    const missingPrice = new Set();
    for (const doc of docs) {
        const booking = doc.data() || {};
        const status = String(booking.status || "booked").toLowerCase();
        if (!booking.studentUid || booking.balanceChargedAt) continue;
        const shouldChargeAttended = Number(booking.slot || 0) <= now && (status === "booked" || status === "rescheduled");
        const canceledAt = Number(booking.canceledAt || 0);
        const lateCanceled = status === "canceled" &&
            String(booking.canceledBy || "student").toLowerCase() === "student" &&
            canceledAt &&
            Number(booking.slot || 0) - canceledAt < STUDENT_CHANGE_CUTOFF_MS;
        if (!shouldChargeAttended && !lateCanceled) continue;

        let studentSnap = studentDocs.get(booking.studentUid);
        if (!studentSnap) {
            studentSnap = await window.db.collection("users").doc(booking.studentUid).get();
            studentDocs.set(booking.studentUid, studentSnap);
        }
        const student = studentSnap.exists ? (studentSnap.data() || {}) : {};
        const lessonPrice = toMoneyValue(booking.lessonPrice || student.lessonPrice);
        if (!lessonPrice) {
            missingPrice.add(booking.studentUid);
            continue;
        }
        const chargeReason = lateCanceled ? "late-cancel" : "lesson";
        const batch = window.db.batch();
        batch.set(window.db.collection("users").doc(booking.studentUid), {
            balance: toMoneyValue(student.balance) - lessonPrice,
            financeUpdatedAt: now,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(window.db.collection("bookings").doc(doc.id), {
            balanceChargedAt: now,
            chargedAmount: lessonPrice,
            chargeReason,
            updatedAt: now,
            history: window.firebase.firestore.FieldValue.arrayUnion({
                at: now,
                action: "balance-charged",
                by: "teacher",
                amount: lessonPrice,
                reason: chargeReason,
            }),
        }, { merge: true });
        await batch.commit();
        studentDocs.set(booking.studentUid, {
            exists: true,
            data: () => ({ ...student, balance: toMoneyValue(student.balance) - lessonPrice }),
        });
        chargedCount += 1;
    }
    return { chargedCount, missingPriceCount: missingPrice.size };
}

function updateEmailQuotaUi(result) {
    if (!els.appsScriptEmailQuota || !els.appsScriptEmailQuotaValue) return;
    if (!result?.success || !Number.isFinite(Number(result.emailQuotaRemaining))) {
        els.appsScriptEmailQuota.hidden = true;
        return;
    }
    els.appsScriptEmailQuota.hidden = false;
    els.appsScriptEmailQuotaValue.textContent = String(Number(result.emailQuotaRemaining));
}

async function refreshAppsScriptEmailQuota({ silent = true } = {}) {
    if (typeof window.getAppsScriptEmailQuota !== "function") return null;
    const result = await window.getAppsScriptEmailQuota();
    updateEmailQuotaUi(result);
    if (!silent) {
        setStatus(
            els.appsScriptMsg,
            result?.success ? "Email quota refreshed." : (result?.message || "Could not load email quota."),
            result?.success ? "success" : "error"
        );
    }
    return result;
}

async function refreshGoogleCalendarStatus() {
    if (!state.teacherUser || state.teacherRole !== "teacher") {
        setStatus(els.googleCalendarStatus, "Sign in as a teacher to manage Google Calendar.");
        return;
    }
    const connected = await window.isGoogleCalendarConnected?.();
    const base = connected ? "Google Calendar is connected." : "Google Calendar is not connected.";
    setStatus(els.googleCalendarStatus, [base, state.googleCalendarMessage].filter(Boolean).join(" "));
}

window.updateGoogleCalendarStatusMessage = (message) => {
    state.googleCalendarMessage = message || "";
    refreshGoogleCalendarStatus().catch(console.error);
};

window.refreshGoogleCalendarStatus = refreshGoogleCalendarStatus;

async function savePreplyCalendarId() {
    if (!state.teacherUser) {
        setStatus(els.googleCalendarStatus, "Sign in as a teacher first.", "error");
        return;
    }
    const raw = (els.teacherPreplyCalendarId?.value || "").trim();
    const normalized = window.normalizeCalendarId ? window.normalizeCalendarId(raw) : raw;
    await window.db.collection("teachers").doc(state.teacherUser.uid).set({
        preplyCalendarId: normalized,
        googleCalendar: {
            preplyCalendarId: normalized,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        },
    }, { merge: true });
    window.preplyCalendarId = normalized;
    state.googleCalendarMessage = normalized ? "Preply calendar ID saved." : "Preply calendar ID cleared.";
    await refreshGoogleCalendarStatus();
}

function wireTeacherActions() {
    els.teacherLoginForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!window.auth) {
            setStatus(els.teacherLoginMsg, "Firebase is not configured.", "error");
            return;
        }
        try {
            setAppLoading(true, "Signing in...");
            setButtonLoading(els.teacherLoginSubmit, true, "Signing in...");
            setStatus(els.teacherLoginMsg, "Signing in...");
            await window.auth.signInWithEmailAndPassword(
                (els.teacherEmail?.value || "").trim(),
                els.teacherPassword?.value || ""
            );
        } catch (error) {
            setStatus(els.teacherLoginMsg, error.message || "Sign-in failed.", "error");
        } finally {
            setAppLoading(false);
            setButtonLoading(els.teacherLoginSubmit, false);
        }
    });

    els.teacherLogoutBtn?.addEventListener("click", async () => {
        if (!window.auth) return;
        await withButtonLoading(els.teacherLogoutBtn, "Signing out...", () => window.auth.signOut());
    });

    els.availabilityForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                state.bookingSettings.timezone = (els.teacherTimezone?.value || "").trim() || DEFAULT_TIMEZONE;
                state.bookingSettings.slotMinutes = Number(els.teacherSlotMinutes?.value || 50);
                state.bookingSettings.breakMinutes = Number(els.teacherBreakMinutes?.value || 10);
                state.bookingSettings.totalSlotMinutes = state.bookingSettings.slotMinutes + state.bookingSettings.breakMinutes;

                DAY_KEYS.forEach((day) => {
                    state.bookingSettings.days[day] = {
                        enabled: Boolean(document.querySelector(`[data-day-enabled="${day}"]`)?.checked),
                        start: document.querySelector(`[data-day-start="${day}"]`)?.value || "09:00",
                        end: document.querySelector(`[data-day-end="${day}"]`)?.value || "17:00",
                    };
                });

                await saveTeacherSettings();
                await refreshRuntimeBusyBlocks();
                await renderBookingCalendar();
            });
            setStatus(els.availabilityMsg, "Availability saved for both teacher and public booking settings.", "success");
        } catch (error) {
            setStatus(els.availabilityMsg, error.message || "Could not save availability.", "error");
        }
    });

    els.teacherResetAvailabilityBtn?.addEventListener("click", async (event) => {
        await withButtonLoading(event.currentTarget, "Resetting...", async () => {
            state.bookingSettings = getDefaultBookingSettings(getLocalTimezone());
            await saveTeacherSettings();
            syncTeacherFormFields();
            await renderBookingCalendar();
            setStatus(els.availabilityMsg, "Availability reset to default.", "success");
        });
    });

    els.contactSettingsForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                state.contactSettings.whatsapp = (els.teacherWhatsapp?.value || "").trim();
                state.contactSettings.email = (els.teacherContactEmail?.value || "").trim();
                await saveTeacherContactSettings();
            });
            setStatus(els.contactMsg, "Contact settings saved.", "success");
        } catch (error) {
            setStatus(els.contactMsg, error.message || "Could not save contact settings.", "error");
        }
    });

    els.appsScriptForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        try {
            const result = await withButtonLoading(submitter, "Saving...", () => {
                return window.saveAppsScriptSettings?.({
                    webAppUrl: (els.teacherAppsScriptUrl?.value || "").trim(),
                });
            });
            setStatus(els.appsScriptMsg, result?.message || "Apps Script settings saved.", result?.success === false ? "error" : "success");
        } catch (error) {
            setStatus(els.appsScriptMsg, error.message || "Could not save Apps Script URL.", "error");
        }
    });

    els.appsScriptTestBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Testing...", () => window.testAppsScriptConnection?.());
        updateEmailQuotaUi(result);
        setStatus(els.appsScriptMsg, result?.message || "Apps Script test finished.", result?.success ? "success" : "error");
    });

    els.appsScriptRefreshBusyBtn?.addEventListener("click", async (event) => {
        await withButtonLoading(event.currentTarget, "Importing...", async () => {
            await refreshRuntimeBusyBlocks();
            await renderBookingCalendar();
        });
        setStatus(els.appsScriptMsg, state.runtimeBusyBlocks.length
            ? `Loaded ${state.runtimeBusyBlocks.length} busy blocks from Apps Script.`
            : "Apps Script busy blocks refreshed.", "success");
    });

    els.appsScriptQuotaBtn?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Refreshing...", () => refreshAppsScriptEmailQuota({ silent: false })).catch((error) => {
            setStatus(els.appsScriptMsg, error.message || "Could not load email quota.", "error");
        });
    });

    els.appsScriptInstallReminderBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Installing...", () => window.installLessonReminderTrigger?.());
        setStatus(els.appsScriptMsg, result?.message || "Reminder trigger setup finished.", result?.success ? "success" : "error");
    });

    els.appsScriptReminderCheckBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Checking...", () => window.sendLessonReminderCheck?.());
        const count = Number(result?.sentCount || 0);
        const message = result?.message
            ? `${result.message} Sent ${count} reminder${count === 1 ? "" : "s"}.`
            : `Sent ${count} reminder${count === 1 ? "" : "s"}.`;
        setStatus(els.appsScriptMsg, message, result?.success ? "success" : "error");
    });

    els.appsScriptBalanceCheckBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Checking...", () => window.reconcileBalancesViaAppsScript?.());
        const count = Number(result?.chargedCount || 0);
        const message = result?.message
            ? `${result.message} Deducted ${count} lesson charge${count === 1 ? "" : "s"}.`
            : `Deducted ${count} lesson charge${count === 1 ? "" : "s"}.`;
        setStatus(els.appsScriptMsg, message, result?.success ? "success" : "error");
        await refreshTeacherStudents();
    });

    els.exceptionForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        await withButtonLoading(submitter, "Adding...", async () => {
            const date = els.exceptionDate?.value || "";
            const start = els.exceptionStart?.value || "";
            const end = els.exceptionEnd?.value || "";
            const note = (els.exceptionNote?.value || "").trim();
            if (!date || !start || !end) {
                setStatus(els.exceptionMsg, "Please enter a valid date and time range.", "error");
                return;
            }
            state.bookingSettings.exceptions.push({ date, start, end, note });
            await saveTeacherSettings();
            renderExceptions();
            await renderBookingCalendar();
            setStatus(els.exceptionMsg, "Busy block added.", "success");
            els.exceptionForm.reset();
        });
    });

    els.exceptionToggle?.addEventListener("click", () => {
        const expanded = els.exceptionToggle.getAttribute("aria-expanded") === "true";
        els.exceptionToggle.setAttribute("aria-expanded", String(!expanded));
        if (els.exceptionBody) {
            els.exceptionBody.hidden = expanded;
        }
    });

    els.clearExceptionsBtn?.addEventListener("click", async (event) => {
        await withButtonLoading(event.currentTarget, "Clearing...", async () => {
            state.bookingSettings.exceptions = [];
            await saveTeacherSettings();
            renderExceptions();
            await renderBookingCalendar();
            setStatus(els.exceptionMsg, "All busy blocks cleared.", "success");
        });
    });

    els.refreshBookingsBtn?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Refreshing...", () => refreshTeacherBookings()).catch(console.error);
    });

    els.refreshStudentsBtn?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Refreshing...", () => refreshTeacherStudents()).catch((error) => {
            setStatus(els.teacherStudentsMsg, error.message || "Could not refresh students.", "error");
        });
    });

    els.reconcileBalancesBtn?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Deducting...", async () => {
            const result = await reconcileStudentBalances();
            await refreshTeacherStudents();
            setStatus(els.teacherStudentsMsg, result.chargedCount
                ? `Deducted ${result.chargedCount} due lesson charge${result.chargedCount === 1 ? "" : "s"}.`
                : result.missingPriceCount
                    ? "Some due lessons need a lesson price before deduction."
                    : "No due lessons to deduct.", result.chargedCount ? "success" : result.missingPriceCount ? "error" : "");
        }).catch((error) => {
            setStatus(els.teacherStudentsMsg, error.message || "Could not deduct balances.", "error");
        });
    });

    els.teacherStudentsList?.addEventListener("click", (event) => {
        const toggle = event.target.closest("[data-student-action='toggle']");
        if (!toggle) return;
        const item = toggle.closest("[data-student-id]");
        const editor = item?.querySelector("[data-student-editor]");
        if (editor) editor.hidden = !editor.hidden;
    });

    els.teacherStudentsList?.addEventListener("submit", async (event) => {
        const form = event.target.closest("[data-student-editor]");
        if (!form) return;
        event.preventDefault();
        const item = form.closest("[data-student-id]");
        const studentId = item?.dataset.studentId || "";
        if (!studentId) return;
        const submitter = event.submitter;
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                await saveStudentFinance(
                    studentId,
                    form.querySelector("[data-student-balance]")?.value,
                    form.querySelector("[data-student-price]")?.value
                );
                await refreshTeacherStudents();
            });
            setStatus(els.teacherStudentsMsg, "Student balance saved.", "success");
        } catch (error) {
            setStatus(els.teacherStudentsMsg, error.message || "Could not save student balance.", "error");
        }
    });

    els.clearBookingsBtn?.addEventListener("click", async () => {
        const confirmed = window.confirm("Delete all bookings from both private and public collections?");
        if (!confirmed) return;
        try {
            await withButtonLoading(els.clearBookingsBtn, "Clearing...", async () => {
                await clearAllBookings({ db: window.db });
                await refreshTeacherBookings();
                await renderBookingCalendar();
            });
            setStatus(els.teacherBookingMsg, "All bookings deleted.", "success");
        } catch (error) {
            setStatus(els.teacherBookingMsg, error.message || "Could not delete bookings.", "error");
        }
    });

    els.teacherBookingList?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) return;
        const item = button.closest("[data-booking-id]");
        const bookingId = item?.getAttribute("data-booking-id");
        const booking = bookingId ? state.bookingCache.get(bookingId) : null;
        if (!booking || !item) return;

        const action = button.getAttribute("data-action");
        const teacherBookingLoadingText = {
            cancel: "Canceling...",
            reschedule: "Loading times...",
            "confirm-reschedule": "Rescheduling...",
        };
        const shouldShowLoading = Boolean(teacherBookingLoadingText[action]);
        try {
            if (shouldShowLoading) {
                setAppLoading(true, teacherBookingLoadingText[action]);
                setButtonLoading(button, true, teacherBookingLoadingText[action]);
                if (action === "reschedule") {
                    setStatus(els.teacherBookingMsg, "Loading available times...");
                    await waitForLoadingPaint();
                }
            }
            if (action === "cancel") {
                const deleteResult = await deleteCalendarEventForBooking(bookingId, booking);
                if (deleteResult?.success === false && !isAlreadyDeletedCalendarEvent(deleteResult)) {
                    throw new Error(normalizeAppsScriptStudentError(deleteResult, "Could not remove this booking from Google Calendar."));
                }
                await cancelBooking({ db: window.db, firebase: window.firebase, bookingId });
                setStatus(els.teacherBookingMsg, "Booking canceled.", "success");
                await refreshTeacherBookings();
                await renderBookingCalendar();
                return;
            }

            if (action === "reschedule") {
                await openRescheduleModal({
                    role: "teacher",
                    bookingId,
                    booking: { ...booking, id: bookingId },
                    allowCustom: true,
                });
                return;
            }

            if (action === "close-reschedule") {
                const panel = item.querySelector(".booking-item__resched");
                if (panel) panel.innerHTML = "";
                return;
            }

            if (action === "confirm-reschedule") {
                const select = item.querySelector(".booking-resched-select");
                const selectedSlot = Number(select?.value || 0);
                const customSlot = getCustomTeacherSlotMs(item);
                const newSlot = selectedSlot || customSlot;
                if (!newSlot) {
                    setStatus(els.teacherBookingMsg, "Choose an available slot or enter a custom date and time.", "error");
                    return;
                }
                if (newSlot <= Date.now()) {
                    setStatus(els.teacherBookingMsg, "Choose a future time.", "error");
                    return;
                }
                const conflict = await findBookingConflict(newSlot, bookingDeps(), { excludeBookingId: bookingId });
                if (conflict) {
                    setStatus(els.teacherBookingMsg, "That slot is already taken.", "error");
                    return;
                }
                const deleteResult = await deleteCalendarEventForBooking(bookingId, booking);
                if (deleteResult?.success === false && !isAlreadyDeletedCalendarEvent(deleteResult)) {
                    throw new Error(normalizeAppsScriptStudentError(deleteResult, "Could not remove the old Google Calendar event."));
                }
                const createResult = await createCalendarEventForBooking(bookingId, booking, newSlot);
                if (createResult?.success === false) {
                    throw new Error(createResult.message || "Could not create the new Google Calendar event.");
                }
                await rescheduleBooking({
                    db: window.db,
                    firebase: window.firebase,
                    bookingId,
                    booking,
                    newSlot,
                    calendarSynced: !!createResult?.success,
                    googleCalendarEventId: createResult?.eventId || null,
                });
                setStatus(els.teacherBookingMsg, "Booking rescheduled.", "success");
                await refreshTeacherBookings();
                await renderBookingCalendar();
            }
        } catch (error) {
            setStatus(els.teacherBookingMsg, error.message || "Booking update failed.", "error");
        } finally {
            if (shouldShowLoading) {
                setAppLoading(false);
                setButtonLoading(button, false);
            }
        }
    });

    els.googleConnectBtn?.addEventListener("click", async (event) => {
        if (!state.teacherUser) {
            setStatus(els.googleCalendarStatus, "Sign in as a teacher first.", "error");
            return;
        }
        const ok = await withButtonLoading(event.currentTarget, "Connecting...", async () => {
            await ensureGoogleCalendarModuleLoaded();
            return window.connectToGoogleCalendar?.((success, message) => {
                state.googleCalendarMessage = success ? "Connection saved." : (message || "Connection failed.");
            });
        });
        if (ok) {
            state.googleCalendarMessage = "Connection saved.";
        }
        await refreshGoogleCalendarStatus();
    });

    els.googleDisconnectBtn?.addEventListener("click", async (event) => {
        await withButtonLoading(event.currentTarget, "Disconnecting...", async () => {
            await ensureGoogleCalendarModuleLoaded();
            return window.disconnectFromGoogleCalendar?.();
        });
        state.googleCalendarMessage = "Google Calendar disconnected.";
        await refreshGoogleCalendarStatus();
    });

    els.googleImportBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Importing...", async () => {
            await ensureGoogleCalendarModuleLoaded();
            return window.importGoogleCalendarEventsToBusyBlocks?.();
        });
        if (result?.success) {
            state.googleCalendarMessage = result.message || "Calendar events imported.";
            await refreshTeacherDashboard();
        } else {
            setStatus(els.googleCalendarStatus, result?.message || "Import failed.", "error");
        }
    });

    els.googleTestPreplyBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Testing...", async () => {
            await ensureGoogleCalendarModuleLoaded();
            return window.testPreplyCalendarAccess?.();
        });
        setStatus(els.googleCalendarStatus, result?.message || "Test finished.", result?.success ? "success" : "error");
    });

    els.savePreplyBtn?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Saving...", () => savePreplyCalendarId()).catch((error) => {
            setStatus(els.googleCalendarStatus, error.message || "Could not save Preply calendar ID.", "error");
        });
    });
}

function showScreen(screenId) {
    if (screenId === "teacher-screen" && (!state.teacherUser || state.teacherRole !== "teacher")) {
        els.teacherLoginModal?.classList.add("modal--open");
        return;
    }
    document.querySelectorAll(".app-screen").forEach((screen) => {
        screen.classList.toggle("app-screen--active", screen.id === screenId);
    });
    document.querySelectorAll(".nav-link").forEach((button) => {
        button.classList.toggle("is-active", button.getAttribute("data-target") === screenId);
    });
    if (screenId === "student-screen") {
        withAppLoading("Loading available times...", () => ensureBookingCalendarLoaded()).catch(console.error);
        startGoogleBusyAutoRefresh();
    }
}

async function handleAuthState(user) {
    stopStudentProfileListener();
    stopBalanceReconcileAutoRefresh();
    state.currentUser = user || null;
    state.currentRole = "";
    state.studentProfile = null;
    state.teacherUser = null;
    state.teacherRole = "";
    state.publicSettingsLoaded = false;
    state.bookingCalendarLoaded = false;
    state.publicSettingsInFlight = null;
    state.bookingCalendarInFlight = null;
    state.busyBlocksRangeDays = 0;

    if (!user) {
        if (els.teacherDashboard) els.teacherDashboard.hidden = true;
        if (els.teacherAuthBadge) els.teacherAuthBadge.textContent = "Signed out";
        setStatus(els.teacherAuthMsg, "Sign in to access teacher controls.");
        setStatus(els.teacherLoginMsg, "");
        updateStudentAuthUi();
        showScreen("welcome-screen");
        return;
    }

    const resolved = await resolveUserRole({
        db: window.db,
        uid: user.uid,
        email: user.email,
        savedRole: "",
        fallbackRole: "",
    });
    state.currentRole = resolved.role || "student";
    state.studentProfile = resolved.data || {};

    if (state.currentRole !== "teacher") {
        if (els.teacherDashboard) els.teacherDashboard.hidden = true;
        if (els.teacherAuthBadge) els.teacherAuthBadge.textContent = "Signed out";
        setStatus(els.teacherAuthMsg, "Sign in to access teacher controls.");
        setStatus(els.teacherLoginMsg, "");
        updateStudentAuthUi();
        showScreen("student-screen");
        startStudentProfileListener();
        await Promise.all([
            loadStudentBookings(),
            ensureBookingCalendarLoaded(),
        ]);
        return;
    }

    state.teacherUser = user;
    state.teacherRole = "teacher";
    updateStudentAuthUi();

    await bootstrapTeacherAccess({
        db: window.db,
        firebase: window.firebase,
        uid: user.uid,
        email: user.email,
    });

    els.teacherDashboard.hidden = false;
    els.teacherAuthBadge.textContent = user.email || "Teacher";
    setStatus(els.teacherAuthMsg, "Teacher access active.", "success");
    setStatus(els.teacherLoginMsg, "");
    els.teacherLoginModal?.classList.remove("modal--open");

    const teacherDoc = await window.db.collection("teachers").doc(user.uid).get();
    const teacherData = teacherDoc.exists ? (teacherDoc.data() || {}) : {};
    if (els.teacherAppsScriptUrl) els.teacherAppsScriptUrl.value = teacherData.appsScript?.webAppUrl || "";
    if (els.teacherPreplyCalendarId) {
        els.teacherPreplyCalendarId.value = teacherData.preplyCalendarId || teacherData.googleCalendar?.preplyCalendarId || "";
    }
    await refreshTeacherDashboard();
    startBalanceReconcileAutoRefresh();
    refreshAppsScriptEmailQuota().catch(console.error);
    showScreen("teacher-screen");
}

function buildTeacherScheduleUi() {
    renderTeacherDays();
}

async function init() {
    cacheDom();
    buildTeacherScheduleUi();
    setStudentAuthMode("login");
    updateStudentAuthUi();
    wireStudentActions();
    wireTeacherActions();
    showScreen("welcome-screen");

    if (!window.db || !window.auth) {
        setStatus(els.bookingMsg, "Firebase runtime config is missing. Add js/config.runtime.js first.", "error");
        return;
    }

    window.auth.onAuthStateChanged((user) => {
        withAppLoading("Loading account...", () => handleAuthState(user)).catch(console.error);
    });
}

init().catch(console.error);
