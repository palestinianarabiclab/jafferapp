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
    submitGuestBooking,
} from "./logic/guestBookingFlow.js?v=20260808-phase45-accounting-performance-v1";
import {
    renderTeacherBookings,
    cancelBooking,
    deleteCanceledBooking,
    rescheduleBooking,
    resizeBookingDuration,
    clearAllBookings,
} from "./logic/teacherBookingAdmin.js?v=20260811-resource-optimization-v1";
import {
    bootstrapTeacherAccess,
    resolveUserRole,
} from "./logic/authFlows.js";
import {
    MIN_BOOKING_LEAD_MINUTES,
    getSchedulableSlots,
    getAvailableSlots,
    getBookedSlotsMap,
    findBookingConflict,
    addDaysToDateKey,
    getZonedParts,
    zonedDateTimeToUtcMs,
} from "./logic/bookingAvailability.js";
import {
    getLessonAccessState,
} from "./logic/lessonAccess.js";
import {
    getBookingSlotClaimId,
    getBookingIntervalClaimIds,
    getLessonEndAt,
    isLessonHistorical,
    isChargeableLateCancellation,
    shouldConsumeLesson,
} from "./logic/bookingSafety.js";
import {
    CALENDAR_SYNC_STATES,
    buildPendingCalendarState,
    dedupeCalendarMirrors,
} from "./logic/calendarSyncSafety.js";
import {
    createNotificationJob,
} from "./logic/notificationSafety.js";
import { getPackageLessonChargeCents } from "./logic/pricingSafety.js";
import {
    createInitialProfileSettings,
    createInitialReviews,
    loadLocalProfileSettings,
    saveLocalProfileSettings,
    loadCloudProfileSettings,
    saveCloudProfileSettings,
    loadLocalReviews,
    saveLocalReviews,
    loadCloudReviews,
    addReviewToCloud,
    deleteReviewFromCloud,
} from "./logic/profileAndReviewsStore.js?v=20260811-resource-optimization-v1";

const DAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_TIMEZONE = "Africa/Cairo";
const GOOGLE_BUSY_REFRESH_MS = 10 * 60 * 1000;
const STUDENT_CHANGE_CUTOFF_MS = 12 * 60 * 60 * 1000;
const BUSY_BLOCKS_CACHE_MS = 60000;
const LESSON_FEEDBACK_BASELINE = {
    studentCount: 93,
    averages: {
        reassurance: 4.9,
        clarity: 5.0,
        progress: 4.9,
        preparation: 4.9,
    },
};

const state = {
    bookingSettings: ensureBookingSettingsShape(createInitialBookingSettings()),
    contactSettings: createInitialContactSettings(),
    profileSettings: loadLocalProfileSettings("teacher_profile_v1", createInitialProfileSettings()),
    reviews: loadLocalReviews("teacher_reviews_v1", createInitialReviews()),
    reviewsSortMode: "newest",
    reviewsExpanded: false,
    reviewsLoadedAll: false,
    reviewsMayHaveMore: true,
    reviewsLoadInFlight: null,
    selectedPackage: null,
    reservedPaidLessons: 0,
    pendingLateCancellationCount: 0,
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
    teacherCalendarWeekOffset: 0,
    teacherCalendarView: "week",
    teacherCalendarDrag: null,
    teacherCalendarResize: null,
    teacherCalendarTouch: null,
    studentBookingsUnsubscribe: null,
    studentBookingsRefreshTimer: null,
    studentBookingsFingerprint: "",
    studentBookingRows: [],
    studentHistoryLoaded: false,
    studentBookingsUid: "",
    teacherRevenueTotal: 0,
    teacherCalendarStatistics: {},
    studentCache: new Map(),
    googleCalendarMessage: "",
    googleCalendarConnected: false,
    busyRefreshTimer: null,
    teacherCalendarRefreshTimer: null,
    teacherBookingsUnsubscribe: null,
    teacherBookingsRefreshTimer: null,
    teacherStudentsRefreshTimer: null,
    teacherStudentsLastRefreshAt: 0,
    teacherLastCalendarRefreshAt: 0,
    balanceReconcileTimer: null,
    studentProfileUnsubscribe: null,
    lessonFeedbackRatings: {
        preparation: 0,
        clarity: 0,
        reassurance: 0,
        progress: 0,
    },
    lessonFeedbackDismissedBookingId: "",
    pendingLessonFeedbackBooking: null,
    lessonFeedbackSummaryUnsubscribe: null,
    teacherLessonFeedbackUnsubscribe: null,
    teacherLessonFeedbackRefreshTimer: null,
    teacherLessonFeedbackLoaded: false,
    preplyStatisticsSyncTimer: null,
    busyRefreshInFlight: null,
    googleCalendarModuleLoading: null,
    publicSettingsLoaded: false,
    bookingCalendarLoaded: false,
    publicSettingsInFlight: null,
    bookingCalendarInFlight: null,
    bookingSubmissionInFlight: false,
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
        "bookingDayPrev",
        "bookingDayNext",
        "bookingDayLabel",
        "bookingWeeklyGrid",
        "bookingEmptyState",
        "studentTimezoneSelect",
        "selectedTimezoneName",
        "selectedTimezoneOffset",
        "viewFullScheduleRow",
        "viewFullScheduleBtn",
        "bookingInfo",
        "selectedTimeDisplay",
        "bookingForm",
        "bookingAccountSummary",
        "studentPaypalReminder",
        "studentPaypalLink",
        "studentPaymentCard",
        "studentPaymentOpenBtn",
        "studentPaymentCloseBtn",
        "requestCourseAccessBtn",
        "courseAccessRequestMsg",
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
        "studentForgotPasswordBtn",
        "studentLogoutBtn",
        "studentDeleteAccountBtn",
        "studentDeleteAccountModal",
        "studentDeleteAccountForm",
        "studentDeleteAccountPassword",
        "studentDeleteAccountConfirmBtn",
        "studentDeleteAccountMsg",
        "studentAuthMsg",
        "bookingStatusEmail",
        "bookingStatusBtn",
        "bookingStatusList",
        "bookingStatusMsg",
        "contactWhatsAppBtn",
        "contactEmailBtn",
        "bookingSuccessModal",
        "bookingSuccessText",
        "bookingSuccessWhatsAppBtn",
        "bookingSuccessTrialIntro",
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
        "bookFreeTrialBtn",
        "welcomeWhatsappBtn",
        "openTeacherGateBtn",
        "teacherLoginModal",
        "teacherLoginForm",
        "teacherEmail",
        "teacherPassword",
        "teacherLoginSubmit",
        "teacherForgotPasswordBtn",
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
        "courseOffersForm",
        "courseAccessPrice",
        "courseAccessUnits",
        "freeTrialLessons",
        "paypalPaymentLink",
        "paypalReminder",
        "courseOffersMsg",
        "contactSettingsForm",
        "teacherWhatsapp",
        "teacherContactEmail",
        "teacherClassroomMeetingUrl",
        "contactMsg",
        "revenueSettingsForm",
        "teacherRevenueTotalInput",
        "revenueSettingsMsg",
        "preplyTeacherName",
        "preplyArabicName",
        "preplyTeacherHeadline",
        "preplyAverageRatingLabel",
        "preplyReviewCountBadge",
        "preplyHoursBadge",
        "preplyStudentsBadge",
        "preplyQuoteArabic",
        "preplyBioText",
        "bioFadeOverlay",
        "preplyBioToggleBtn",
        "preplyBioToggleText",
        "preplyBioToggleChevron",
        "preplyReviewCountHeader",
        "preplyAverageScoreText",
        "preplyReviewsGrid",
        "preplyReviewsSort",
        "studentReviewsToggleBtn",
        "preplyRateDisplay",
        "preplyAvatarContainer",
        "preplyVideoContainer",
        "preplyPlayVideoBtn",
        "studentReviewCard",
        "studentReviewForm",
        "studentRatingSelect",
        "studentReviewCountry",
        "studentReviewTag",
        "studentReviewText",
        "studentReviewSubmit",
        "studentReviewMsg",
        "studentReviewSuccessBox",
        "studentReviewPrompt",
        "studentReviewPromptWrite",
        "studentReviewPromptLater",
        "studentReviewPromptDismiss",
        "studentReviewPromptMsg",
        "lessonFeedbackCard",
        "lessonFeedbackForm",
        "lessonFeedbackBookingId",
        "lessonFeedbackLessonLabel",
        "lessonFeedbackComment",
        "lessonFeedbackSubmit",
        "lessonFeedbackLater",
        "lessonFeedbackClose",
        "lessonFeedbackReminder",
        "lessonFeedbackMsg",
        "lessonRatingSummary",
        "lessonRatingSummaryGrid",
        "lessonRatingSummaryCount",
        "teacherLessonFeedbackCount",
        "teacherLessonFeedbackMetrics",
        "teacherLessonFeedbackComments",
        "teacherProfileForm",
        "teacherProfileNameInput",
        "teacherProfileRateInput",
        "teacherProfileHeadlineInput",
        "teacherProfileAvatarUrlInput",
        "teacherProfileAvatarFileInput",
        "teacherProfileVideoUrlInput",
        "teacherProfileHoursInput",
        "teacherProfileStudentsInput",
        "teacherProfileQuoteInput",
        "teacherProfileBioInput",
        "saveTeacherProfileBtn",
        "teacherProfileMsg",
        "togglePublicReviewsBtn",
        "toggleAdminReviewsListBtn",
        "studentReviewsSection",
        "teacherReviewsCountLabel",
        "teacherReviewsAdminList",
        "syncPreplyReviewsBtn",
        "rebuildPreplyReviewsBtn",
        "preplyReviewsSyncMsg",
        "appsScriptForm",
        "teacherAppsScriptUrl",
        "appsScriptMsg",
        "appsScriptTestBtn",
        "appsScriptRefreshBusyBtn",
        "appsScriptSyncPendingBtn",
        "appsScriptQuotaBtn",
        "appsScriptInstallReminderBtn",
        "appsScriptReminderCheckBtn",
        "appsScriptBalanceCheckBtn",
        "appsScriptPreplyStatsBtn",
        "preplyStatsSummary",
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
        "teacherPackagesForm",
        "teacherPackagesContainer",
        "teacherAddPackageBtn",
        "teacherPackagesMsg",
        "googleSyncIndicator",
        "googleSyncTime",
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
        state.googleCalendarModuleLoading = loadScriptOnce("./js/google-calendar.js?v=20260729-busy-reconcile-v5").finally(() => {
            state.googleCalendarModuleLoading = null;
        });
    }
    await state.googleCalendarModuleLoading;
}

function setStatus(element, message, tone = "") {
    if (!element) return;
    element.classList.remove("is-appearing", "is-error", "is-success");
    element.textContent = message || "";
    if (message) {
        void element.offsetWidth; // Force layout reflow to restart CSS fade-in animation
        element.classList.add("is-appearing");
    }
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

function formatTimezoneGmt(timeZone) {
    try {
        const parts = Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'longOffset'
        }).formatToParts(new Date());
        const offset = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
        if (offset === 'GMT') return 'GMT +0:00';
        return offset.replace('GMT', 'GMT ').replace(/\+0/g, '+').replace(/\-0/g, '-');
    } catch {
        return 'GMT';
    }
}

function getDisplayTimezone() {
    return state.studentTimezone || getLocalTimezone();
}

function initializeStudentTimezoneSelector() {
    if (!els.studentTimezoneSelect) return;

    const localTz = getLocalTimezone();
    let allTimezones = [];

    try {
        if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
            allTimezones = Intl.supportedValuesOf("timeZone");
        }
    } catch (e) {
        console.warn("Intl.supportedValuesOf is not supported, using fallback.", e);
    }

    if (!allTimezones || allTimezones.length === 0) {
        // High-quality, robust fallback list of major world timezones across all regions
        allTimezones = [
            "Africa/Algiers", "Africa/Cairo", "Africa/Casablanca", "Africa/Harare", "Africa/Johannesburg", "Africa/Nairobi",
            "America/Anchorage", "America/Argentina/Buenos_Aires", "America/Bogota", "America/Caracas", "America/Chicago",
            "America/Denver", "America/Halifax", "America/Los_Angeles", "America/Mexico_City", "America/New_York",
            "America/Phoenix", "America/Santiago", "America/Sao_Paulo", "America/St_Johns", "America/Toronto", "America/Vancouver",
            "Asia/Almaty", "Asia/Amman", "Asia/Baghdad", "Asia/Baku", "Asia/Bangkok", "Asia/Beirut", "Asia/Cairo",
            "Asia/Colombo", "Asia/Damascus", "Asia/Dhaka", "Asia/Dubai", "Asia/Gaza", "Asia/Hong_Kong", "Asia/Jakarta",
            "Asia/Jerusalem", "Asia/Kabul", "Asia/Karachi", "Asia/Kolkata", "Asia/Kuwait", "Asia/Manila", "Asia/Nicosia",
            "Asia/Qatar", "Asia/Riyadh", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Asia/Taipei", "Asia/Tashkent",
            "Asia/Tbilisi", "Asia/Tehran", "Asia/Tokyo", "Asia/Yerevan",
            "Atlantic/Azores", "Atlantic/Canary",
            "Australia/Adelaide", "Australia/Brisbane", "Australia/Darwin", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
            "Europe/Amsterdam", "Europe/Athens", "Europe/Belgrade", "Europe/Berlin", "Europe/Brussels", "Europe/Bucharest",
            "Europe/Budapest", "Europe/Copenhagen", "Europe/Dublin", "Europe/Helsinki", "Europe/Istanbul", "Europe/Kiev",
            "Europe/Lisbon", "Europe/London", "Europe/Madrid", "Europe/Moscow", "Europe/Oslo", "Europe/Paris", "Europe/Prague",
            "Europe/Rome", "Europe/Stockholm", "Europe/Vienna", "Europe/Warsaw", "Europe/Zurich",
            "Pacific/Auckland", "Pacific/Chatham", "Pacific/Fiji", "Pacific/Honolulu", "Pacific/Kiritimati", "Pacific/Pago_Pago"
        ];
    }

    // De-duplicate just in case, and ensure the local timezone is present
    const uniqueTzSet = new Set(allTimezones);
    if (localTz) {
        uniqueTzSet.add(localTz);
    }

    const sortedTimezones = Array.from(uniqueTzSet).sort((a, b) => a.localeCompare(b));

    els.studentTimezoneSelect.innerHTML = "";

    sortedTimezones.forEach((tz) => {
        const option = document.createElement("option");
        option.value = tz;

        // Human-friendly representation of the timezone name
        const displayTzName = tz.replace(/_/g, " ");
        option.textContent = `${displayTzName} (${formatTimezoneGmt(tz)})`;
        if (tz === (state.studentTimezone || localTz)) {
            option.selected = true;
        }
        els.studentTimezoneSelect.appendChild(option);
    });

    const activeTz = state.studentTimezone || localTz;
    if (els.selectedTimezoneName) {
        els.selectedTimezoneName.textContent = activeTz.replace(/_/g, " ");
    }
    if (els.selectedTimezoneOffset) {
        els.selectedTimezoneOffset.textContent = formatTimezoneGmt(activeTz);
    }

    // Update auto-detection visual state badge
    const badgeEl = document.getElementById("timezoneAutoBadge");
    const labelEl = document.getElementById("timezoneAutoLabel");
    const isLocal = activeTz === localTz;

    if (badgeEl) {
        badgeEl.style.backgroundColor = isLocal ? "#10b981" : "#f59e0b"; // green for auto-detected, amber for custom override
    }
    if (labelEl) {
        labelEl.textContent = isLocal ? "Device Timezone" : "Custom Timezone";
        labelEl.style.color = isLocal ? "#059669" : "#d97706";
    }
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

function formatWeekRangeLabel(offset, startKey, endKey) {
    const label = offset === 0 ? "This week" : offset === 1 ? "Next week" : `In ${offset} weeks`;
    return `${label} · ${formatDateKey(startKey, { month: "short", day: "numeric" })} - ${formatDateKey(endKey, { month: "short", day: "numeric" })}`;
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
    const val = toMoneyValue(value);
    const absStr = Math.abs(val).toLocaleString([], {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
    return val < 0 ? `-$${absStr}` : `$${absStr}`;
}

function getConfiguredLessonPrice() {
    const match = String(state.profileSettings?.rateText || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    return match ? toMoneyValue(match[0]) : 0;
}

function getStudentTotalLessonCredits(profile = state.studentProfile || {}) {
    return Math.max(0, Math.floor(Number(profile.lessonCredits || 0)) - Number(state.pendingLateCancellationCount || 0));
}

function isUnchargedPaidBooking(booking) {
    const status = String(booking?.status || "booked").toLowerCase();
    const lessonEndAt = getLessonEndAt(booking);
    return booking?.isFreeTrial !== true
        && !booking?.balanceChargedAt
        && booking?.balanceCharged !== true
        && status !== "canceled"
        && status !== "completed"
        && lessonEndAt > Date.now();
}

async function countReservedPaidLessons(studentUid) {
    if (!window.db || !studentUid) return 0;
    const snap = await window.db.collection("bookings").where("studentUid", "==", studentUid).limit(200).get();
    let count = 0;
    snap.forEach((doc) => { if (isUnchargedPaidBooking(doc.data() || {})) count += 1; });
    return count;
}

function getCreditClaimId(studentUid, unit) {
    return `${studentUid}_${unit}`;
}

function getSlotClaimId(slot) {
    return getBookingSlotClaimId(slot);
}

function writeNotificationJob(writer, job) {
    const { id, ...data } = job;
    writer.set(window.db.collection("notificationJobs").doc(id), data);
}

function notificationSummaryFields(teacherJob, studentJob, operationVersion) {
    const fields = { notificationOperationVersion: Number(operationVersion || 0) };
    [["teacher", teacherJob], ["student", studentJob]].forEach(([prefix, job]) => {
        fields[`${prefix}NotificationStatus`] = job.state;
        fields[`${prefix}NotificationAttempts`] = Number(job.attempts || 0);
        fields[`${prefix}NotificationLastAttemptAt`] = Number(job.lastAttemptAt || 0);
        fields[`${prefix}NotificationNextRetryAt`] = Number(job.nextRetryAt || 0);
        fields[`${prefix}NotificationLastError`] = String(job.lastError || "");
        fields[`${prefix}NotificationSentAt`] = Number(job.sentAt || 0);
    });
    return fields;
}

function createBookingNotificationJobs(writer, bookingId, bookingData, { notifyTeacher = true } = {}) {
    const operationVersion = Number(bookingData.createdAt || Date.now());
    const teacherJob = createNotificationJob({
        bookingId,
        notificationType: "created",
        operationVersion,
        recipientType: "teacher",
        recipientEmail: notifyTeacher ? state.contactSettings?.email : "",
        actor: bookingData.source || "student",
    });
    const studentJob = createNotificationJob({
        bookingId,
        notificationType: "created",
        operationVersion,
        recipientType: "student",
        recipientEmail: bookingData.email,
        actor: bookingData.source || "student",
    });
    if (!notifyTeacher) {
        teacherJob.state = "skipped";
        teacherJob.nextRetryAt = 0;
        teacherJob.lastError = "Teacher-created lesson does not require a duplicate teacher notification.";
    }
    writeNotificationJob(writer, teacherJob);
    writeNotificationJob(writer, studentJob);
    return { teacherJob, studentJob };
}

function createEventNotificationJobs(writer, bookingId, booking, notificationType, operationVersion, actor, { notifyTeacher = true, notifyStudent = true } = {}) {
    const teacherJob = createNotificationJob({
        bookingId,
        notificationType,
        operationVersion,
        recipientType: "teacher",
        recipientEmail: notifyTeacher ? state.contactSettings?.email : "",
        actor,
    });
    const studentJob = createNotificationJob({
        bookingId,
        notificationType,
        operationVersion,
        recipientType: "student",
        recipientEmail: notifyStudent ? booking.email : "",
        actor,
    });
    if (!notifyTeacher) {
        teacherJob.state = "skipped";
        teacherJob.nextRetryAt = 0;
        teacherJob.lastError = "This notification does not require a teacher email.";
    }
    if (!notifyStudent) {
        studentJob.state = "skipped";
        studentJob.nextRetryAt = 0;
        studentJob.lastError = "This notification does not require a student email.";
    }
    writeNotificationJob(writer, teacherJob);
    writeNotificationJob(writer, studentJob);
    return { teacherJob, studentJob };
}

async function commitBookingWithReservation({ bookingRef, bookingData, publicBookingData }) {
    const studentUid = bookingData.studentUid;
    const slot = Number(bookingData.slot || 0);
    const userRef = window.db.collection("users").doc(studentUid);
    const slotClaimRef = window.db.collection("bookingSlotClaims").doc(getSlotClaimId(slot));
    const intervalClaimIds = getBookingIntervalClaimIds(slot, bookingData.durationMinutes);
    const intervalClaimRefs = intervalClaimIds.map((id) => window.db.collection("bookingSlotClaims").doc(id));
    let resolvedBookingId = bookingRef.id;
    let resolvedBookingData = bookingData;
    const legacyReservationSnap = bookingData.isFreeTrial === true
        ? null
        : await window.db.collection("bookings").where("studentUid", "==", studentUid).limit(200).get();
    const legacyReservations = legacyReservationSnap
        ? legacyReservationSnap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
            .filter((booking) => isUnchargedPaidBooking(booking))
            .sort((a, b) => Number(a.createdAt || a.slot || 0) - Number(b.createdAt || b.slot || 0))
        : [];

    await window.db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const slotClaimSnap = await transaction.get(slotClaimRef);
        const intervalClaimSnaps = [];
        for (const ref of intervalClaimRefs) intervalClaimSnaps.push(await transaction.get(ref));
        if (!userSnap.exists) throw new Error("Student account was not found.");

        if (slotClaimSnap.exists) {
            const existingClaim = slotClaimSnap.data() || {};
            if (existingClaim.studentUid === studentUid && existingClaim.bookingId) {
                resolvedBookingId = existingClaim.bookingId;
                return;
            }
            throw new Error("That time was just taken. Please choose another slot.");
        }
        if (intervalClaimSnaps.some((snap) => snap.exists)) {
            throw new Error("That time overlaps another lesson. Please choose another slot.");
        }

        const freshProfile = userSnap.data() || {};
        const totalCredits = Math.max(0, Math.floor(Number(freshProfile.lessonCredits || 0)));
        const allowOverdraft = freshProfile.allowOverdraft === true;
        let reservationClaimRef = null;
        let reservedCreditUnit = null;

        if (bookingData.isFreeTrial !== true && !allowOverdraft) {
            const cappedCredits = Math.min(500, Math.max(0, Math.floor(totalCredits)));
            const claimRefs = Array.from({ length: cappedCredits }, (_, index) => (
                window.db.collection("lessonCreditClaims").doc(getCreditClaimId(studentUid, index + 1))
            ));
            const claimSnaps = [];
            for (const ref of claimRefs) claimSnaps.push(await transaction.get(ref));
            const occupiedUnits = new Set();
            claimSnaps.forEach((snap, index) => { if (snap.exists) occupiedUnits.add(index + 1); });
            legacyReservations.forEach((legacyBooking) => {
                const alreadyClaimed = claimSnaps.some((snap) => snap.exists && snap.data()?.bookingId === legacyBooking.id);
                if (alreadyClaimed) return;
                const legacyUnit = claimRefs.findIndex((ref, index) => !occupiedUnits.has(index + 1));
                if (legacyUnit < 0) return;
                const unit = legacyUnit + 1;
                occupiedUnits.add(unit);
                transaction.set(claimRefs[legacyUnit], {
                    bookingId: legacyBooking.id,
                    studentUid,
                    unit,
                    slot: Number(legacyBooking.slot || 0),
                    state: "reserved",
                    createdAt: Number(legacyBooking.createdAt || Date.now()),
                    migratedFromLegacy: true,
                });
            });
            const freeIndex = claimRefs.findIndex((ref, index) => !occupiedUnits.has(index + 1));
            if (freeIndex < 0) throw new Error("You have no unreserved lesson credit left.");
            reservedCreditUnit = freeIndex + 1;
            reservationClaimRef = claimRefs[freeIndex];
        }

        const now = Date.now();
        const safeBookingData = {
            ...bookingData,
            bookingOperationId: getSlotClaimId(slot),
            slotClaimIds: [slotClaimRef.id, ...intervalClaimIds],
            consumeAfter: getLessonEndAt(bookingData),
            reservationState: bookingData.isFreeTrial === true ? "not-required" : "active",
            reservationClaimId: reservationClaimRef?.id || "",
            reservedCreditUnit: reservedCreditUnit || 0,
        };
        const notificationJobs = createBookingNotificationJobs(transaction, bookingRef.id, safeBookingData);
        Object.assign(safeBookingData, notificationSummaryFields(notificationJobs.teacherJob, notificationJobs.studentJob, safeBookingData.createdAt || now));
        transaction.set(bookingRef, safeBookingData);
        transaction.set(window.db.collection("publicBookings").doc(bookingRef.id), publicBookingData);
        transaction.set(slotClaimRef, {
            bookingId: bookingRef.id,
            studentUid,
            slot,
            createdAt: now,
        });
        intervalClaimRefs.forEach((claimRef) => transaction.set(claimRef, {
            bookingId: bookingRef.id,
            studentUid,
            slot,
            endAt: getLessonEndAt(bookingData),
            claimType: "interval",
            createdAt: now,
        }));
        if (reservationClaimRef) {
            transaction.set(reservationClaimRef, {
                bookingId: bookingRef.id,
                studentUid,
                unit: reservedCreditUnit,
                slot,
                state: "reserved",
                createdAt: now,
            });
        }
        if (bookingData.isFreeTrial === true) {
            transaction.set(window.db.collection("trialClaims").doc(studentUid), {
                studentUid,
                bookingId: bookingRef.id,
                createdAt: now,
            });
        }
        resolvedBookingData = safeBookingData;
    });

    if (resolvedBookingId !== bookingRef.id) {
        const existingRef = window.db.collection("bookings").doc(resolvedBookingId);
        const existingSnap = await existingRef.get();
        if (!existingSnap.exists) throw new Error("The existing booking could not be loaded. Please refresh and try again.");
        return { bookingRef: existingRef, bookingData: existingSnap.data() || {}, alreadyExists: true };
    }
    return { bookingRef, bookingData: resolvedBookingData, alreadyExists: false };
}

function updateStudentBalanceUi() {
    const signedIn = isStudentSignedIn();
    if (els.studentBalanceCard) {
        els.studentBalanceCard.hidden = !signedIn;
    }
    if (!signedIn) return;

    if (els.studentBalanceValue) {
        els.studentBalanceValue.textContent = "Lesson credits";
    }

    if (els.studentLessonPriceValue) {
        els.studentLessonPriceValue.textContent = "";
        els.studentLessonPriceValue.hidden = true;
        els.studentLessonPriceValue.style.display = "none";
    }

    const remainingBadge = document.getElementById("studentRemainingLessonsBadge");
    if (remainingBadge) {
        const purchasedLessons = getStudentTotalLessonCredits();
        const reservedLessons = Number(state.reservedPaidLessons || 0);
        const remainingLessons = Math.max(0, purchasedLessons - reservedLessons);
        if (remainingLessons > 0) {
            remainingBadge.innerHTML = `<span><small>Total</small><strong>${purchasedLessons}</strong></span><span><small>Reserved</small><strong>${reservedLessons}</strong></span><span class="is-available"><small>Available</small><strong>${remainingLessons}</strong></span>`;
        } else if (remainingLessons < 0) {
            remainingBadge.innerHTML = `<span><small>Total</small><strong>${purchasedLessons}</strong></span><span><small>Reserved</small><strong>${reservedLessons}</strong></span><span class="is-overdue"><small>Overdue</small><strong>${Math.abs(remainingLessons)}</strong></span>`;
        } else {
            remainingBadge.innerHTML = `<span><small>Total</small><strong>${purchasedLessons}</strong></span><span><small>Reserved</small><strong>${reservedLessons}</strong></span><span class="is-empty"><small>Available</small><strong>0</strong></span>`;
        }
    }

    const trialNotice = document.getElementById("studentTrialNotice");
    if (trialNotice) {
        const profile = state.studentProfile || {};
        if (profile.trialUsed !== true) {
            trialNotice.hidden = false;
            trialNotice.style.display = "block";
        } else {
            trialNotice.hidden = true;
            trialNotice.style.display = "none";
        }
    }

    const transactionsList = document.getElementById("studentTransactionsList");
    if (transactionsList) {
        const profile = state.studentProfile || {};
        const txs = profile.transactions || [];
        if (!txs.length) {
            transactionsList.innerHTML = `<div class="small-note" style="text-align: center; color: var(--ink-light); padding: 10px 0;">No financial transactions recorded yet.</div>`;
        } else {
            const sortedTxs = [...txs].sort((a, b) => b.at - a.at);
            transactionsList.innerHTML = sortedTxs.map((tx) => {
                const isCredit = tx.amount > 0;
                const amountSign = isCredit ? `+$${tx.amount.toFixed(2)}` : (tx.amount === 0 ? "Free" : `-$${Math.abs(tx.amount).toFixed(2)}`);
                const amountStyle = isCredit
                    ? "color: #059669; font-weight: 700;"
                    : (tx.amount === 0 ? "color: #2563eb; font-weight: 700;" : "color: #dc2626; font-weight: 700;");
                const dateStr = new Date(tx.at).toLocaleString("en-US", {
                    weekday: "short",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true
                });
                const timeActionLabel = isCredit ? "Added on" : "Charged on";
                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding: 8px 0; gap: 8px;">
                        <div>
                           <div style="font-weight: 600; color: var(--ink); text-align: left;">${escapeHtml(tx.description)}</div>
                           <div style="font-size: 0.75rem; color: var(--muted); margin-top: 2px;">📅 ${timeActionLabel}: ${dateStr}</div>
                        </div>
                        <div style="text-align: right; min-width: 90px;">
                           <span style="${amountStyle}">${amountSign}</span>
                           <div style="font-size: 0.75rem; color: var(--muted); font-weight: 500; margin-top: 2px;">Balance: $${tx.newBalance.toFixed(2)}</div>
                        </div>
                    </div>
                `;
            }).join("");
        }
    }
}

function updateCourseAccessRequestUi() {
    const signedIn = isStudentSignedIn();
    const studentProfile = state.studentProfile || {};
    const requested = (studentProfile.courseAccessRequested === true || studentProfile.paymentStatus === "pending")
        && Number(studentProfile.requestedAmount || 0) > 0
        && Number(studentProfile.requestedLessons || 0) > 0;
    const requestedPkg = studentProfile.requestedPackage || "Lesson Package";

    const requestBtn = document.getElementById("requestCourseAccessBtn");
    const msgEl = document.getElementById("courseAccessRequestMsg");

    if (requestBtn) {
        requestBtn.disabled = !signedIn;
        requestBtn.textContent = requested
            ? "⚡ Request Pending Approval"
            : "📩 Notify Teacher (Request Credit Addition)";
    }

    if (msgEl) {
        if (!signedIn) {
            msgEl.textContent = "Sign in first to choose a package and request account credit.";
            msgEl.className = "status-line";
        } else if (Number(studentProfile.lessonCredits || 0) > 0) {
            const remainingLessons = Math.max(0, Math.floor(Number(studentProfile.lessonCredits || 0)));
            msgEl.textContent = `Active lesson credits: ${remainingLessons} lesson${remainingLessons === 1 ? "" : "s"}.`;
            msgEl.className = "status-line status-line--success";
        } else if (requested) {
            msgEl.textContent = `⏳ Payment notification sent for ${requestedPkg}. Waiting for teacher verification.`;
            msgEl.className = "status-line status-line--warning";
        } else {
            msgEl.textContent = "Select a package above and click notify once you send payment.";
            msgEl.className = "status-line";
        }
    }
}

async function requestFullCourseAccess() {
    if (!isStudentSignedIn()) {
        els.studentAuthModal?.classList.add("modal--open");
        const msgEl = document.getElementById("courseAccessRequestMsg");
        if (msgEl) setStatus(msgEl, "Please sign in or create an account first to request a package.", "error");
        return;
    }
    const pkg = state.selectedPackage;
    if (!pkg) {
        throw new Error("Choose a lesson package first.");
    }
    const msgEl = document.getElementById("courseAccessRequestMsg");

    await window.db.collection("users").doc(state.currentUser.uid).set({
        email: state.currentUser.email || "",
        name: getStudentName(),
        role: "student",
        courseAccessRequested: true,
        courseAccessRequestedAt: Date.now(),
        requestedPackage: pkg.label,
        requestedAmount: pkg.price,
        requestedLessons: pkg.lessons,
        paymentStatus: "pending",
        paymentNote: `Student notified payment for ${pkg.label}.`,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (msgEl) {
        setStatus(msgEl, `✅ Notification sent to teacher for ${pkg.label}! Once verified, your account balance will be credited.`, "success");
    }
}

async function sendPasswordResetLink({ emailInput, statusElement, button }) {
    if (!window.auth || typeof window.auth.sendPasswordResetEmail !== "function") {
        setStatus(statusElement, "Firebase password reset is not available.", "error");
        return;
    }
    const email = (emailInput?.value || "").trim().toLowerCase();
    if (!email) {
        setStatus(statusElement, "Please enter your email address first.", "error");
        emailInput?.focus();
        return;
    }
    await withButtonLoading(button, "Sending...", async () => {
        setStatus(statusElement, "Sending password reset email...");
        await window.auth.sendPasswordResetEmail(email);
        setStatus(statusElement, "Password reset email sent. Check your inbox and spam/junk folder.", "success");
    });
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
    if (els.studentForgotPasswordBtn) {
        els.studentForgotPasswordBtn.hidden = state.studentAuthMode === "signup";
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
    if (els.studentDeleteAccountBtn) {
        els.studentDeleteAccountBtn.hidden = !signedIn;
    }
    updateStudentBalanceUi();
    updateCourseAccessRequestUi();
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
    updateBookingDayControls();
}

function updateBookingDayControls() {
    if (!state.visibleDateKey) return;
    const timezone = getDisplayTimezone();
    const weekStartDateKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
    if (els.bookingDayLabel) {
        els.bookingDayLabel.textContent = formatDateKey(state.visibleDateKey, {
            weekday: "long",
            month: "short",
            day: "numeric",
        });
    }
    if (els.bookingDayPrev) {
        els.bookingDayPrev.disabled = state.bookingWeekOffset === 0 && state.visibleDateKey === weekStartDateKey;
    }
}

function setVisibleBookingDate(dateKey) {
    if (!dateKey) return;
    state.visibleDateKey = dateKey;
    const timezone = getDisplayTimezone();
    const weekStartDateKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
    for (let i = 0; i < 7; i += 1) {
        if (addDaysToDateKey(weekStartDateKey, i) === dateKey) {
            syncBookingGridSelection();
            return;
        }
    }
}

async function moveVisibleBookingDay(direction) {
    const timezone = getDisplayTimezone();
    const currentWeekStartKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
    const currentKey = state.visibleDateKey || currentWeekStartKey;
    let nextKey = addDaysToDateKey(currentKey, direction);
    const currentWeekEndKey = addDaysToDateKey(currentWeekStartKey, 6);

    if (direction < 0 && nextKey < currentWeekStartKey) {
        if (state.bookingWeekOffset === 0) return;
        state.bookingWeekOffset = Math.max(0, state.bookingWeekOffset - 1);
        const newWeekStartKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
        nextKey = addDaysToDateKey(newWeekStartKey, 6);
        state.visibleDateKey = nextKey;
        showBookingCalendarLoading();
        await refreshRuntimeBusyBlocks();
        await renderBookingCalendar();
        return;
    }

    if (direction > 0 && nextKey > currentWeekEndKey) {
        state.bookingWeekOffset += 1;
        const newWeekStartKey = getScheduleStartDateKey(state.bookingWeekOffset, timezone);
        state.visibleDateKey = newWeekStartKey;
        showBookingCalendarLoading();
        await refreshRuntimeBusyBlocks();
        await renderBookingCalendar();
        return;
    }

    setVisibleBookingDate(nextKey);
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
        updateSystemSyncStatusIndicator();
        return;
    }
    try {
        const result = await window.fetchBusyBlocksFromAppsScript({
            days: requestedDays,
            timeZone: getTeacherTimezone(),
            includeTeacherDetails: state.teacherRole === "teacher",
            force,
        });
        state.busySyncReady = !!(result?.success && Array.isArray(result.busyBlocks));
        state.busySyncMessage = state.busySyncReady ? "" : (result?.message || "Could not reach Google Calendar sync.");
        const seenBusyIntervals = new Set();
        state.runtimeBusyBlocks = state.busySyncReady
            ? [...result.busyBlocks]
                .filter((block) => {
                    const key = `${Number(block?.startMs || 0)}:${Number(block?.endMs || 0)}`;
                    if (seenBusyIntervals.has(key)) return false;
                    seenBusyIntervals.add(key);
                    return true;
                })
                .sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0))
            : [];
        state.busyBlocksRangeDays = state.busySyncReady ? requestedDays : 0;
        state.busyBlocksFetchedAt = Date.now();
    } catch (err) {
        state.busySyncReady = false;
        state.busySyncMessage = err?.message || "Could not connect to Google Calendar sync.";
        state.runtimeBusyBlocks = [];
        state.busyBlocksRangeDays = 0;
        state.busyBlocksFetchedAt = Date.now();
    }
    updateSystemSyncStatusIndicator();
}

async function refreshGoogleBusyAndCalendar({ silent = true } = {}) {
    showBookingCalendarLoading("Refreshing available times...");
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
        if (document.hidden) return;
        const studentScreen = document.getElementById("student-screen");
        if (!studentScreen?.classList.contains("app-screen--active")) return;
        ensureBookingCalendarLoaded({ force: true }).catch(console.error);
    }, GOOGLE_BUSY_REFRESH_MS);
}

function stopGoogleBusyAutoRefresh() {
    if (!state.busyRefreshTimer) return;
    window.clearInterval(state.busyRefreshTimer);
    state.busyRefreshTimer = null;
}

async function refreshTeacherCalendarData({ force = false } = {}) {
    if (!state.teacherUser || state.teacherRole !== "teacher") return;
    if (!force && Date.now() - state.teacherLastCalendarRefreshAt < BUSY_BLOCKS_CACHE_MS) return;
    if (state.teacherCalendarRefreshInFlight) return state.teacherCalendarRefreshInFlight;
    state.teacherCalendarRefreshInFlight = (async () => {
        state.teacherLastCalendarRefreshAt = Date.now();
        await refreshRuntimeBusyBlocks({ force, minDays: 31 });
        await refreshTeacherBookings({ reconcile: false });
        renderTeacherWeekCalendar();
    })().finally(() => { state.teacherCalendarRefreshInFlight = null; });
    return state.teacherCalendarRefreshInFlight;
}

function stopTeacherCalendarAutoRefresh() {
    if (state.teacherCalendarRefreshTimer) window.clearInterval(state.teacherCalendarRefreshTimer);
    state.teacherCalendarRefreshTimer = null;
    if (typeof state.teacherBookingsUnsubscribe === "function") state.teacherBookingsUnsubscribe();
    state.teacherBookingsUnsubscribe = null;
    if (state.teacherBookingsRefreshTimer) window.clearTimeout(state.teacherBookingsRefreshTimer);
    state.teacherBookingsRefreshTimer = null;
    if (state.teacherStudentsRefreshTimer) window.clearTimeout(state.teacherStudentsRefreshTimer);
    state.teacherStudentsRefreshTimer = null;
}

function startTeacherCalendarAutoRefresh() {
    stopTeacherCalendarAutoRefresh();
    if (!state.teacherUser || state.teacherRole !== "teacher") return;
    const refreshIfVisible = (force = false) => {
        const teacherScreen = document.getElementById("teacher-screen");
        if (document.hidden || !teacherScreen?.classList.contains("app-screen--active")) return;
        refreshTeacherCalendarData({ force }).catch((error) => console.warn("Automatic teacher calendar refresh failed.", error));
    };
    state.teacherCalendarRefreshTimer = window.setInterval(() => refreshIfVisible(true), GOOGLE_BUSY_REFRESH_MS);
    let receivedInitialBookingSnapshot = false;
    state.teacherBookingsUnsubscribe = window.db.collection("bookings")
        .where("slot", ">=", Date.now() - 4 * 60 * 60 * 1000)
        .orderBy("slot")
        .limit(150)
        .onSnapshot((snapshot) => {
        const hasCanceledBookingChange = receivedInitialBookingSnapshot && snapshot.docChanges().some((change) => (
            change.type === "modified" && String(change.doc.data()?.status || "").toLowerCase() === "canceled"
        ));
        receivedInitialBookingSnapshot = true;
        if (state.teacherBookingsRefreshTimer) window.clearTimeout(state.teacherBookingsRefreshTimer);
        state.teacherBookingsRefreshTimer = window.setTimeout(() => {
            const teacherScreen = document.getElementById("teacher-screen");
            if (document.hidden || !teacherScreen?.classList.contains("app-screen--active")) return;
            refreshTeacherBookings({ reconcile: false, bookingSnapshot: snapshot })
                .catch((error) => console.warn("Could not render updated teacher bookings.", error));
        }, 400);
        if (state.teacherStudentsRefreshTimer) window.clearTimeout(state.teacherStudentsRefreshTimer);
        // Do not reconcile from a booking snapshot. Reconciliation writes to
        // bookings and would emit another snapshot, creating a quota-heavy loop.
        if (state.activeTeacherTab === "tab-students" && (hasCanceledBookingChange || Date.now() - state.teacherStudentsLastRefreshAt >= 30000)) {
            state.teacherStudentsRefreshTimer = window.setTimeout(() => {
                refreshTeacherStudents().catch((error) => console.warn("Could not refresh student balances after a booking change.", error));
            }, 650);
        }
        }, (error) => console.warn("Teacher booking listener failed.", error));
    refreshIfVisible(true);
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.teacherRole === "teacher") refreshTeacherCalendarData({ force: true }).catch(console.warn);
});
window.addEventListener("focus", () => {
    if (state.teacherRole === "teacher") refreshTeacherCalendarData({ force: true }).catch(console.warn);
});

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
            classroomMeetingUrl: typeof publicData.classroomMeetingUrl === "string" ? publicData.classroomMeetingUrl : "",
        };
        updateStudentOfferUi();
        window.bookingSettings = state.bookingSettings;
        state.publicSettingsLoaded = true;
    })();
    try {
        await state.publicSettingsInFlight;
    } finally {
        state.publicSettingsInFlight = null;
    }
}

function updateStudentOfferUi() {
    const offers = state.bookingSettings.courseOffers || {};
    const lessonPrice = getConfiguredLessonPrice();
    const configuredRateText = String(state.profileSettings?.rateText || "").trim();
    const rateText = configuredRateText
        ? (/^regular rate\s*:/i.test(configuredRateText) ? configuredRateText : `Regular rate: ${configuredRateText}`)
        : "Rate set by teacher";
    const lessonRateDisplay = document.getElementById("lessonRateDisplay");
    if (lessonRateDisplay) lessonRateDisplay.textContent = rateText;
    if (els.preplyRateDisplay) els.preplyRateDisplay.textContent = rateText;
    if (els.studentPaypalReminder) {
        const reminder = offers.paypalReminder ||
            "Just a quick reminder: when you choose to pay through PayPal, please choose Goods and Services. Choosing another option may affect my PayPal account.";
        const paypalLink = normalizePayPalLink(offers.paypalPaymentLink);
        els.studentPaypalReminder.textContent = reminder;
        if (els.studentPaypalLink) {
            els.studentPaypalLink.dataset.paypalBase = paypalLink;
            els.studentPaypalLink.hidden = !paypalLink;
            els.studentPaypalLink.disabled = !paypalLink || !state.selectedPackage;
        }
    }

    const pkgs = Array.isArray(offers.packages) ? offers.packages : [];
    const stillExists = pkgs.some(p => p.lessons === state.selectedPackage?.lessons && p.price === state.selectedPackage?.price);
    if (!stillExists) state.selectedPackage = null;

    const packagesGrid = document.getElementById("packagesGrid");
    if (packagesGrid) {
        packagesGrid.innerHTML = pkgs.map(p => {
            const isSelected = state.selectedPackage && state.selectedPackage.lessons === p.lessons && state.selectedPackage.price === p.price;
            const popularClass = p.popular ? " package-card--popular" : "";
            const selectedClass = isSelected ? " is-selected" : "";
            const popularLabelStyle = p.popular ? "background: #059669; color: #fff;" : "background: var(--accent); color: #fff;";
            return `
                <div class="package-card${popularClass}${selectedClass}" style="cursor: pointer;" data-package-lessons="${p.lessons}" data-package-price="${p.price}" data-package-label="${escapeHtml(p.lessons + " Lessons ($" + p.price + ")")}">
                    ${p.badge ? `<span style="font-size: 0.75rem; ${popularLabelStyle} padding: 2px 6px; border-radius: 12px; font-weight: 700;">${escapeHtml(p.badge)}</span>` : ""}
                    <h4 style="margin: 6px 0 2px;">${p.lessons} Lesson${p.lessons === 1 ? "" : "s"}</h4>
                    <strong style="${p.popular ? "color: #047857;" : "color: var(--ink);"} font-size: 1.1rem;">$${p.price}</strong>
                </div>
            `;
        }).join("");
    }
    const paymentPackagesGrid = document.getElementById("paymentPackagesGrid");
    if (paymentPackagesGrid) paymentPackagesGrid.innerHTML = packagesGrid?.innerHTML || "";

    const sidebarContainer = document.getElementById("sidebarPackagesContainer");
    if (sidebarContainer) {
        sidebarContainer.innerHTML = pkgs.map(p => {
            const badgeText = p.popular ? (p.badge || "Popular") : p.badge;
            return `
                <div class="sidebar-package-item">
                    <span class="sidebar-package-label">
                        ${p.lessons} Lesson${p.lessons === 1 ? "" : "s"}
                        ${badgeText ? `<span class="sidebar-package-badge">${escapeHtml(badgeText)}</span>` : ""}
                    </span>
                    <strong class="sidebar-package-price">$${p.price}</strong>
                </div>
            `;
        }).join("");
    }
}


function syncResponsiveWelcomeLayout() {
    const container = document.querySelector(".preply-container");
    const main = document.querySelector(".preply-main");
    const sidebar = document.querySelector(".preply-sidebar");
    const reviews = document.getElementById("studentReviewsSection");
    if (!container || !main || !sidebar || !reviews) return;

    const isMobile = window.matchMedia("(max-width: 960px)").matches;
    if (isMobile) {
        if (sidebar.parentElement !== main || sidebar.nextElementSibling !== reviews) {
            main.insertBefore(sidebar, reviews);
        }
        return;
    }

    if (sidebar.parentElement !== container || sidebar.previousElementSibling !== main) {
        container.insertBefore(sidebar, main.nextSibling);
    }
}

function normalizePayPalLink(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        const url = new URL(raw);
        const host = url.hostname.toLowerCase();
        const isPayPalHost = host === "paypal.com"
            || host.endsWith(".paypal.com")
            || host === "paypal.me"
            || host.endsWith(".paypal.me");
        return url.protocol === "https:" && isPayPalHost ? url.href : "";
    } catch {
        return "";
    }
}

function buildPayPalPackageUrl(baseValue, amount) {
    const normalized = normalizePayPalLink(baseValue);
    if (!normalized || !(Number(amount) > 0)) return "";
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() === "paypal.me" || url.hostname.toLowerCase().endsWith(".paypal.me")) {
        url.pathname = `${url.pathname.replace(/\/$/, "")}/${Number(amount).toFixed(2).replace(/\.00$/, "")}`;
    }
    return url.href;
}

async function ensureBookingCalendarLoaded({ force = false } = {}) {
    if (state.bookingCalendarLoaded && !force) return;
    if (state.bookingCalendarInFlight && !force) {
        await state.bookingCalendarInFlight;
        return;
    }
    showBookingCalendarLoading();
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
        minimumLeadMinutes: MIN_BOOKING_LEAD_MINUTES,
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
        els.bookingWeekLabel.textContent = formatWeekRangeLabel(state.bookingWeekOffset, weekStartDateKey, weekLabelEndKey);
    }
    updateBookingDayControls();

    if (!els.bookingWeeklyGrid) return;
    els.bookingWeeklyGrid.innerHTML = "";
    let hasAny = false;
    let anyDayHasMoreThan5 = false;

    days.forEach((day, dayIndex) => {
        const column = document.createElement("div");
        column.className = `booking-day-column${day.slots.length ? "" : " is-empty"}${day.dateKey === state.visibleDateKey ? " is-focused" : ""}`;
        column.dataset.dateKey = day.dateKey;
        column.style.setProperty("--col-index", String(dayIndex));

        const weekdayShort = formatDateKey(day.dateKey, { weekday: "short" });
        const dayNumber = formatDateKey(day.dateKey, { day: "numeric" });

        const header = document.createElement("div");
        header.className = "booking-day-header";

        // Accent bar color: first day gets gray (#9ca3af), other days get pink (#f43f5e)
        const accentColor = dayIndex === 0 ? "#9ca3af" : "#f43f5e";

        header.innerHTML = `
            <div class="booking-day-accent-bar" style="background-color: ${accentColor};"></div>
            <div class="booking-day-label">${escapeHtml(weekdayShort)}</div>
            <div class="booking-day-date">${escapeHtml(dayNumber)}</div>
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
            const sortedSlots = [...day.slots].sort((a, b) => a.startMs - b.startMs);
            if (sortedSlots.length > 5) {
                anyDayHasMoreThan5 = true;
            }
            const visibleSlots = (!state.showAllSlots) ? sortedSlots.slice(0, 5) : sortedSlots;

            visibleSlots.forEach((slot) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = `slot-btn${state.selectedSlotMs === slot.startMs ? " is-selected" : ""}`;
                btn.dataset.slotStart = String(slot.startMs);
                btn.textContent = new Date(slot.startMs).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
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

    // Generate mobile day selector tabs dynamically
    const mobileTabsContainer = document.getElementById("bookingMobileDayTabs");
    if (mobileTabsContainer) {
        mobileTabsContainer.innerHTML = "";
        days.forEach((day) => {
            const tabBtn = document.createElement("button");
            tabBtn.type = "button";
            tabBtn.className = `mobile-day-tab${day.dateKey === state.visibleDateKey ? " is-active" : ""}${day.slots.length ? "" : " is-empty"}`;

            const weekdayShort = formatDateKey(day.dateKey, { weekday: "short" });
            const dayNumber = formatDateKey(day.dateKey, { day: "numeric" });

            // Show first 2 characters of weekday name (e.g., Mo, Tu, We)
            const narrowDayName = weekdayShort ? weekdayShort.substring(0, 2) : "";

            tabBtn.innerHTML = `
                <span class="mobile-day-tab-name">${escapeHtml(narrowDayName)}</span>
                <span class="mobile-day-tab-num">${escapeHtml(dayNumber)}</span>
                ${day.slots.length ? '<span class="mobile-day-tab-dot"></span>' : ''}
            `;

            tabBtn.addEventListener("click", () => {
                state.visibleDateKey = day.dateKey;
                renderBookingCalendar().catch(console.error);
            });
            mobileTabsContainer.appendChild(tabBtn);
        });
    }

    if (els.bookingEmptyState) {
        els.bookingEmptyState.hidden = hasAny;
    }

    if (els.viewFullScheduleRow) {
        if (anyDayHasMoreThan5) {
            els.viewFullScheduleRow.style.display = "flex";
            if (els.viewFullScheduleBtn) {
                els.viewFullScheduleBtn.textContent = state.showAllSlots ? "View simple schedule" : "View full schedule";
            }
        } else {
            els.viewFullScheduleRow.style.display = "none";
        }
    }

    if (state.selectedSlotMs) {
        const stillAvailable = schedule.some((slot) => slot.available && slot.startMs === state.selectedSlotMs);
        if (!stillAvailable) setSelectedSlot(null);
    }
}

function showBookingCalendarLoading(message = "Loading available times...") {
    if (els.bookingWeeklyGrid) {
        els.bookingWeeklyGrid.innerHTML = `<div class="booking-calendar-loading">${escapeHtml(message)}</div>`;
    }
    if (els.bookingEmptyState) {
        els.bookingEmptyState.hidden = true;
    }
}

async function loadBookingStatus(email) {
    if (state.currentUser) {
        await loadStudentBookings();
        return;
    }
    if (els.bookingStatusList) {
        els.bookingStatusList.innerHTML = "<div class=\"small-note\">Sign in to view your private bookings.</div>";
    }
    setStatus(els.bookingStatusMsg, email ? "Sign in with this email to view your bookings." : "");
}

let upcomingBannerInterval = null;

function getUpcomingRelativeTime(slotStart) {
    const diff = slotStart - Date.now();
    if (diff <= 0) return "Live now!";
    const mins = Math.ceil(diff / 60000);
    if (mins < 60) {
        return `In ${mins} minute${mins === 1 ? "" : "s"}`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    if (hours < 24) {
        if (remainingMins === 0) {
            return `In ${hours} hour${hours === 1 ? "" : "s"}`;
        }
        return `In ${hours} hour${hours === 1 ? "" : "s"}, ${remainingMins} minute${remainingMins === 1 ? "" : "s"}`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) {
        return `In ${days} day${days === 1 ? "" : "s"}`;
    }
    return `In ${days} day${days === 1 ? "" : "s"}, ${remainingHours} hour${remainingHours === 1 ? "" : "s"}`;
}

function getLessonEntryLabel(accessState) {
    if (accessState.canEnter) return "Enter classroom";
    if (accessState.reason === "ended") return "Lesson ended";
    const minutes = Math.max(1, Math.ceil(accessState.msUntilOpen / 60000));
    if (minutes < 60) return `Opens in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes ? `Opens in ${hours}h ${remainingMinutes}m` : `Opens in ${hours}h`;
}

function renderUpcomingLessonBanner(bookings) {
    const bannerEl = document.getElementById("upcomingLessonBanner");
    if (!bannerEl) return;

    if (upcomingBannerInterval) {
        clearInterval(upcomingBannerInterval);
        upcomingBannerInterval = null;
    }

    if (!bookings || !bookings.length) {
        bannerEl.style.display = "none";
        bannerEl.innerHTML = "";
        return;
    }

    const now = Date.now();
    const activeAndFuture = bookings.filter((b) => {
        const status = (b.status || "").toLowerCase();
        if (status === "canceled" || status === "completed") return false;

        const slotStart = Number(b.slot || 0);
        const durationMinutes = Number(b.durationMinutes || b.slotMinutes || 50);
        const slotEnd = slotStart + durationMinutes * 60 * 1000;
        const accessState = getLessonAccessState(slotStart, now, { lessonMinutes: durationMinutes });

        // Show if active now or starting in less than 15 hours
        if (now >= slotStart && accessState.canEnter) return true;
        if (slotStart > now && (slotStart - now) <= 15 * 60 * 60 * 1000) return true;

        return false;
    });

    if (!activeAndFuture.length) {
        bannerEl.style.display = "none";
        bannerEl.innerHTML = "";
        return;
    }

    // Sort ascending to get the closest one
    activeAndFuture.sort((a, b) => Number(a.slot) - Number(b.slot));
    const nextBooking = activeAndFuture[0];
    const slotStart = Number(nextBooking.slot);
    const lessonDurationMinutes = Number(nextBooking.durationMinutes || nextBooking.slotMinutes || 50);
    const slotEnd = slotStart + lessonDurationMinutes * 60 * 1000;

    bannerEl.style.display = "block";

    const updateBannerContent = () => {
        const currentNow = Date.now();
        const isLive = currentNow >= slotStart && currentNow < slotEnd;
        const accessState = getLessonAccessState(slotStart, currentNow, { lessonMinutes: lessonDurationMinutes });
        let titleHtml = "";
        let countdownText = "";
        let buttonLabel = getLessonEntryLabel(accessState);
        let pulseClass = "";

        const timezone = getDisplayTimezone();
        const dateStr = new Date(slotStart).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: timezone
        });
        const startTimeStr = new Date(slotStart).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: timezone
        });
        const endTimeStr = new Date(slotEnd).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: timezone
        });
        const fullTimeStr = `${startTimeStr} – ${endTimeStr}`;

        if (isLive) {
            const minsActive = Math.floor((currentNow - slotStart) / 60000);
            titleHtml = `<span style="color: #ef4444; font-weight: 800; display: inline-flex; align-items: center; gap: 6px;">🔴 Arabic Lesson is LIVE NOW!</span>`;
            countdownText = `Active lesson started ${minsActive} min${minsActive === 1 ? "" : "s"} ago.`;
            pulseClass = "pulse-active";
        } else {
            titleHtml = `Arabic Lesson`;
            countdownText = getUpcomingRelativeTime(slotStart);
            const timeToStart = slotStart - currentNow;
            if (timeToStart <= 15 * 60 * 1000) {
                pulseClass = "pulse-active";
            }
        }

        const studentDisplayName = state.currentUser?.displayName || state.currentUser?.name || nextBooking?.studentName || "Student";
        const studentInitial = (studentDisplayName.trim()[0] || "S").toUpperCase();
        const motivationalQuotes = [
            "Ready for your next Arabic lesson? Every step brings you closer to fluency! 🌟",
            "Get ready! Consistency is the secret to mastering a new language 🚀",
            "Welcome! Let's build your Arabic skills step by step today ✨",
            "Ready to learn? Great progress happens one lesson at a time 🎓"
        ];
        const quoteIndex = (nextBooking?.slot || 0) % motivationalQuotes.length;
        const motivationalPhrase = motivationalQuotes[quoteIndex];

        bannerEl.innerHTML = `
            <div class="upcoming-banner-card">
                <div class="upcoming-banner-main" style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                        <div style="width: 46px; height: 46px; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.3rem; border-radius: var(--radius-sm); flex-shrink: 0; box-shadow: 0 4px 12px rgba(15,118,110,0.22);">
                            ${escapeHtml(studentInitial)}
                        </div>
                        <div>
                            <div style="font-weight: 800; font-size: 1.2rem; color: var(--ink); line-height: 1.2;">Welcome, ${escapeHtml(studentDisplayName)} 👋</div>
                            <div style="font-size: 0.82rem; color: var(--primary-dark); font-weight: 600; margin-top: 2px;">${escapeHtml(motivationalPhrase)}</div>
                        </div>
                    </div>
                    <div>
                        <div class="upcoming-banner-time" style="font-size: 1.12rem; font-weight: 800; color: var(--ink);">${escapeHtml(fullTimeStr)}</div>
                        <div style="font-size: 0.82rem; color: var(--primary); font-weight: 700; margin-top: -2px; text-transform: uppercase; letter-spacing: 0.4px;">${escapeHtml(dateStr)}</div>
                        <div style="font-size: 0.76rem; color: var(--muted); font-weight: 700; margin-top: 2px;">Timezone: ${escapeHtml(timezone)} (${escapeHtml(formatTimezoneGmt(timezone))})</div>
                        <div class="upcoming-banner-countdown" style="margin: 6px 0 12px 0; font-size: 0.92rem; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 6px;">
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--primary);"></span>
                            ${countdownText}
                        </div>
                    </div>
                    <div>
                        <button class="btn upcoming-banner-btn ${pulseClass}" id="bannerJoinBtn" ${accessState.canEnter ? "" : "disabled"} aria-disabled="${accessState.canEnter ? "false" : "true"}">
                            🎓 ${buttonLabel}
                        </button>
                    </div>
                </div>
                <!-- Custom Stacked retro clock Illustration SVG themed to site colors -->
                <svg width="125" height="125" viewBox="0 0 130 130" fill="none" xmlns="http://www.w3.org/2000/svg" style="align-self: flex-end; margin-left: auto; flex-shrink: 0;">
                    <!-- Base Amber Radio/Clock -->
                    <rect x="25" y="80" width="85" height="40" rx="8" fill="#F59E0B" stroke="var(--ink)" stroke-width="2.5" />
                    <rect x="35" y="105" width="30" height="8" rx="2" fill="#D97706" />
                    <circle cx="80" cy="100" r="6" fill="#0F766E" stroke="var(--ink)" stroke-width="2" />
                    <circle cx="95" cy="100" r="6" fill="#0F766E" stroke="var(--ink)" stroke-width="2" />

                    <!-- Middle Terracotta Clock -->
                    <rect x="35" y="55" width="60" height="30" rx="6" fill="#C2410C" stroke="var(--ink)" stroke-width="2.5" />
                    <rect x="42" y="60" width="46" height="20" rx="3" fill="#FFFDF9" stroke="var(--ink)" stroke-width="2" />
                    <!-- Hands of middle clock -->
                    <path d="M65 70 L75 70" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" />
                    <path d="M65 70 L65 63" stroke="#C2410C" stroke-width="2" stroke-linecap="round" />
                    <circle cx="65" cy="70" r="2.5" fill="var(--ink)" />

                    <!-- Top Teal Alarm Clock -->
                    <!-- Legs -->
                    <line x1="45" y1="52" x2="40" y2="58" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <line x1="85" y1="52" x2="90" y2="58" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <!-- Bells -->
                    <circle cx="45" cy="18" r="7" fill="#5F6875" stroke="var(--ink)" stroke-width="2" />
                    <path d="M42 22 L48 28" stroke="var(--ink)" stroke-width="3" />
                    <circle cx="85" cy="18" r="7" fill="#5F6875" stroke="var(--ink)" stroke-width="2" />
                    <path d="M88 22 L82 28" stroke="var(--ink)" stroke-width="3" />
                    <!-- Bell handle -->
                    <path d="M55 12 H75" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <!-- Body -->
                    <circle cx="65" cy="35" r="20" fill="#0F766E" stroke="var(--ink)" stroke-width="2.5" />
                    <circle cx="65" cy="35" r="15" fill="#FFFDF9" stroke="var(--ink)" stroke-width="2" />
                    <!-- Hands -->
                    <path d="M65 35 L73 38" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
                    <path d="M65 35 L60 28" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
                    <circle cx="65" cy="35" r="2" fill="var(--ink)" />
                </svg>
            </div>
        `;

        // Wire button action
        const btn = bannerEl.querySelector("#bannerJoinBtn");
        if (accessState.canEnter) {
            btn?.addEventListener("click", () => {
                openClassroomDirectly(nextBooking);
            });
        }
    };

    updateBannerContent();

    // Update every 30 seconds to keep countdown accurate
    upcomingBannerInterval = setInterval(updateBannerContent, 30000);
}

async function loadStudentBookings({ includeHistory = state.studentHistoryLoaded, recentSnapshot = null } = {}) {
    if (!els.bookingStatusList) return;
    els.bookingStatusList.innerHTML = "";
    if (!state.currentUser || state.currentRole !== "student") {
        state.reservedPaidLessons = 0;
        els.bookingStatusList.innerHTML = "<div class=\"small-note\">Sign in to see your bookings.</div>";
        return;
    }
    try {
        const email = state.currentUser.email || "";
        const recentCutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
        let snapUid = recentSnapshot;
        let snapEmail = null;

        // 1. Query bookings by studentUid
        if (!snapUid) {
            try {
                snapUid = await window.db
                    .collection("bookings")
                    .where("studentUid", "==", state.currentUser.uid)
                    .where("slot", ">=", recentCutoff)
                    .orderBy("slot", "desc")
                    .limit(40)
                    .get();
            } catch (e) {
                console.warn("Failed querying recent bookings by studentUid:", e);
            }
        }

        // 2. Query bookings by email
        if (email && (!snapUid || snapUid.empty)) {
            try {
                snapEmail = await window.db
                    .collection("bookings")
                    .where("email", "==", email)
                    .where("slot", ">=", recentCutoff)
                    .orderBy("slot", "desc")
                    .limit(40)
                    .get();
            } catch (e) {
                console.warn("Failed querying bookings by email:", e);
            }
        }

        const rowsMap = new Map(includeHistory ? state.studentBookingRows.map((row) => [row.id, row]) : []);

        if (snapUid) {
            snapUid.forEach((doc) => {
                const data = doc.data() || {};
                const existing = rowsMap.get(doc.id) || {};
                rowsMap.set(doc.id, { ...existing, id: doc.id, ...data });
            });
        }
        if (snapEmail) {
            snapEmail.forEach((doc) => {
                const data = doc.data() || {};
                const existing = rowsMap.get(doc.id) || {};
                rowsMap.set(doc.id, { ...existing, id: doc.id, ...data });
            });
        }

        if (includeHistory && !state.studentHistoryLoaded) {
            let historySnap = null;
            try {
                historySnap = await window.db.collection("bookings")
                    .where("studentUid", "==", state.currentUser.uid)
                    .where("slot", "<", recentCutoff)
                    .orderBy("slot", "desc")
                    .limit(160)
                    .get();
            } catch (error) {
                console.warn("Could not load older student booking history.", error);
            }
            historySnap?.forEach((doc) => rowsMap.set(doc.id, { id: doc.id, ...(doc.data() || {}) }));
            state.studentHistoryLoaded = true;
        }

        const rows = Array.from(rowsMap.values());
        rows.sort((a, b) => (b.slot || 0) - (a.slot || 0));
        state.studentBookingRows = rows;
        state.reservedPaidLessons = rows.filter(isUnchargedPaidBooking).length;
        updateStudentBalanceUi();
        await syncLessonFeedbackPrompt(rows);

        const now = Date.now();
        let upcomingBookings = rows.filter((b) => {
            const status = (b.status || "booked").toLowerCase();
            if (status === "canceled" || status === "completed") return false;
            return !isLessonHistorical(b, now);
        });

        // Update the upcoming lesson countdown banner
        renderUpcomingLessonBanner(rows);

        const takenBookings = rows.filter((b) => {
            const status = (b.status || "booked").toLowerCase();
            if (status === "canceled") return false;
            return status === "completed" || isLessonHistorical(b, now);
        });

        const canceledBookings = rows.filter((b) => {
            return (b.status || "booked").toLowerCase() === "canceled";
        });

        // Generate Upcoming HTML
        let upcomingHtml = "";
        if (!upcomingBookings.length) {
            upcomingHtml = `<div class="small-note" style="padding: 10px 0; text-align: center;">No upcoming lessons booked.</div>`;
        } else {
            upcomingHtml = upcomingBookings.map((b) => {
                const status = (b.status || "booked").toLowerCase();
                const label = status === "rescheduled" ? "Rescheduled" : "Booked";
                const canReschedule = Number(b.slot || 0) - Date.now() >= STUDENT_CHANGE_CUTOFF_MS;
                const isLateWindow = Number(b.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS;

                const deadlineMs = Number(b.slot || 0) - STUDENT_CHANGE_CUTOFF_MS;
                const formattedDeadline = formatSlotTime(deadlineMs);
                const msLeft = deadlineMs - Date.now();
                let deadlineText = "";
                let deadlineStyle = "";

                if (msLeft > 0) {
                    const hrsLeft = Math.floor(msLeft / 3600000);
                    const minsLeft = Math.floor((msLeft % 3600000) / 60000);
                    let timeLeftStr = "";
                    if (hrsLeft >= 24) {
                        const daysLeft = Math.floor(hrsLeft / 24);
                        const remainingHrs = hrsLeft % 24;
                        timeLeftStr = `${daysLeft}d ${remainingHrs}h left`;
                    } else {
                        timeLeftStr = `${hrsLeft}h ${minsLeft}m left`;
                    }
                    deadlineText = `Reschedule Deadline: <strong>${escapeHtml(formattedDeadline)}</strong> (${timeLeftStr} left to change without penalty)`;
                    deadlineStyle = "background-color: rgba(15, 118, 110, 0.08); border: 1px solid rgba(15, 118, 110, 0.22); color: var(--primary-dark); font-weight: 600;";
                } else {
                    deadlineText = `⚠️ Late cancellation window: Reschedule Deadline Passed on <strong>${escapeHtml(formattedDeadline)}</strong>. Free modification is locked.`;
                    deadlineStyle = "background-color: #fef2f2; border: 1px solid #fee2e2; color: #991b1b; font-weight: 500;";
                }

                const cutoffNote = `
                    <div class="reschedule-deadline-warning" style="margin-top: 8px; font-size: 0.78rem; border-radius: var(--radius-sm); padding: 8px 12px; display: flex; align-items: center; gap: 6px; ${deadlineStyle}">
                        <span style="line-height: 1.4;">${deadlineText}</span>
                    </div>
                `;
                const teacherNotice = b.studentNotice
                    ? `<div class="student-booking-notice"><strong>Schedule updated by teacher</strong><span>${escapeHtml(b.studentNotice)}</span></div>`
                    : "";

                return `
                    <div class="booking-status-item-card${b.source === "teacher" ? " is-private-lesson" : ""}" data-student-booking-id="${escapeHtml(b.id)}">
                        <div>
                            <strong style="font-size: 0.95rem; color: var(--ink);">${escapeHtml(formatSlotTime(b.slot))}</strong>
                            <div style="font-size: 0.8rem; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                                <span style="background: rgba(15, 118, 110, 0.12); color: var(--primary-dark); padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.72rem; border: 1px solid rgba(15, 118, 110, 0.2);">${escapeHtml(b.source === "teacher" ? "Private lesson" : label)}</span>
                            </div>
                        </div>
                        ${teacherNotice}
                        ${cutoffNote}
                        <div class="booking-item__actions" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                            <button class="btn btn--primary btn--small" data-student-action="classroom" data-student-booking-id="${escapeHtml(b.id)}">🎓 Enter Classroom</button>
                            <button class="btn btn--ghost btn--small" data-student-action="cancel">Cancel</button>
                            <button class="btn btn--outline btn--small" data-student-action="reschedule" ${canReschedule ? "" : "disabled"}>Reschedule</button>
                        </div>
                        <div class="booking-item__resched"></div>
                    </div>
                `;
            }).join("");
        }

        // Generate Taken HTML
        let takenHtml = "";
        if (!takenBookings.length) {
            takenHtml = `<div class="small-note" style="padding: 10px 0; text-align: center;">No completed lessons recorded yet.</div>`;
        } else {
            takenHtml = takenBookings.map((b) => {
                const isCompleted = b.status === "completed";
                const label = isCompleted ? "Completed & Attended" : "Taken";
                return `
                    <div class="booking-status-item-card" style="opacity: 0.85;">
                        <div>
                            <strong style="font-size: 0.9rem; color: var(--ink);">${escapeHtml(formatSlotTime(b.slot))}</strong>
                            <div style="font-size: 0.8rem; margin-top: 2px; display: flex; align-items: center; gap: 6px;">
                                <span style="background: #dcfce7; color: #15803d; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">${label}</span>
                                <span style="color: var(--muted); font-size: 0.75rem;">Lesson completed successfully</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");
        }

        // Generate Canceled HTML
        let canceledHtml = "";
        if (canceledBookings.length) {
            canceledHtml = canceledBookings.map((b) => {
                return `
                    <div class="booking-status-item-card" style="opacity: 0.65; background: #fafafa;">
                        <div>
                            <strong style="font-size: 0.9rem; color: var(--muted); text-decoration: line-through;">${escapeHtml(formatSlotTime(b.slot))}</strong>
                            <div style="font-size: 0.8rem; margin-top: 2px;">
                                <span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 0.72rem;">Canceled</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join("");
        }

        // Output collapsible HTML structure
        els.bookingStatusList.innerHTML = `
            <div class="booking-status-section">
                <div class="booking-section-header" id="upcomingSectionHeader">
                    <h4 class="booking-section-title">
                        <span>📅 Upcoming Lessons</span>
                        <span class="section-badge-count accent">${upcomingBookings.length}</span>
                    </h4>
                    <button class="btn-toggle-section" id="toggleUpcomingBtn">Hide ▲</button>
                </div>
                <div class="booking-section-content" id="upcomingSectionContent">
                    ${upcomingHtml}
                </div>
            </div>

            <div class="booking-status-section" style="margin-top: 16px;">
                <div class="booking-section-header" id="completedSectionHeader">
                    <h4 class="booking-section-title">
                        <span>🎓 Lessons You've Taken</span>
                        <span class="section-badge-count">${takenBookings.length}</span>
                    </h4>
                    <button class="btn-toggle-section" id="toggleCompletedBtn">Show ▼</button>
                </div>
                <div class="booking-section-content" id="completedSectionContent" style="display: none;">
                    ${takenHtml}
                    ${canceledBookings.length ? `
                        <div style="margin: 16px 0 8px 0; border-top: 1px dashed var(--line); padding-top: 12px; font-weight: 700; font-size: 0.85rem; color: var(--muted);">
                            ❌ Canceled Bookings History
                        </div>
                        ${canceledHtml}
                    ` : ""}
                </div>
            </div>
        `;

        const upContent = document.getElementById("upcomingSectionContent");
        const upToggleBtn = document.getElementById("toggleUpcomingBtn");
        const compContent = document.getElementById("completedSectionContent");
        const compToggleBtn = document.getElementById("toggleCompletedBtn");

        const toggleUpcoming = () => {
            if (upContent.style.display === "none") {
                upContent.style.display = "block";
                upToggleBtn.textContent = "Hide ▲";
            } else {
                upContent.style.display = "none";
                upToggleBtn.textContent = "Show ▼";
            }
        };

        const toggleCompleted = async () => {
            if (compContent.style.display === "none") {
                if (!state.studentHistoryLoaded) {
                    compToggleBtn.disabled = true;
                    compToggleBtn.textContent = "Loading...";
                    await loadStudentBookings({ includeHistory: true });
                    return;
                }
                compContent.style.display = "block";
                compToggleBtn.textContent = "Hide ▲";
            } else {
                compContent.style.display = "none";
                compToggleBtn.textContent = "Show ▼";
            }
        };

        document.getElementById("upcomingSectionHeader")?.addEventListener("click", (e) => {
            if (!e.target.closest("button") && !e.target.closest(".booking-item__actions")) {
                toggleUpcoming();
            }
        });
        upToggleBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleUpcoming();
        });

        document.getElementById("completedSectionHeader")?.addEventListener("click", (e) => {
            if (!e.target.closest("button") && !e.target.closest(".booking-item__actions")) {
                toggleCompleted().catch(console.error);
            }
        });
        compToggleBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleCompleted().catch(console.error);
        });

    } catch (error) {
        console.error("Could not load student bookings.", error);
        els.bookingStatusList.innerHTML = "<div class=\"small-note\">Unable to load your bookings right now.</div>";
    }
}

const LESSON_FEEDBACK_METRICS = [
    ["reassurance", "Reassurance", "&#9786;"],
    ["clarity", "Clarity"],
    ["progress", "Progress", "&#8635;"],
    ["preparation", "Preparation", "&#9998;"],
];

function getLessonEndMs(booking) {
    return getLessonEndAt(booking);
}

function renderLessonFeedbackStars() {
    document.querySelectorAll("[data-lesson-feedback-metric]").forEach((metricEl) => {
        const metric = metricEl.dataset.lessonFeedbackMetric;
        const starsEl = metricEl.querySelector(".lesson-feedback-stars");
        if (!metric || !starsEl) return;
        const selected = Number(state.lessonFeedbackRatings[metric] || 0);
        starsEl.innerHTML = Array.from({ length: 5 }, (_, index) => {
            const value = index + 1;
            const isSelected = value <= selected;
            return `<button type="button" class="lesson-feedback-star${isSelected ? " is-selected" : ""}" data-feedback-rating="${value}" data-feedback-metric="${escapeHtml(metric)}" aria-label="${value} out of 5" aria-pressed="${value === selected ? "true" : "false"}">${isSelected ? "&#9733;" : "&#9734;"}</button>`;
        }).join("");
    });
}

function hideLessonFeedbackCard() {
    if (!els.lessonFeedbackCard) return;
    els.lessonFeedbackCard.hidden = true;
    if (els.lessonFeedbackReminder && state.pendingLessonFeedbackBooking) {
        els.lessonFeedbackReminder.hidden = false;
    }
}

function openLessonFeedbackCard() {
    if (!els.lessonFeedbackCard || !state.pendingLessonFeedbackBooking) return;
    els.lessonFeedbackCard.hidden = false;
    if (els.lessonFeedbackReminder) els.lessonFeedbackReminder.hidden = true;
    window.setTimeout(() => {
        els.lessonFeedbackClose?.focus();
    }, 0);
}

async function syncLessonFeedbackPrompt(bookings) {
    if (!els.lessonFeedbackCard || !state.currentUser || state.currentRole !== "student" || !window.db) {
        hideLessonFeedbackCard();
        return;
    }
    const eligible = bookings
        .filter((booking) => {
            const status = String(booking.status || "booked").toLowerCase();
            return status !== "canceled" && getLessonEndMs(booking) <= Date.now();
        })
        .sort((a, b) => Number(b.slot || 0) - Number(a.slot || 0));

    for (const booking of eligible.slice(0, 12)) {
        const feedbackSnap = await window.db.collection("lessonFeedback").doc(booking.id).get();
        if (feedbackSnap.exists) continue;
        state.pendingLessonFeedbackBooking = booking;
        if (els.lessonFeedbackBookingId.value !== booking.id) {
            LESSON_FEEDBACK_METRICS.forEach(([key]) => {
                state.lessonFeedbackRatings[key] = 0;
            });
        }
        els.lessonFeedbackBookingId.value = booking.id;
        els.lessonFeedbackLessonLabel.textContent = `Rate your lesson from ${formatSlotTime(booking.slot)}. This does not publish a teacher review.`;
        renderLessonFeedbackStars();
        if (booking.id === state.lessonFeedbackDismissedBookingId) {
            els.lessonFeedbackCard.hidden = true;
            if (els.lessonFeedbackReminder) els.lessonFeedbackReminder.hidden = false;
        } else {
            openLessonFeedbackCard();
        }
        return;
    }
    state.pendingLessonFeedbackBooking = null;
    if (els.lessonFeedbackReminder) els.lessonFeedbackReminder.hidden = true;
    hideLessonFeedbackCard();
}

function buildLessonFeedbackSummary(feedbackRows) {
    const students = new Map();
    feedbackRows.forEach((row) => {
        const studentKey = String(row.studentUid || "").trim();
        if (!studentKey) return;
        if (!students.has(studentKey)) students.set(studentKey, []);
        students.get(studentKey).push(row);
    });
    const studentAverages = Array.from(students.values()).map((studentRows) => {
        const averages = {};
        LESSON_FEEDBACK_METRICS.forEach(([key]) => {
            averages[key] = studentRows.reduce(
                (sum, row) => sum + Number(row.ratings?.[key] || 0),
                0
            ) / studentRows.length;
        });
        return averages;
    });
    const realStudentCount = studentAverages.length;
    const studentCount = LESSON_FEEDBACK_BASELINE.studentCount + realStudentCount;
    const averages = {};
    LESSON_FEEDBACK_METRICS.forEach(([key]) => {
        const baselineTotal = Number(LESSON_FEEDBACK_BASELINE.averages[key] || 0)
            * LESSON_FEEDBACK_BASELINE.studentCount;
        const realStudentsTotal = studentAverages.reduce(
            (sum, studentAverage) => sum + Number(studentAverage[key] || 0),
            0
        );
        averages[key] = (baselineTotal + realStudentsTotal) / studentCount;
    });
    return {
        count: studentCount,
        studentCount,
        realStudentCount,
        lessonCount: feedbackRows.length,
        averages,
    };
}

function renderLessonFeedbackMetricCards(container, summary) {
    if (!container) return;
    const metricIcons = {
        reassurance: "&#9786;",
        clarity: "&#128172;",
        progress: "&#8635;",
        preparation: "&#9998;",
    };
    container.innerHTML = LESSON_FEEDBACK_METRICS.map(([key, label]) => `
        <div class="lesson-rating-metric">
            <div>
                <strong>${summary.count ? Number(summary.averages[key] || 0).toFixed(1) : "--"}</strong>
                <span>${escapeHtml(label)}</span>
            </div>
            <i aria-hidden="true">${metricIcons[key] || "&#9733;"}</i>
        </div>
    `).join("");
}

async function loadPublicLessonFeedbackSummary() {
    if (!window.db || !els.lessonRatingSummary) return;
    if (typeof state.lessonFeedbackSummaryUnsubscribe === "function") {
        state.lessonFeedbackSummaryUnsubscribe();
        state.lessonFeedbackSummaryUnsubscribe = null;
    }
    const renderSummary = (rawSummary = {}) => {
        const studentCount = Math.max(
            LESSON_FEEDBACK_BASELINE.studentCount,
            Number(rawSummary.studentCount || rawSummary.count || 0)
        );
        const averages = rawSummary.averages && studentCount > LESSON_FEEDBACK_BASELINE.studentCount
            ? { ...LESSON_FEEDBACK_BASELINE.averages, ...rawSummary.averages }
            : LESSON_FEEDBACK_BASELINE.averages;
        els.lessonRatingSummary.hidden = false;
        renderLessonFeedbackMetricCards(els.lessonRatingSummaryGrid, {
            count: studentCount,
            averages,
        });
        els.lessonRatingSummaryCount.textContent = `Based on ${studentCount} anonymous student review${studentCount === 1 ? "" : "s"}`;
    };
    renderSummary();
    try {
        const doc = await window.db.collection("lessonFeedbackSummary").doc("public").get();
        renderSummary(doc.exists ? (doc.data() || {}) : {});
    } catch (error) {
        console.warn("Could not load public lesson feedback summary.", error);
    }
}

async function refreshTeacherLessonFeedback(existingSnapshot = null) {
    if (!window.db || !state.teacherUser || state.teacherRole !== "teacher") return;
    const baselineSummary = buildLessonFeedbackSummary([]);
    if (els.teacherLessonFeedbackCount) {
        els.teacherLessonFeedbackCount.textContent = `${baselineSummary.studentCount} students · 0 new lesson ratings`;
    }
    renderLessonFeedbackMetricCards(els.teacherLessonFeedbackMetrics, baselineSummary);
    if (els.teacherLessonFeedbackComments) {
        els.teacherLessonFeedbackComments.innerHTML = `<p class="small-note">Loading private lesson comments...</p>`;
    }
    const snap = existingSnapshot || await window.db.collection("lessonFeedback").orderBy("createdAt", "desc").limit(100).get();
    const rows = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const summary = buildLessonFeedbackSummary(rows);
    await window.db.collection("lessonFeedbackSummary").doc("public").set({
        count: Math.round(summary.studentCount),
        studentCount: Math.round(summary.studentCount),
        lessonCount: Math.round(summary.lessonCount),
        baselineStudentCount: LESSON_FEEDBACK_BASELINE.studentCount,
        averages: summary.averages,
        updatedAt: Date.now(),
    }, { merge: true });
    if (els.teacherLessonFeedbackCount) {
        els.teacherLessonFeedbackCount.textContent = `${summary.studentCount} students · ${summary.lessonCount} new lesson rating${summary.lessonCount === 1 ? "" : "s"}`;
    }
    renderLessonFeedbackMetricCards(els.teacherLessonFeedbackMetrics, summary);
    if (els.teacherLessonFeedbackComments) {
        const comments = rows.filter((row) => String(row.comment || "").trim());
        els.teacherLessonFeedbackComments.innerHTML = comments.length
            ? comments.slice(0, 20).map((row) => `
                <article class="lesson-feedback-comment">
                    <strong>${escapeHtml(formatSlotTime(row.lessonSlot))}</strong>
                    <p>${escapeHtml(row.comment)}</p>
                </article>
            `).join("")
            : `<p class="small-note">No private lesson comments yet.</p>`;
    }
    state.teacherLessonFeedbackLoaded = true;
}

function stopTeacherLessonFeedbackListener() {
    if (typeof state.teacherLessonFeedbackUnsubscribe === "function") {
        state.teacherLessonFeedbackUnsubscribe();
    }
    state.teacherLessonFeedbackUnsubscribe = null;
    if (state.teacherLessonFeedbackRefreshTimer) {
        window.clearTimeout(state.teacherLessonFeedbackRefreshTimer);
        state.teacherLessonFeedbackRefreshTimer = null;
    }
}

function startTeacherLessonFeedbackListener() {
    stopTeacherLessonFeedbackListener();
    // Feedback is intentionally loaded once when the teacher opens Reviews.
    // It does not need a permanent listener on every teacher-dashboard tab.
}

function stopStudentBookingsListener() {
    if (typeof state.studentBookingsUnsubscribe === "function") {
        state.studentBookingsUnsubscribe();
    }
    state.studentBookingsUnsubscribe = null;
    state.studentBookingsFingerprint = "";
    if (state.studentBookingsRefreshTimer) window.clearTimeout(state.studentBookingsRefreshTimer);
    state.studentBookingsRefreshTimer = null;
}

function startStudentBookingsListener() {
    stopStudentBookingsListener();
    if (!window.db || !state.currentUser || state.currentRole !== "student") return;
    if (state.studentBookingsUid !== state.currentUser.uid) {
        state.studentBookingsUid = state.currentUser.uid;
        state.studentBookingRows = [];
        state.studentHistoryLoaded = false;
    }
    state.studentBookingsUnsubscribe = window.db.collection("bookings")
        .where("studentUid", "==", state.currentUser.uid)
        .where("slot", ">=", Date.now() - 60 * 24 * 60 * 60 * 1000)
        .orderBy("slot", "desc")
        .limit(40)
        .onSnapshot((snapshot) => {
            const fingerprint = snapshot.docs.map((doc) => {
                const booking = doc.data() || {};
                return [doc.id, booking.status, booking.slot, booking.durationMinutes, booking.meetingUrl,
                    booking.studentNotice, booking.consumptionState, booking.reservationState].join("|");
            }).sort().join("::");
            if (fingerprint === state.studentBookingsFingerprint) return;
            state.studentBookingsFingerprint = fingerprint;
            let reserved = 0;
            let pendingLateCancellations = 0;
            snapshot.forEach((doc) => {
                const booking = doc.data() || {};
                if (isUnchargedPaidBooking(booking)) reserved += 1;
                if (isChargeableLateCancellation(booking, STUDENT_CHANGE_CUTOFF_MS) && booking.lessonConsumed !== true && !booking.balanceChargedAt) {
                    pendingLateCancellations += 1;
                }
            });
            state.reservedPaidLessons = reserved;
            state.pendingLateCancellationCount = pendingLateCancellations;
            updateStudentAuthUi();
            if (state.studentBookingsRefreshTimer) window.clearTimeout(state.studentBookingsRefreshTimer);
            state.studentBookingsRefreshTimer = window.setTimeout(async () => {
                try {
                    await Promise.all([loadStudentBookings({ recentSnapshot: snapshot }), renderBookingCalendar()]);
                } catch (error) {
                    console.warn("Could not refresh student bookings after a live change.", error);
                }
            }, 250);
        }, (error) => console.warn("Could not watch student bookings.", error));
}

async function cancelStudentBooking(bookingId) {
    const snap = await window.db.collection("bookings").doc(bookingId).get();
    const booking = snap.data() || {};
    if (booking.studentUid !== state.currentUser?.uid) throw new Error("This booking does not belong to your account.");
    if (String(booking.status || "").toLowerCase() === "canceled") {
        return { calendarDeletePending: booking.calendarDeletePending === true, alreadyCanceled: true };
    }
    const isLateCancel = Number(booking.slot || 0) - Date.now() < STUDENT_CHANGE_CUTOFF_MS;
    const canceledAt = Date.now();
    const cancelBatch = window.db.batch();
    cancelBatch.set(window.db.collection("bookings").doc(bookingId), {
        status: "canceled",
        updatedAt: canceledAt,
        calendarSynced: false,
        calendarDeletePending: true,
        calendarSyncState: CALENDAR_SYNC_STATES.PENDING_DELETE,
        calendarNextRetryAt: canceledAt,
        calendarSyncLastError: "",
        canceledAt,
        canceledBy: "student",
        reservationState: booking.isFreeTrial === true ? "not-required" : (isLateCancel ? "pending-consumption" : "released"),
        history: window.firebase.firestore.FieldValue.arrayUnion({
            at: canceledAt,
            action: "canceled",
            by: "student",
            lateChargeApplies: isLateCancel,
        }),
    }, { merge: true });
    cancelBatch.set(window.db.collection("publicBookings").doc(bookingId), {
        status: "canceled",
        updatedAt: canceledAt,
        calendarSynced: false,
    }, { merge: true });
    await cancelBatch.commit();

    // Cleanup and notification delivery are deliberately separate from the core
    // cancellation. A stale legacy claim or notification permission must never
    // roll back a valid student cancellation.
    const cleanupBatch = window.db.batch();
    const slotClaimIds = Array.isArray(booking.slotClaimIds) && booking.slotClaimIds.length
        ? booking.slotClaimIds
        : (booking.bookingOperationId ? [getSlotClaimId(booking.slot)] : []);
    slotClaimIds.forEach((claimId) => cleanupBatch.delete(window.db.collection("bookingSlotClaims").doc(claimId)));
    if (booking.reservationClaimId) {
        if (!isLateCancel) cleanupBatch.delete(window.db.collection("lessonCreditClaims").doc(booking.reservationClaimId));
    } else if (booking.isFreeTrial !== true) {
        const claimSnap = await window.db.collection("lessonCreditClaims")
            .where("studentUid", "==", booking.studentUid)
            .where("bookingId", "==", bookingId)
            .limit(5)
            .get();
        if (!isLateCancel) claimSnap.forEach((doc) => cleanupBatch.delete(doc.ref));
    }
    if (booking.isFreeTrial === true && booking.studentUid) {
        cleanupBatch.set(window.db.collection("users").doc(booking.studentUid), {
            trialUsed: false,
            trialUsedAt: window.firebase.firestore.FieldValue.delete(),
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        cleanupBatch.delete(window.db.collection("trialClaims").doc(booking.studentUid));
    }
    await cleanupBatch.commit().catch((error) => console.warn("Cancellation cleanup will be retried by reconciliation.", error));
    try {
        const notificationBatch = window.db.batch();
        const cancellationJobs = createEventNotificationJobs(
            notificationBatch, bookingId, booking, "cancellation", canceledAt, "student",
            { notifyTeacher: true, notifyStudent: false }
        );
        notificationBatch.set(window.db.collection("bookings").doc(bookingId), notificationSummaryFields(cancellationJobs.teacherJob, cancellationJobs.studentJob, canceledAt), { merge: true });
        await notificationBatch.commit();
    } catch (error) {
        console.warn("Cancellation saved, but its notification job could not be queued.", error);
    }
    let calendarDeletePending = true;
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
        if (result?.success !== false || isAlreadyDeletedCalendarEvent(result)) {
            calendarDeletePending = false;
        }
    }
    if (!calendarDeletePending) {
        await window.db.collection("bookings").doc(bookingId).set({
            calendarDeletePending: false,
            calendarSyncState: CALENDAR_SYNC_STATES.EXTERNALLY_DELETED,
            calendarLastSyncedAt: Date.now(),
            calendarNextRetryAt: 0,
            updatedAt: Date.now(),
        }, { merge: true });
    }
    return { calendarDeletePending };
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
    const moveResult = await moveCalendarBooking(bookingId, booking, newSlot);
    const changedAt = Date.now();
    try {
        const batch = window.db.batch();
        batch.set(window.db.collection("bookings").doc(bookingId), {
            slot: newSlot,
            status: "rescheduled",
            updatedAt: changedAt,
            calendarSynced: moveResult.retryPending !== true,
            calendarSyncState: moveResult.retryPending === true ? CALENDAR_SYNC_STATES.PENDING_UPDATE : CALENDAR_SYNC_STATES.SYNCED,
            calendarLastSyncedAt: moveResult.retryPending === true ? Number(booking.calendarLastSyncedAt || 0) : changedAt,
            calendarLastCheckedAt: changedAt,
            calendarSyncLastError: moveResult.retryPending === true ? String(moveResult.message || "Calendar update pending.").slice(0, 1000) : "",
            calendarNextRetryAt: moveResult.retryPending === true ? changedAt : 0,
            googleCalendarEventId: moveResult.eventId || booking.googleCalendarEventId || null,
            meetingUrl: moveResult.meetingUrl || booking.meetingUrl || "",
            rescheduledFrom: booking.slot,
            rescheduledAt: changedAt,
            history: window.firebase.firestore.FieldValue.arrayUnion({
                at: changedAt,
                action: "rescheduled",
                by: "student",
                from: booking.slot,
                to: newSlot,
            }),
        }, { merge: true });
        batch.set(window.db.collection("publicBookings").doc(bookingId), {
            slot: newSlot,
            status: "rescheduled",
            updatedAt: changedAt,
            calendarSynced: moveResult.retryPending !== true,
            rescheduledFrom: booking.slot,
            rescheduledAt: changedAt,
        }, { merge: true });
        const notificationJobs = createEventNotificationJobs(batch, bookingId, booking, "reschedule", changedAt, "student");
        batch.set(window.db.collection("bookings").doc(bookingId), notificationSummaryFields(notificationJobs.teacherJob, notificationJobs.studentJob, changedAt), { merge: true });
        if (booking.bookingOperationId) {
            const oldClaimIds = Array.isArray(booking.slotClaimIds) && booking.slotClaimIds.length
                ? booking.slotClaimIds
                : [getSlotClaimId(booking.slot)];
            const newClaimIds = [
                getSlotClaimId(newSlot),
                ...getBookingIntervalClaimIds(newSlot, booking.durationMinutes || booking.slotMinutes || 50),
            ];
            oldClaimIds.filter((claimId) => !newClaimIds.includes(claimId))
                .forEach((claimId) => batch.delete(window.db.collection("bookingSlotClaims").doc(claimId)));
            newClaimIds.filter((claimId) => !oldClaimIds.includes(claimId))
                .forEach((claimId) => batch.set(window.db.collection("bookingSlotClaims").doc(claimId), {
                bookingId,
                studentUid: booking.studentUid,
                slot: newSlot,
                endAt: newSlot + Number(booking.durationMinutes || booking.slotMinutes || 50) * 60000,
                claimType: claimId.startsWith("interval_") ? "interval" : "anchor",
                createdAt: changedAt,
                }));
            batch.set(window.db.collection("bookings").doc(bookingId), {
                slotClaimIds: newClaimIds,
                consumeAfter: newSlot + Number(booking.durationMinutes || booking.slotMinutes || 50) * 60000,
            }, { merge: true });
        }
        await batch.commit();
    } catch (error) {
        const rolledBack = moveResult.retryPending === true
            ? true
            : await rollbackCalendarMove(bookingId, booking, newSlot, moveResult);
        if (!rolledBack) await markCalendarReconciliationNeeded(bookingId, error);
        throw error;
    }
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

async function moveCalendarBooking(bookingId, booking, newSlot, durationMinutes = 0) {
    if (typeof window.rescheduleBookingViaAppsScript !== "function") {
        throw new Error("Calendar rescheduling is not available.");
    }
    const result = await window.rescheduleBookingViaAppsScript({
        bookingId,
        eventId: booking.googleCalendarEventId || "",
        oldSlot: Number(booking.slot || 0),
        newSlot: Number(newSlot || 0),
        ...(durationMinutes ? { durationMinutes } : {}),
    });
    if (result?.success === false) {
        const message = normalizeAppsScriptStudentError(result, "Could not reschedule the Google Calendar event.");
        if (/no longer available|already (taken|booked)|occupied|conflict/i.test(String(result.message || message))) {
            throw new Error(message);
        }
        return { success: false, retryPending: true, message };
    }
    return result || { success: true };
}

async function resizeTeacherBooking(bookingId, booking, durationMinutes) {
    const oldDuration = Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50);
    const moveResult = await moveCalendarBooking(bookingId, booking, Number(booking.slot || 0), durationMinutes);
    try {
        await resizeBookingDuration({
            db: window.db,
            firebase: window.firebase,
            bookingId,
            booking,
            durationMinutes,
        });
        if (moveResult.retryPending === true) {
            const failedAt = Date.now();
            await window.db.collection("bookings").doc(bookingId).set({
                calendarSynced: false,
                calendarSyncState: CALENDAR_SYNC_STATES.PENDING_UPDATE,
                calendarSyncLastAttemptAt: failedAt,
                calendarNextRetryAt: failedAt,
                calendarSyncLastError: String(moveResult.message || "Calendar duration update pending.").slice(0, 1000),
                updatedAt: failedAt,
            }, { merge: true });
        }
    } catch (error) {
        if (moveResult.retryPending !== true) {
            await moveCalendarBooking(
                bookingId,
                { ...booking, googleCalendarEventId: moveResult.eventId || booking.googleCalendarEventId },
                Number(booking.slot || 0),
                oldDuration
            ).catch(console.error);
        }
        throw error;
    }
}

async function rollbackCalendarMove(bookingId, booking, movedSlot, moveResult) {
    if (typeof window.rescheduleBookingViaAppsScript !== "function") return false;
    try {
        const result = await window.rescheduleBookingViaAppsScript({
            bookingId,
            eventId: moveResult?.eventId || booking.googleCalendarEventId || "",
            oldSlot: Number(movedSlot || 0),
            newSlot: Number(booking.slot || 0),
        });
        return result?.success !== false;
    } catch (rollbackError) {
        console.error("Could not roll back Google Calendar reschedule.", rollbackError);
        return false;
    }
}

async function markCalendarReconciliationNeeded(bookingId, error) {
    const failedAt = Date.now();
    await window.db.collection("bookings").doc(bookingId).set({
        calendarSyncState: CALENDAR_SYNC_STATES.EXTERNALLY_MODIFIED,
        calendarSynced: false,
        calendarSyncLastAttemptAt: failedAt,
        calendarNextRetryAt: failedAt,
        calendarSyncLastError: String(error?.message || error || "Calendar and Firestore update diverged.").slice(0, 1000),
        updatedAt: failedAt,
    }, { merge: true }).catch((metadataError) => console.error("Could not mark Calendar reconciliation state.", metadataError));
}

async function rescheduleTeacherBooking(bookingId, booking, newSlot) {
    const conflict = await findTeacherLessonConflict(
        newSlot,
        Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50),
        bookingId
    );
    if (conflict) throw new Error("Another student lesson already occupies that time.");
    const moveResult = await moveCalendarBooking(bookingId, booking, newSlot);
    try {
        await rescheduleBooking({
            db: window.db,
            firebase: window.firebase,
            bookingId,
            booking,
            newSlot,
            calendarSynced: moveResult.retryPending !== true,
            googleCalendarEventId: moveResult.eventId || booking.googleCalendarEventId || null,
            meetingUrl: moveResult.meetingUrl || booking.meetingUrl || "",
            teacherEmail: state.contactSettings?.email || "",
        });
    } catch (error) {
        const rolledBack = moveResult.retryPending === true
            ? true
            : await rollbackCalendarMove(bookingId, booking, newSlot, moveResult);
        if (!rolledBack) await markCalendarReconciliationNeeded(bookingId, error);
        throw error;
    }
    return moveResult;
}

async function findTeacherLessonConflict(slot, durationMinutes, excludeBookingId = null) {
    const booked = await getBookedSlotsMap(
        slot,
        slot + durationMinutes * 60000,
        bookingDeps()
    );
    const end = slot + durationMinutes * 60000;
    return Array.from(booked.values()).find((booking) => (
        booking.id !== excludeBookingId
        && slot < Number(booking.end || 0)
        && end > Number(booking.start || 0)
    )) || null;
}

function offerTeacherCalendarUndo(bookingId, previousSlot) {
    document.getElementById("teacherCalendarUndo")?.remove();
    const undo = document.createElement("div");
    undo.id = "teacherCalendarUndo";
    undo.className = "teacher-calendar-undo";
    undo.innerHTML = `
        <span>Lesson moved successfully.</span>
        <button type="button">Undo</button>
        <i aria-hidden="true"></i>
    `;
    document.body.appendChild(undo);
    const removeUndo = () => undo.remove();
    const timeoutId = window.setTimeout(removeUndo, 10000);
    undo.querySelector("button")?.addEventListener("click", async () => {
        window.clearTimeout(timeoutId);
        const currentBooking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (!currentBooking) {
            removeUndo();
            return;
        }
        try {
            undo.classList.add("is-working");
            await rescheduleTeacherBooking(bookingId, currentBooking, previousSlot);
            await refreshRuntimeBusyBlocks({ force: true });
            await refreshTeacherBookings();
            await renderBookingCalendar();
            setStatus(els.teacherBookingMsg, "Lesson move undone.", "success");
        } catch (error) {
            setStatus(els.teacherBookingMsg, error.message || "Could not undo the move.", "error");
        } finally {
            removeUndo();
        }
    });
}

function showTeacherBookingDetails(bookingId, booking) {
    document.getElementById("teacherCalendarDetailsModal")?.remove();
    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const studentTimezone = booking.studentTimeZone || getDisplayTimezone();
    const modal = document.createElement("div");
    modal.id = "teacherCalendarDetailsModal";
    modal.className = "teacher-calendar-details-modal";
    modal.innerHTML = `
        <div class="teacher-calendar-details-card" role="dialog" aria-modal="true" aria-labelledby="teacherCalendarDetailsTitle">
            <button type="button" class="teacher-calendar-details-close" aria-label="Close">&times;</button>
            <span class="teacher-calendar-details-kicker">${booking.isFreeTrial ? "Trial lesson" : "Student lesson"}</span>
            <h3 id="teacherCalendarDetailsTitle">${escapeHtml(booking.name || "Student")}</h3>
            <dl>
                <div><dt>Teacher time</dt><dd>${escapeHtml(new Date(booking.slot).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: timezone }))}</dd></div>
                <div><dt>Student time</dt><dd>${escapeHtml(new Date(booking.slot).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: studentTimezone }))}</dd></div>
                <div><dt>Email</dt><dd>${escapeHtml(booking.email || "Not provided")}</dd></div>
                <div><dt>Phone</dt><dd>${escapeHtml(booking.phone || "Not provided")}</dd></div>
            </dl>
            <div class="action-row">
                <button type="button" class="btn btn--primary" data-details-action="reschedule">Reschedule</button>
                <button type="button" class="btn btn--outline" data-details-action="repeat">Repeat weekly</button>
                <button type="button" class="btn btn--outline" data-details-action="close">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.addEventListener("click", async (event) => {
        if (event.target === modal || event.target.closest(".teacher-calendar-details-close") || event.target.closest("[data-details-action='close']")) {
            close();
            return;
        }
        if (event.target.closest("[data-details-action='reschedule']")) {
            close();
            await openRescheduleModal({
                role: "teacher",
                bookingId,
                booking: { ...booking, id: bookingId },
                allowCustom: true,
            });
            return;
        }
        if (event.target.closest("[data-details-action='repeat']")) {
            const requestedCount = Number(window.prompt("How many additional weekly lessons? Enter 1–12.", "4"));
            if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 12) return;
            close();
            try {
                setAppLoading(true, "Creating weekly lessons...");
                const result = await createWeeklyRecurringLessons(booking, requestedCount);
                await refreshRuntimeBusyBlocks({ force: true });
                await refreshTeacherBookings();
                await renderBookingCalendar();
                setStatus(
                    els.teacherBookingMsg,
                    `Created ${result.createdCount} weekly lesson${result.createdCount === 1 ? "" : "s"}.`,
                    "success"
                );
            } catch (error) {
                setStatus(els.teacherBookingMsg, error.message || "Could not create recurring lessons.", "error");
            } finally {
                setAppLoading(false);
            }
        }
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
        els.rescheduleWeekLabel.textContent = formatWeekRangeLabel(offset, startKey, endKey);
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
            ? "Teacher access: choose a suggested time or enter any free future date and time, including within 12 hours."
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
        durationMinutes: booking.durationMinutes || booking.slotMinutes || state.bookingSettings.slotMinutes || 50,
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

function getWeeklyRecurringSlot(slot, weekNumber, timezone) {
    const parts = getZonedParts(new Date(slot), timezone);
    const dateKey = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
    const recurringDateKey = addDaysToDateKey(dateKey, weekNumber * 7);
    const [year, month, day] = recurringDateKey.split("-").map(Number);
    return zonedDateTimeToUtcMs(timezone, year, month, day, parts.hour, parts.minute);
}

async function commitTeacherBookingWithClaims(bookingRef, bookingData, publicBookingData) {
    const slot = Number(bookingData.slot || 0);
    const durationMinutes = Number(bookingData.durationMinutes || bookingData.slotMinutes || 50);
    const claimIds = [getSlotClaimId(slot), ...getBookingIntervalClaimIds(slot, durationMinutes)];
    const legacyReservationSnap = bookingData.studentUid
        ? await window.db.collection("bookings").where("studentUid", "==", bookingData.studentUid).limit(200).get()
        : null;
    const legacyReservations = legacyReservationSnap
        ? legacyReservationSnap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
            .filter((booking) => isUnchargedPaidBooking(booking) && !booking.reservationClaimId)
            .sort((a, b) => Number(a.createdAt || a.slot || 0) - Number(b.createdAt || b.slot || 0))
        : [];
    await window.db.runTransaction(async (transaction) => {
        const userRef = window.db.collection("users").doc(bookingData.studentUid || "missing-student");
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) throw new Error("Student account was not found.");
        const claimRefs = claimIds.map((id) => window.db.collection("bookingSlotClaims").doc(id));
        const claimSnaps = [];
        for (const ref of claimRefs) claimSnaps.push(await transaction.get(ref));
        if (claimSnaps.some((snap) => snap.exists)) {
            throw new Error("That time overlaps another platform lesson.");
        }
        const student = userSnap.data() || {};
        const allowOverdraft = student.allowOverdraft === true;
        const totalCredits = Math.min(500, Math.max(0, Math.floor(Number(student.lessonCredits || 0))));
        let reservationClaimRef = null;
        let reservedCreditUnit = 0;
        if (!allowOverdraft) {
            const creditRefs = Array.from({ length: totalCredits }, (_, index) => (
                window.db.collection("lessonCreditClaims").doc(getCreditClaimId(bookingData.studentUid, index + 1))
            ));
            const creditSnaps = [];
            for (const ref of creditRefs) creditSnaps.push(await transaction.get(ref));
            const occupiedUnits = new Set();
            creditSnaps.forEach((snap, index) => { if (snap.exists) occupiedUnits.add(index + 1); });
            legacyReservations.forEach((legacyBooking) => {
                const alreadyClaimed = creditSnaps.some((snap) => snap.exists && snap.data()?.bookingId === legacyBooking.id);
                if (alreadyClaimed) return;
                const legacyIndex = creditRefs.findIndex((ref, index) => !occupiedUnits.has(index + 1));
                if (legacyIndex < 0) return;
                const legacyUnit = legacyIndex + 1;
                occupiedUnits.add(legacyUnit);
                transaction.set(creditRefs[legacyIndex], {
                    bookingId: legacyBooking.id,
                    studentUid: bookingData.studentUid,
                    unit: legacyUnit,
                    slot: Number(legacyBooking.slot || 0),
                    state: "reserved",
                    source: "teacher-legacy-repair",
                    migratedFromLegacy: true,
                    createdAt: Number(legacyBooking.createdAt || Date.now()),
                });
            });
            const freeIndex = creditRefs.findIndex((ref, index) => !occupiedUnits.has(index + 1));
            if (freeIndex < 0) throw new Error("This student has no available lesson credit.");
            reservationClaimRef = creditRefs[freeIndex];
            reservedCreditUnit = freeIndex + 1;
        }
        const now = Date.now();
        const safeBooking = {
            ...bookingData,
            slotClaimIds: claimIds,
            consumeAfter: slot + durationMinutes * 60000,
            reservationState: allowOverdraft ? "overdraft" : "active",
            reservationClaimId: reservationClaimRef?.id || "",
            reservedCreditUnit,
            ...buildPendingCalendarState("create", bookingData, now),
        };
        const notificationJobs = createBookingNotificationJobs(transaction, bookingRef.id, safeBooking, { notifyTeacher: false });
        Object.assign(safeBooking, notificationSummaryFields(notificationJobs.teacherJob, notificationJobs.studentJob, safeBooking.createdAt || now));
        transaction.set(bookingRef, safeBooking);
        transaction.set(window.db.collection("publicBookings").doc(bookingRef.id), {
            ...publicBookingData,
            calendarSynced: false,
        });
        claimRefs.forEach((claimRef) => transaction.set(claimRef, {
            bookingId: bookingRef.id,
            studentUid: bookingData.studentUid || "",
            slot,
            endAt: slot + durationMinutes * 60000,
            claimType: claimRef.id.startsWith("interval_") ? "interval" : "anchor",
            createdAt: now,
        }));
        if (reservationClaimRef) {
            transaction.set(reservationClaimRef, {
                bookingId: bookingRef.id,
                studentUid: bookingData.studentUid,
                unit: reservedCreditUnit,
                slot,
                state: "reserved",
                source: "teacher",
                createdAt: now,
            });
        }
    });
}

async function createWeeklyRecurringLessons(booking, additionalCount) {
    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const durationMinutes = Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50);
    const candidateSlots = [];
    for (let index = 1; index <= additionalCount; index += 1) {
        const slot = getWeeklyRecurringSlot(Number(booking.slot || 0), index, timezone);
        const conflict = await findTeacherLessonConflict(slot, durationMinutes);
        if (conflict) throw new Error(`Week ${index} overlaps another student lesson.`);
        candidateSlots.push(slot);
    }

    let createdCount = 0;
    for (const slot of candidateSlots) {
        const bookingRef = window.db.collection("bookings").doc();
        const createdAt = Date.now();
        const recurringBooking = {
            slot,
            durationMinutes,
            name: booking.name || "Student",
            email: booking.email || "",
            phone: booking.phone || "",
            notes: booking.notes || "",
            status: "booked",
            createdAt,
            updatedAt: createdAt,
            calendarSynced: false,
            googleCalendarEventId: "",
            meetingUrl: "",
            source: "teacher",
            reason: booking.reason || "",
            reasonLabels: Array.isArray(booking.reasonLabels) ? booking.reasonLabels : [],
            level: booking.level || "",
            lessonsPerMonth: booking.lessonsPerMonth || "",
            studentTimeZone: booking.studentTimeZone || getDisplayTimezone(),
            studentLocale: booking.studentLocale || "",
            countryHint: booking.countryHint || "",
            studentUid: booking.studentUid || "",
            timezone,
            isFreeTrial: false,
            history: [{
                at: createdAt,
                action: "created_recurring",
                by: "teacher",
            }],
        };
        const publicBooking = {
            slot,
            durationMinutes,
            status: "booked",
            createdAt,
            updatedAt: createdAt,
            calendarSynced: false,
            source: "teacher",
        };
        await commitTeacherBookingWithClaims(bookingRef, recurringBooking, publicBooking);

        const calendarResult = await createCalendarEventForBooking(bookingRef.id, recurringBooking, slot);
        if (calendarResult?.success === false) {
            const isCalendarConflict = /occupied|available|conflict/i.test(calendarResult.message || "");
            if (!isCalendarConflict) {
                const failedAt = Date.now();
                await bookingRef.set({
                    calendarSyncState: CALENDAR_SYNC_STATES.PENDING_CREATE,
                    calendarSyncAttempts: 1,
                    calendarSyncLastAttemptAt: failedAt,
                    calendarNextRetryAt: failedAt + 2 * 60000,
                    calendarSyncLastError: String(calendarResult.message || "Calendar backend unavailable.").slice(0, 1000),
                    updatedAt: failedAt,
                }, { merge: true });
                createdCount += 1;
                continue;
            }
            const canceledAt = Date.now();
            const cancelBatch = window.db.batch();
            cancelBatch.set(bookingRef, {
                status: "canceled",
                updatedAt: canceledAt,
                calendarSynced: false,
                calendarSyncState: CALENDAR_SYNC_STATES.CONFLICT,
                canceledAt,
                canceledBy: "teacher",
            }, { merge: true });
            cancelBatch.set(window.db.collection("publicBookings").doc(bookingRef.id), {
                status: "canceled",
                updatedAt: canceledAt,
                calendarSynced: false,
            }, { merge: true });
            const failedClaimIds = [getSlotClaimId(slot), ...getBookingIntervalClaimIds(slot, durationMinutes)];
            failedClaimIds.forEach((claimId) => cancelBatch.delete(window.db.collection("bookingSlotClaims").doc(claimId)));
            await cancelBatch.commit();
            throw new Error(calendarResult.message || "Google Calendar rejected a recurring lesson.");
        }
        await bookingRef.set({
            calendarSynced: true,
            calendarSyncState: CALENDAR_SYNC_STATES.SYNCED,
            calendarLastSyncedAt: Date.now(),
            calendarLastCheckedAt: Date.now(),
            calendarNextRetryAt: 0,
            calendarSyncLastError: "",
            googleCalendarEventId: calendarResult.eventId || "",
            meetingUrl: calendarResult.meetingUrl || "",
            updatedAt: Date.now(),
        }, { merge: true });
        await window.db.collection("publicBookings").doc(bookingRef.id).set({
            calendarSynced: true,
            updatedAt: Date.now(),
        }, { merge: true });
        createdCount += 1;
    }
    return { createdCount };
}

async function createTeacherLessonForStudent(student, slot, durationMinutes) {
    const email = String(student.email || "").trim();
    const studentUid = student.uid || student.id || student.studentUid || "";
    if (!email || !studentUid) {
        throw new Error("The selected student needs a valid account and email.");
    }
    const conflict = await findTeacherLessonConflict(slot, durationMinutes);
    if (conflict) throw new Error("Another student lesson already occupies that time.");
    const bookingRef = window.db.collection("bookings").doc();
    const createdAt = Date.now();
    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const bookingData = {
        slot,
        durationMinutes,
        name: student.name || student.displayName || email,
        email,
        phone: student.phone || "",
        notes: "Scheduled directly by the teacher.",
        status: "booked",
        createdAt,
        updatedAt: createdAt,
        calendarSynced: false,
        googleCalendarEventId: "",
        meetingUrl: "",
        source: "teacher",
        reason: "Teacher scheduled lesson",
        reasonLabels: ["Teacher scheduled"],
        level: student.level || "",
        lessonsPerMonth: student.lessonsPerMonth || "",
        studentTimeZone: student.timezone || student.studentTimeZone || getDisplayTimezone(),
        studentLocale: student.locale || "",
        countryHint: student.country || "",
        studentUid,
        timezone,
        isFreeTrial: false,
        history: [{
            at: createdAt,
            action: "created_by_teacher",
            by: "teacher",
        }],
    };
    const publicBookingData = {
        slot,
        durationMinutes,
        status: "booked",
        createdAt,
        updatedAt: createdAt,
        calendarSynced: false,
        source: "teacher",
    };
    await commitTeacherBookingWithClaims(bookingRef, bookingData, publicBookingData);

    const calendarResult = await createCalendarEventForBooking(bookingRef.id, bookingData, slot);
    if (calendarResult?.success === false) {
        const isCalendarConflict = /occupied|available|conflict/i.test(calendarResult.message || "");
        if (!isCalendarConflict) {
            const failedAt = Date.now();
            await bookingRef.set({
                calendarSyncState: CALENDAR_SYNC_STATES.PENDING_CREATE,
                calendarSyncAttempts: 1,
                calendarSyncLastAttemptAt: failedAt,
                calendarNextRetryAt: failedAt + 2 * 60000,
                calendarSyncLastError: String(calendarResult.message || "Calendar backend unavailable.").slice(0, 1000),
                updatedAt: failedAt,
            }, { merge: true });
            return { bookingId: bookingRef.id, calendarPending: true };
        }
        const canceledAt = Date.now();
        const cancelBatch = window.db.batch();
        cancelBatch.set(bookingRef, {
            status: "canceled",
            updatedAt: canceledAt,
            calendarSyncState: CALENDAR_SYNC_STATES.CONFLICT,
            canceledAt,
            canceledBy: "teacher",
        }, { merge: true });
        cancelBatch.set(window.db.collection("publicBookings").doc(bookingRef.id), {
            status: "canceled",
            updatedAt: canceledAt,
        }, { merge: true });
        const failedClaimIds = [getSlotClaimId(slot), ...getBookingIntervalClaimIds(slot, durationMinutes)];
        failedClaimIds.forEach((claimId) => cancelBatch.delete(window.db.collection("bookingSlotClaims").doc(claimId)));
        await cancelBatch.commit();
        throw new Error(calendarResult.message || "Google Calendar rejected the lesson.");
    }
    const syncedAt = Date.now();
    const syncBatch = window.db.batch();
    syncBatch.set(bookingRef, {
        calendarSynced: true,
        calendarSyncState: CALENDAR_SYNC_STATES.SYNCED,
        calendarLastSyncedAt: syncedAt,
        calendarLastCheckedAt: syncedAt,
        calendarNextRetryAt: 0,
        calendarSyncLastError: "",
        googleCalendarEventId: calendarResult.eventId || "",
        meetingUrl: calendarResult.meetingUrl || "",
        updatedAt: syncedAt,
    }, { merge: true });
    syncBatch.set(window.db.collection("publicBookings").doc(bookingRef.id), {
        calendarSynced: true,
        updatedAt: syncedAt,
    }, { merge: true });
    await syncBatch.commit();
    return { bookingId: bookingRef.id };
}

function getTeacherSchedulingStudents() {
    const byId = new Map();
    const students = Array.isArray(state.studentsCache) ? state.studentsCache : [];
    students.forEach((student) => {
        const id = student.id || student.uid || student.studentUid;
        if (id) byId.set(id, { ...student, id });
    });
    if (state.studentCache instanceof Map) {
        state.studentCache.forEach((student, id) => {
            byId.set(id, { ...(byId.get(id) || {}), ...student, id });
        });
    }
    return Array.from(byId.values()).sort((a, b) => (
        String(a.name || a.email || "").localeCompare(String(b.name || b.email || ""))
    ));
}

function openTeacherCalendarCreateModal(slot, { column = null, details = null } = {}) {
    document.getElementById("teacherCalendarCreateModal")?.remove();
    const students = getTeacherSchedulingStudents();
    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const defaultDuration = Number(state.bookingSettings?.slotMinutes || 50);
    const dateKey = getDateKey(new Date(slot), timezone);
    const formatInputTime = (value) => new Date(value).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
    });
    const startTime = formatInputTime(slot);
    const endTime = formatInputTime(slot + 60 * 60000);
    let selectionPreview = showTeacherCalendarSelectionPreview(
        column,
        details || getTeacherCalendarDropDetails(column, 0, { durationMinutes: defaultDuration }),
        "New student lesson"
    );
    const modal = document.createElement("div");
    modal.id = "teacherCalendarCreateModal";
    modal.className = "teacher-calendar-details-modal teacher-calendar-create-modal";
    modal.innerHTML = `
        <form class="teacher-calendar-details-card teacher-calendar-create-card">
            <button type="button" class="teacher-calendar-details-close" aria-label="Close">&times;</button>
            <span class="teacher-calendar-details-kicker" data-create-kicker>Student lesson</span>
            <h3>${escapeHtml(new Date(slot).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: timezone }))}</h3>
            <label class="field">
                <span>What do you want to add?</span>
                <select name="entryType">
                    <option value="lesson">Student lesson</option>
                    <option value="busy">Busy time</option>
                </select>
            </label>
            <label class="field" data-create-student-field>
                <span>Student</span>
                <select name="studentId" required>
                    <option value="">Choose a student</option>
                    ${students.map((student) => `<option value="${escapeHtml(student.id)}">${escapeHtml(student.name || student.email || "Student")} · ${escapeHtml(student.email || "")}</option>`).join("")}
                </select>
            </label>
            <label class="field" data-create-busy-field hidden>
                <span data-create-label-text>Busy label</span>
                <input name="busyTitle" maxlength="120" value="Busy" />
            </label>
            <label class="field" data-create-duration-field>
                <span>Lesson duration</span>
                <select name="durationMinutes">
                    ${[30, 45, 50, 60, 75, 90, 120].map((minutes) => `<option value="${minutes}" ${minutes === defaultDuration ? "selected" : ""}>${minutes} minutes</option>`).join("")}
                </select>
            </label>
            <div class="inline-fields" data-create-busy-time-fields hidden>
                <label class="field">
                    <span>Busy from</span>
                    <input name="busyStart" type="time" step="300" value="${startTime}" />
                </label>
                <label class="field">
                    <span>Busy until</span>
                    <input name="busyEnd" type="time" step="300" value="${endTime}" />
                </label>
            </div>
            <p class="status-line" data-create-status></p>
            <div class="action-row">
                <button type="submit" class="btn btn--primary">Add to calendar</button>
                <button type="button" class="btn btn--outline" data-create-close>Cancel</button>
            </div>
        </form>
    `;
    document.body.appendChild(modal);
    const form = modal.querySelector("form");
    const typeSelect = form.querySelector("[name='entryType']");
    const studentField = form.querySelector("[data-create-student-field]");
    const busyField = form.querySelector("[data-create-busy-field]");
    const durationField = form.querySelector("[data-create-duration-field]");
    const busyTimeFields = form.querySelector("[data-create-busy-time-fields]");
    const kicker = form.querySelector("[data-create-kicker]");
    const close = () => {
        clearTeacherCalendarSelectionPreview();
        modal.remove();
    };
    const getBusyRange = () => {
        const [year, month, day] = dateKey.split("-").map(Number);
        const [startHour, startMinute] = String(form.elements.busyStart.value || "").split(":").map(Number);
        const [endHour, endMinute] = String(form.elements.busyEnd.value || "").split(":").map(Number);
        if (![startHour, startMinute, endHour, endMinute].every(Number.isFinite)) return null;
        const busySlot = zonedDateTimeToUtcMs(timezone, year, month, day, startHour, startMinute);
        const busyEnd = zonedDateTimeToUtcMs(timezone, year, month, day, endHour, endMinute);
        if (busyEnd <= busySlot) return null;
        return {
            slot: busySlot,
            durationMinutes: Math.round((busyEnd - busySlot) / 60000),
            top: startHour * 60 + startMinute - Number(column?.dataset.calendarStartHour || 8) * 60,
            height: Math.round((busyEnd - busySlot) / 60000),
        };
    };
    const updateSelectionPreview = () => {
        if (!column) return;
        const isBusy = typeSelect.value === "busy";
        let previewDetails;
        let label;
        if (isBusy) {
            previewDetails = getBusyRange();
            label = form.elements.busyTitle.value.trim() || "Busy";
        } else {
            const durationMinutes = Number(form.elements.durationMinutes.value || defaultDuration);
            previewDetails = {
                ...(details || {}),
                slot,
                height: durationMinutes,
            };
            const selectedStudent = students.find((item) => item.id === form.elements.studentId.value);
            label = selectedStudent
                ? `Lesson with ${selectedStudent.name || selectedStudent.email || "student"}`
                : "New student lesson";
        }
        if (!previewDetails) {
            clearTeacherCalendarSelectionPreview();
            selectionPreview = null;
            return;
        }
        selectionPreview = showTeacherCalendarSelectionPreview(column, previewDetails, label);
    };
    const syncType = () => {
        const isBusy = typeSelect.value === "busy";
        studentField.hidden = isBusy;
        busyField.hidden = !isBusy;
        durationField.hidden = isBusy;
        busyTimeFields.hidden = !isBusy;
        studentField.style.display = isBusy ? "none" : "";
        busyField.style.display = isBusy ? "" : "none";
        durationField.style.display = isBusy ? "none" : "";
        busyTimeFields.style.display = isBusy ? "grid" : "none";
        kicker.textContent = isBusy ? "Busy time" : "Student lesson";
        form.querySelector("[name='studentId']").required = !isBusy;
        updateSelectionPreview();
    };
    typeSelect.addEventListener("change", syncType);
    form.elements.studentId.addEventListener("change", updateSelectionPreview);
    form.elements.durationMinutes.addEventListener("change", updateSelectionPreview);
    form.elements.busyTitle.addEventListener("input", updateSelectionPreview);
    form.elements.busyStart.addEventListener("input", updateSelectionPreview);
    form.elements.busyEnd.addEventListener("input", updateSelectionPreview);
    modal.addEventListener("click", (event) => {
        if (event.target === modal || event.target.closest(".teacher-calendar-details-close") || event.target.closest("[data-create-close]")) close();
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = event.submitter;
        const busyRange = typeSelect.value === "busy" ? getBusyRange() : null;
        const selectedSlot = busyRange?.slot || slot;
        const durationMinutes = busyRange?.durationMinutes || Number(form.elements.durationMinutes.value || defaultDuration);
        try {
            await withButtonLoading(submitButton, "Adding...", async () => {
                if (typeSelect.value === "busy") {
                    if (!busyRange) throw new Error("Choose a valid busy start and end time.");
                    const result = await window.createBusyBlockViaAppsScript?.({
                        slot: selectedSlot,
                        durationMinutes,
                        title: form.elements.busyTitle.value || "Busy",
                    });
                    if (!result?.success) throw new Error(result?.message || "Could not add busy time.");
                } else {
                    const student = students.find((item) => item.id === form.elements.studentId.value);
                    if (!student) throw new Error("Choose a student first.");
                    await createTeacherLessonForStudent(student, selectedSlot, durationMinutes);
                }
                await refreshRuntimeBusyBlocks({ force: true });
                await refreshTeacherBookings();
                await renderBookingCalendar();
            });
            setStatus(
                els.teacherBookingMsg,
                typeSelect.value === "busy"
                    ? "Busy time added to Google Calendar and student availability."
                    : "Lesson created in the student schedule and Google Calendar.",
                "success"
            );
            close();
        } catch (error) {
            setStatus(form.querySelector("[data-create-status]"), error.message || "Could not add the calendar entry.", "error");
        }
    });
    syncType();
}

let currentClassroomBooking = null;
let classroomTimerInterval = null;
let classroomTimeRemaining = 50 * 60;
let classroomTimerRunning = false;
let wbCanvas = null;
let wbCtx = null;
let wbIsDrawing = false;
let wbCurrentColor = "#0f172a";
let wbCurrentTool = "pen"; // "pen", "highlighter", "eraser"
let wbUnsubscribe = null;

function initWhiteboard() {
    wbCanvas = document.getElementById("classroomWhiteboard");
    if (!wbCanvas) return;
    wbCtx = wbCanvas.getContext("2d");

    // Resize canvas to match display size
    const rect = wbCanvas.parentElement.getBoundingClientRect();
    wbCanvas.width = rect.width || 400;
    wbCanvas.height = rect.height || 300;

    wbCtx.lineCap = "round";
    wbCtx.lineJoin = "round";

    function getCoords(e) {
        const r = wbCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - r.left,
            y: clientY - r.top
        };
    }

    function startDraw(e) {
        wbIsDrawing = true;
        const coords = getCoords(e);
        wbCtx.beginPath();
        wbCtx.moveTo(coords.x, coords.y);
    }

    function draw(e) {
        if (!wbIsDrawing) return;
        e.preventDefault();
        const coords = getCoords(e);

        if (wbCurrentTool === "eraser") {
            wbCtx.strokeStyle = "#ffffff";
            wbCtx.lineWidth = 20;
        } else if (wbCurrentTool === "highlighter") {
            wbCtx.strokeStyle = "rgba(254, 240, 138, 0.4)";
            wbCtx.lineWidth = 18;
        } else {
            wbCtx.strokeStyle = wbCurrentColor;
            wbCtx.lineWidth = 3;
        }

        wbCtx.lineTo(coords.x, coords.y);
        wbCtx.stroke();
    }

    function stopDraw() {
        if (!wbIsDrawing) return;
        wbIsDrawing = false;
        wbCtx.closePath();
        saveWhiteboardToCloud();
    }

    wbCanvas.onmousedown = startDraw;
    wbCanvas.onmousemove = draw;
    wbCanvas.onmouseup = stopDraw;
    wbCanvas.onmouseleave = stopDraw;

    wbCanvas.ontouchstart = startDraw;
    wbCanvas.ontouchmove = draw;
    wbCanvas.ontouchend = stopDraw;
}

function clearWhiteboard() {
    if (!wbCtx || !wbCanvas) return;
    wbCtx.clearRect(0, 0, wbCanvas.width, wbCanvas.height);
    saveWhiteboardToCloud();
}

async function saveWhiteboardToCloud() {
    // The built-in board is retired; lessons open directly in Google Meet.
    return;
}

function listenWhiteboardFromCloud(bookingId) {
    // No Firestore listener is created for the retired classroom board.
    return bookingId;
}

async function recoverClassroomMeetingUrl(booking) {
    if (!booking?.id || !booking?.slot || typeof window.createBookingViaAppsScript !== "function") return "";
    const result = await window.createBookingViaAppsScript({
        bookingId: booking.id,
        slot: booking.slot,
        durationMinutes: booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50,
        timeZone: booking.timezone || state.bookingSettings?.timezone || getLocalTimezone(),
        name: booking.name || "",
        email: booking.email || "",
        phone: booking.phone || "",
        notes: booking.notes || "",
    });
    const meetingUrl = normalizeMeetingUrl(result?.meetingUrl);
    if (!result?.success || !meetingUrl) return "";
    if (window.db) {
        await window.db.collection("bookings").doc(booking.id).set({
            calendarSynced: true,
            calendarSyncState: CALENDAR_SYNC_STATES.SYNCED,
            calendarLastSyncedAt: Date.now(),
            calendarLastCheckedAt: Date.now(),
            calendarNextRetryAt: 0,
            calendarSyncLastError: "",
            googleCalendarEventId: result.eventId || booking.googleCalendarEventId || null,
            meetingUrl,
            updatedAt: Date.now(),
            history: window.firebase.firestore.FieldValue.arrayUnion({
                at: Date.now(),
                action: "meeting-link-recovered",
                by: "system",
            }),
        }, { merge: true });
    }
    booking.meetingUrl = meetingUrl;
    return meetingUrl;
}

async function openClassroomDirectly(booking, reservedTab = null) {
    const accessState = getLessonAccessState(booking?.slot, Date.now(), {
        lessonMinutes: Number(booking?.durationMinutes || booking?.slotMinutes || 50),
    });
    if (!accessState.canEnter) {
        reservedTab?.close();
        const message = accessState.reason === "too-early"
            ? `The classroom opens 15 minutes before the lesson. ${getLessonEntryLabel(accessState)}.`
            : "This lesson classroom is no longer available.";
        window.alert(message);
        return;
    }
    let url = getClassroomMeetingUrl(booking);
    // Open synchronously from the click gesture. Navigating an already-open tab
    // remains allowed after an async Firestore/Calendar lookup.
    const lessonTab = reservedTab || window.open("about:blank", "_blank");
    if (!lessonTab) {
        window.alert("Your browser blocked the lesson tab. Allow pop-ups for this site, then click Join Lesson again.");
        return;
    }
    lessonTab.opener = null;
    if (!url) {
        setAppLoading(true, "Preparing your Google Meet room...");
        try {
            url = await recoverClassroomMeetingUrl(booking);
        } finally {
            setAppLoading(false);
        }
        if (!url) {
            lessonTab.close();
            window.alert("The Google Meet room could not be prepared. Ask the teacher to sync this booking from the calendar settings.");
            return;
        }
    }
    lessonTab.location.replace(url);
}

function openClassroomModal(booking) {
    currentClassroomBooking = booking;
    const modal = document.getElementById("classroomModal");
    const container = document.getElementById("classroomVideoContainer");
    const subHeader = document.getElementById("classroomSubHeader");
    const notesTextarea = document.getElementById("classroomNotesTextarea");
    const statusMsg = document.getElementById("classroomStatusMsg");

    if (!modal) return;

    if (subHeader) {
        const studentName = booking.name || "Student";
        const timeLabel = booking.slot ? formatSlotTime(booking.slot) : "Active Lesson";
        subHeader.textContent = `${studentName} — ${timeLabel}`;
    }

    if (container) {
        const meetingUrl = getClassroomMeetingUrl(booking);
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:32px; text-align:center; width:100%; min-height:420px;">
                <strong style="font-size:1.2rem;">Open the video lesson in a new tab</strong>
                <p class="small-note" style="max-width:520px;">Google Meet opens securely in its own page.</p>
                <a class="btn btn--primary" href="${escapeHtml(meetingUrl)}" target="_blank" rel="noopener noreferrer">Open Meeting Room</a>
            </div>
        `;
    }

    if (notesTextarea) {
        notesTextarea.value = booking.classroomNotes || booking.notes || "";
    }
    if (statusMsg) setStatus(statusMsg, "");

    modal.classList.add("modal--open");

    setTimeout(() => {
        initWhiteboard();
        if (booking.id) listenWhiteboardFromCloud(booking.id);
    }, 150);

    // Auto-start the timer using this booking's actual duration.
    autoStartClassroomTimer();
}

function closeClassroomModal() {
    const modal = document.getElementById("classroomModal");
    const container = document.getElementById("classroomVideoContainer");
    if (modal) modal.classList.remove("modal--open");
    if (container) container.innerHTML = "";
    if (classroomTimerInterval) clearInterval(classroomTimerInterval);
    if (wbUnsubscribe) wbUnsubscribe();
    classroomTimerRunning = false;
}

function autoStartClassroomTimer() {
    if (classroomTimerInterval) clearInterval(classroomTimerInterval);
    classroomTimeRemaining = Math.max(1, Number(currentClassroomBooking?.durationMinutes || currentClassroomBooking?.slotMinutes || 50)) * 60;
    classroomTimerRunning = true;
    updateClassroomTimerDisplay();

    classroomTimerInterval = setInterval(() => {
        if (classroomTimeRemaining > 0) {
            classroomTimeRemaining -= 1;
            updateClassroomTimerDisplay();
        } else {
            clearInterval(classroomTimerInterval);
            classroomTimerRunning = false;
            handleAutomaticLessonCompletion();
        }
    }, 1000);
}

async function handleAutomaticLessonCompletion() {
    const badge = document.getElementById("classroomAutoStatusBadge");
    if (badge) {
        badge.textContent = "✅ Lesson Completed Automatically!";
        badge.style.background = "#059669";
        badge.style.color = "#ffffff";
    }

    if (currentClassroomBooking && currentClassroomBooking.id) {
        try {
            await markBookingCompleted(currentClassroomBooking.id, currentClassroomBooking);
            const statusMsg = document.getElementById("classroomStatusMsg");
            if (statusMsg) setStatus(statusMsg, "🎉 Lesson finished! Auto-marked completed and +1 hour added to profile stats.", "success");
        } catch (e) {
            console.error("Auto-completion error:", e);
        }
    }
}

function updateClassroomTimerDisplay() {
    const timerDisplay = document.getElementById("classroomTimerDisplay");
    if (!timerDisplay) return;
    const mins = Math.floor(classroomTimeRemaining / 60);
    const secs = classroomTimeRemaining % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function sendWhatsAppReminder(booking) {
    const phone = (booking.phone || state.contactSettings.whatsapp || "").replace(/[^\d+]/g, "");
    const studentName = booking.name || "Student";
    const lessonTime = booking.slot ? formatSlotTime(booking.slot) : "soon";
    const text = `Hello ${studentName}! 👋\nThis is a reminder for your Arabic lesson with Teacher Jaffer starting in 15 minutes at ${lessonTime}.\nInteractive Classroom Link:\n${window.location.origin}`;

    let url = "";
    if (phone && (phone.startsWith("+") || phone.length >= 9)) {
        url = `https://wa.me/${phone.replace("+", "")}?text=${encodeURIComponent(text)}`;
    } else {
        url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    }
    window.open(url, "_blank", "noopener,noreferrer");
}

async function markBookingCompleted(bookingId, booking) {
    if (!window.db) return;
    const completedAt = Date.now();
    await window.db.collection("bookings").doc(bookingId).set({
        status: "completed",
        completedAt,
        consumptionDueAt: completedAt,
        consumptionState: booking?.isFreeTrial === true ? "not-required" : "pending",
        updatedAt: completedAt
    }, { merge: true });

    await window.db.collection("publicBookings").doc(bookingId).set({
        status: "completed",
        updatedAt: completedAt
    }, { merge: true });

    // Auto-increment hours taught in profile settings
    const currentHoursText = state.profileSettings?.hoursTaught || "1,200+";
    const currentHoursNum = parseInt(currentHoursText.replace(/[^\d]/g, ""), 10) || 1200;
    const newHoursNum = currentHoursNum + 1;
    const hasPlus = currentHoursText.includes("+");
    const newHoursText = `${newHoursNum.toLocaleString()}${hasPlus ? "+" : ""}`;

    state.profileSettings.hoursTaught = newHoursText;
    saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
    await saveCloudProfileSettings(window.db, state.profileSettings);
    renderProfileUi();
    await reconcileStudentBalances([bookingId]);
}

function wireStudentActions() {
    document.querySelectorAll("[data-target]").forEach((button) => {
        button.addEventListener("click", () => showScreen(button.getAttribute("data-target")));
    });

    const closeStudentPayment = () => {
        if (els.studentPaymentCard) els.studentPaymentCard.hidden = true;
    };
    els.studentPaymentOpenBtn?.addEventListener("click", () => {
        if (!els.studentPaymentCard) return;
        state.selectedPackage = null;
        document.querySelectorAll("#paymentPackagesGrid .package-card, #packagesGrid .package-card").forEach(card => card.classList.remove("is-selected"));
        if (els.studentPaypalLink) els.studentPaypalLink.disabled = true;
        const selectionMsg = document.getElementById("paymentPackageSelectionMsg");
        if (selectionMsg) selectionMsg.textContent = "Choose a package to continue.";
        const packageStep = document.getElementById("studentPaymentPackageStep");
        const warningStep = document.getElementById("studentPaymentWarningStep");
        if (packageStep) packageStep.hidden = false;
        if (warningStep) warningStep.hidden = true;
        els.studentPaymentCard.hidden = false;
        window.setTimeout(() => els.studentPaymentCloseBtn?.focus(), 0);
    });
    els.studentPaymentCloseBtn?.addEventListener("click", closeStudentPayment);
    els.studentPaymentCard?.addEventListener("click", (event) => {
        if (event.target === els.studentPaymentCard) closeStudentPayment();
    });

    renderLessonFeedbackStars();
    els.lessonFeedbackCard?.addEventListener("click", (event) => {
        const ratingButton = event.target.closest("[data-feedback-rating][data-feedback-metric]");
        if (!ratingButton) return;
        const metric = ratingButton.dataset.feedbackMetric;
        const value = Number(ratingButton.dataset.feedbackRating);
        if (!LESSON_FEEDBACK_METRICS.some(([key]) => key === metric) || value < 1 || value > 5) return;
        state.lessonFeedbackRatings[metric] = value;
        renderLessonFeedbackStars();
    });

    els.lessonFeedbackLater?.addEventListener("click", () => {
        state.lessonFeedbackDismissedBookingId = els.lessonFeedbackBookingId?.value || "";
        hideLessonFeedbackCard();
    });
    els.lessonFeedbackClose?.addEventListener("click", () => {
        state.lessonFeedbackDismissedBookingId = els.lessonFeedbackBookingId?.value || "";
        hideLessonFeedbackCard();
    });
    els.lessonFeedbackReminder?.addEventListener("click", () => {
        state.lessonFeedbackDismissedBookingId = "";
        openLessonFeedbackCard();
    });

    els.lessonFeedbackForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const bookingId = els.lessonFeedbackBookingId?.value || "";
        if (!bookingId || !state.currentUser || state.currentRole !== "student") return;
        setStatus(els.lessonFeedbackMsg, "");
        try {
            await withButtonLoading(els.lessonFeedbackSubmit, "Submitting...", async () => {
                const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
                if (!bookingSnap.exists) throw new Error("Lesson booking was not found.");
                const booking = bookingSnap.data() || {};
                if (booking.studentUid !== state.currentUser.uid) throw new Error("This lesson does not belong to your account.");
                if (getLessonEndMs(booking) > Date.now()) throw new Error("Feedback opens after the lesson ends.");
                const ratings = { ...state.lessonFeedbackRatings };
                if (LESSON_FEEDBACK_METRICS.some(([key]) => Number(ratings[key] || 0) < 1)) {
                    throw new Error("Please choose a star rating for every item.");
                }
                const overall = LESSON_FEEDBACK_METRICS.reduce((sum, [key]) => sum + Number(ratings[key]), 0) / LESSON_FEEDBACK_METRICS.length;
                await window.db.collection("lessonFeedback").doc(bookingId).set({
                    bookingId,
                    studentUid: state.currentUser.uid,
                    lessonSlot: Number(booking.slot || 0),
                    lessonDurationMinutes: Number(booking.durationMinutes || 50),
                    ratings,
                    overall,
                    comment: String(els.lessonFeedbackComment?.value || "").trim(),
                    createdAt: Date.now(),
                });
            });
            setStatus(els.lessonFeedbackMsg, "Thank you. Your lesson feedback was saved privately.", "success");
            window.setTimeout(() => {
                state.pendingLessonFeedbackBooking = null;
                if (els.lessonFeedbackReminder) els.lessonFeedbackReminder.hidden = true;
                hideLessonFeedbackCard();
                if (els.lessonFeedbackComment) els.lessonFeedbackComment.value = "";
            }, 1200);
        } catch (error) {
            setStatus(els.lessonFeedbackMsg, error.message || "Could not save lesson feedback.", "error");
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && state.currentRole === "student") {
            loadStudentBookings().catch(console.error);
        }
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

    els.bookFreeTrialBtn?.addEventListener("click", (event) => {
        if (isStudentSignedIn()) {
            withButtonLoading(event.currentTarget, "Loading schedule...", async () => {
                showScreen("student-screen");
                await ensureBookingCalendarLoaded();
            }).catch(console.error);
            return;
        }
        setStudentAuthMode("signup");
        els.studentAuthModal?.classList.add("modal--open");
        setStatus(els.studentAuthMsg, "Create an account or sign in to book your Free Trial Lesson!", "success");
    });

    els.welcomeWhatsappBtn?.addEventListener("click", () => {
        const message = "Hello Jaffer! I would like to inquire about booking a free trial lesson.";
        const url = buildWhatsAppUrl(state.contactSettings, message);
        if (!url) {
            alert("WhatsApp contact is not configured yet.");
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    });

    els.openTeacherGateBtn?.addEventListener("click", (event) => {
        if (state.teacherUser && state.teacherRole === "teacher") {
            showScreen("teacher-screen");
            refreshTeacherDashboard().catch((error) => {
                console.error("Could not refresh teacher dashboard.", error);
                setStatus(els.teacherAuthMsg, "The dashboard opened, but some data could not refresh.", "error");
            });
            return;
        }
        els.teacherLoginModal?.classList.add("modal--open");
        setStatus(els.teacherLoginMsg, "");
    });

    els.studentLoginModeBtn?.addEventListener("click", () => setStudentAuthMode("login"));
    els.studentSignupModeBtn?.addEventListener("click", () => setStudentAuthMode("signup"));

    els.studentForgotPasswordBtn?.addEventListener("click", async (event) => {
        try {
            await sendPasswordResetLink({
                emailInput: els.studentEmail,
                statusElement: els.studentAuthMsg,
                button: event.currentTarget,
            });
        } catch (error) {
            setStatus(els.studentAuthMsg, error.message || "Could not send password reset email.", "error");
        }
    });

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
                let cred;
                let newlyCreatedUser = null;
                try {
                    cred = await window.auth.createUserWithEmailAndPassword(email, password);
                    newlyCreatedUser = cred.user;
                } catch (createError) {
                    if (createError?.code !== "auth/email-already-in-use") throw createError;
                    // Recover an Auth account left behind by an earlier failed
                    // Firestore profile write. A complete account must use Sign In.
                    cred = await window.auth.signInWithEmailAndPassword(email, password);
                    const existingProfile = await window.db.collection("users").doc(cred.user.uid).get();
                    if (existingProfile.exists) {
                        await window.auth.signOut();
                        throw new Error("This account already exists. Choose Sign In instead.");
                    }
                }
                try {
                    await cred.user.updateProfile({ displayName: name });
                    await window.db.collection("users").doc(cred.user.uid).set({
                    email,
                    name,
                    phone,
                    role: "student",
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                    createdBy: "student-signup",
                    });
                } catch (profileError) {
                    if (newlyCreatedUser) {
                        await newlyCreatedUser.delete().catch(() => {});
                    }
                    throw new Error(profileError?.code === "permission-denied"
                        ? "Account setup was blocked by Firebase permissions. Please try again after the teacher updates the site."
                        : (profileError?.message || "Could not finish creating the student profile."));
                }
                // The account is already complete at this point. Email delivery
                // is best-effort and must never roll back or block sign-up.
                window.notifyNewStudentSignupViaAppsScript?.({ studentId: cred.user.uid })
                    .then((result) => {
                        if (result && result.success === false) console.warn("Teacher signup notification was not sent:", result.message);
                    })
                    .catch((error) => console.warn("Teacher signup notification failed:", error));
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

    els.studentDeleteAccountBtn?.addEventListener("click", () => {
        if (!isStudentSignedIn()) return;
        if (els.studentDeleteAccountPassword) els.studentDeleteAccountPassword.value = "";
        setStatus(els.studentDeleteAccountMsg, "");
        els.studentDeleteAccountModal?.classList.add("modal--open");
        window.setTimeout(() => els.studentDeleteAccountPassword?.focus(), 0);
    });

    els.studentDeleteAccountForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const user = window.auth?.currentUser;
        const password = els.studentDeleteAccountPassword?.value || "";
        if (!user || state.currentRole !== "student") {
            setStatus(els.studentDeleteAccountMsg, "Please sign in again before deleting your account.", "error");
            return;
        }
        if (!user.email || !password) {
            setStatus(els.studentDeleteAccountMsg, "Enter your password to continue.", "error");
            return;
        }

        const profileBackup = {
            ...(state.studentProfile || {}),
            email: state.studentProfile?.email || user.email,
            role: "student",
        };
        let profileDeleted = false;
        try {
            setButtonLoading(els.studentDeleteAccountConfirmBtn, true, "Deleting...");
            setStatus(els.studentDeleteAccountMsg, "Verifying your password...");
            const credential = window.firebase.auth.EmailAuthProvider.credential(user.email, password);
            await user.reauthenticateWithCredential(credential);

            stopStudentProfileListener();
            await window.db.collection("users").doc(user.uid).delete();
            profileDeleted = true;
            await user.delete();

            els.studentDeleteAccountModal?.classList.remove("modal--open");
            if (els.studentDeleteAccountPassword) els.studentDeleteAccountPassword.value = "";
            showScreen("welcome-screen");
        } catch (error) {
            if (profileDeleted && window.auth?.currentUser) {
                try {
                    await window.db.collection("users").doc(user.uid).set(profileBackup, { merge: true });
                    startStudentProfileListener();
                } catch (restoreError) {
                    console.error("Could not restore student profile after account deletion failed.", restoreError);
                }
            }
            const message = error?.code === "auth/wrong-password" || error?.code === "auth/invalid-credential"
                ? "The password is incorrect."
                : (error?.message || "Could not delete your account. Please try again.");
            setStatus(els.studentDeleteAccountMsg, message, "error");
        } finally {
            setButtonLoading(els.studentDeleteAccountConfirmBtn, false);
        }
    });

    els.requestCourseAccessBtn?.addEventListener("click", async () => {
        await withButtonLoading(els.requestCourseAccessBtn, "Sending...", requestFullCourseAccess).catch((error) => {
            setStatus(els.courseAccessRequestMsg, error.message || "Could not send access request.", "error");
        });
    });

    els.bookingWeekPrev?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.bookingWeekOffset = Math.max(0, state.bookingWeekOffset - 1);
            state.visibleDateKey = "";
            showBookingCalendarLoading();
            await refreshRuntimeBusyBlocks();
            await renderBookingCalendar();
        }).catch(console.error);
    });

    els.bookingWeekNext?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", async () => {
            state.bookingWeekOffset += 1;
            state.visibleDateKey = "";
            showBookingCalendarLoading();
            await refreshRuntimeBusyBlocks();
            await renderBookingCalendar();
        }).catch(console.error);
    });

    els.studentTimezoneSelect?.addEventListener("change", async (event) => {
        const tz = event.target.value;
        state.studentTimezone = tz;

        if (els.selectedTimezoneName) els.selectedTimezoneName.textContent = tz;
        if (els.selectedTimezoneOffset) els.selectedTimezoneOffset.textContent = formatTimezoneGmt(tz);

        showBookingCalendarLoading();
        await renderBookingCalendar();
    });

    els.preplyReviewsSort?.addEventListener("change", (event) => {
        state.reviewsSortMode = event.target.value;
        state.reviewsExpanded = false;
        renderReviewsUi();
    });

    els.studentReviewsToggleBtn?.addEventListener("click", async () => {
        if (!state.reviewsExpanded && !state.reviewsLoadedAll) {
            els.studentReviewsToggleBtn.disabled = true;
            els.studentReviewsToggleBtn.textContent = "Loading reviews...";
            try {
                await ensureAllReviewsLoaded();
            } finally {
                els.studentReviewsToggleBtn.disabled = false;
            }
        }
        state.reviewsExpanded = !state.reviewsExpanded;
        renderReviewsUi();
        if (!state.reviewsExpanded) {
            els.studentReviewsSection?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    els.viewFullScheduleBtn?.addEventListener("click", () => {
        state.showAllSlots = !state.showAllSlots;
        if (els.viewFullScheduleBtn) {
            els.viewFullScheduleBtn.textContent = state.showAllSlots ? "View simple schedule" : "View full schedule";
        }
        renderBookingCalendar().catch(console.error);
    });

    els.bookingDayPrev?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", () => moveVisibleBookingDay(-1)).catch(console.error);
    });

    els.bookingDayNext?.addEventListener("click", (event) => {
        withButtonLoading(event.currentTarget, "Loading...", () => moveVisibleBookingDay(1)).catch(console.error);
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
        const shouldShowLoading = Boolean(loadingTextByAction[action]) && action !== "cancel";
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
            if (action === "classroom") {
                if (bookingId.startsWith("demo-")) {
                    openClassroomDirectly({ id: bookingId, name: state.currentUser?.displayName || "Student" });
                    return;
                }
                const lessonTab = window.open("about:blank", "_blank");
                if (!lessonTab) {
                    window.alert("Your browser blocked the lesson tab. Allow pop-ups for this site, then click Join Lesson again.");
                    return;
                }
                lessonTab.opener = null;
                try {
                    const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
                    const booking = { id: bookingSnap.id, ...(bookingSnap.data() || {}) };
                    await openClassroomDirectly(booking, lessonTab);
                } catch (error) {
                    lessonTab.close();
                    throw error;
                }
                return;
            }
            if (action === "whatsapp-reminder") {
                const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
                const booking = { id: bookingSnap.id, ...(bookingSnap.data() || {}) };
                sendWhatsAppReminder(booking);
                return;
            }
            if (action === "cancel") {
                const bookingSnap = await window.db.collection("bookings").doc(bookingId).get();
                const booking = { id: bookingSnap.id, ...(bookingSnap.data() || {}) };
                if (!await confirmStudentCancellation(booking)) return;
                const result = await cancelStudentBooking(bookingId);
                setStatus(
                    els.bookingStatusMsg,
                    result.calendarDeletePending
                        ? "Booking canceled. Calendar removal will be retried."
                        : "Booking canceled.",
                    "success"
                );
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

    document.querySelectorAll("[data-close-delete-account-modal]").forEach((button) => {
        button.addEventListener("click", () => {
            els.studentDeleteAccountModal?.classList.remove("modal--open");
            if (els.studentDeleteAccountPassword) els.studentDeleteAccountPassword.value = "";
            setStatus(els.studentDeleteAccountMsg, "");
        });
    });

    document.querySelectorAll("[data-close-classroom-modal]").forEach((button) => {
        button.addEventListener("click", () => closeClassroomModal());
    });

    const tabBoardBtn = document.getElementById("classroomTabBoardBtn");
    const tabNotesBtn = document.getElementById("classroomTabNotesBtn");
    const tabMaterialsBtn = document.getElementById("classroomTabMaterialsBtn");

    const boardTab = document.getElementById("classroomBoardTab");
    const notesTab = document.getElementById("classroomNotesTab");
    const materialsTab = document.getElementById("classroomMaterialsTab");

    tabBoardBtn?.addEventListener("click", () => {
        if (boardTab) boardTab.style.display = "flex";
        if (notesTab) notesTab.style.display = "none";
        if (materialsTab) materialsTab.style.display = "none";
        tabBoardBtn.className = "btn btn--small btn--primary";
        if (tabNotesBtn) tabNotesBtn.className = "btn btn--small btn--ghost";
        if (tabMaterialsBtn) tabMaterialsBtn.className = "btn btn--small btn--ghost";
        setTimeout(() => initWhiteboard(), 100);
    });

    tabNotesBtn?.addEventListener("click", () => {
        if (boardTab) boardTab.style.display = "none";
        if (notesTab) notesTab.style.display = "flex";
        if (materialsTab) materialsTab.style.display = "none";
        tabNotesBtn.className = "btn btn--small btn--primary";
        if (tabBoardBtn) tabBoardBtn.className = "btn btn--small btn--ghost";
        if (tabMaterialsBtn) tabMaterialsBtn.className = "btn btn--small btn--ghost";
    });

    tabMaterialsBtn?.addEventListener("click", () => {
        if (boardTab) boardTab.style.display = "none";
        if (notesTab) notesTab.style.display = "none";
        if (materialsTab) materialsTab.style.display = "flex";
        tabMaterialsBtn.className = "btn btn--small btn--primary";
        if (tabBoardBtn) tabBoardBtn.className = "btn btn--small btn--ghost";
        if (tabNotesBtn) tabNotesBtn.className = "btn btn--small btn--ghost";
    });

    // Whiteboard tool buttons
    document.getElementById("wbColorPicker")?.addEventListener("change", (e) => {
        wbCurrentColor = e.target.value;
        wbCurrentTool = "pen";
    });

    document.getElementById("wbPenBtn")?.addEventListener("click", () => {
        wbCurrentTool = "pen";
    });

    document.getElementById("wbHighlighterBtn")?.addEventListener("click", () => {
        wbCurrentTool = "highlighter";
    });

    document.getElementById("wbEraserBtn")?.addEventListener("click", () => {
        wbCurrentTool = "eraser";
    });

    document.getElementById("wbClearBtn")?.addEventListener("click", () => {
        clearWhiteboard();
    });

    document.getElementById("wbSyncBtn")?.addEventListener("click", () => {
        saveWhiteboardToCloud();
    });

    document.getElementById("classroomLaunchNewTabBtn")?.addEventListener("click", () => {
        const url = getClassroomMeetingUrl(currentClassroomBooking);
        window.open(url, "_blank", "noopener,noreferrer");
    });

    document.getElementById("saveClassroomNotesBtn")?.addEventListener("click", async (event) => {
        const notesTextarea = document.getElementById("classroomNotesTextarea");
        const statusMsg = document.getElementById("classroomStatusMsg");
        if (!currentClassroomBooking || !currentClassroomBooking.id) {
            if (statusMsg) setStatus(statusMsg, "Notes saved locally for this session.", "success");
            return;
        }
        const notesValue = (notesTextarea?.value || "").trim();
        await withButtonLoading(event.currentTarget, "Saving...", async () => {
            await window.db.collection("bookings").doc(currentClassroomBooking.id).set({
                classroomNotes: notesValue,
                updatedAt: Date.now()
            }, { merge: true });
            currentClassroomBooking.classroomNotes = notesValue;
            if (statusMsg) setStatus(statusMsg, "Classroom notes saved to lesson record!", "success");
        }).catch((err) => {
            if (statusMsg) setStatus(statusMsg, err.message || "Failed to save notes.", "error");
        });
    });

    async function hasPriorStudentBooking(studentUid, email) {
        if (!window.db || !studentUid) return false;
        const bookings = new Map();
        const uidSnap = await window.db
            .collection("bookings")
            .where("studentUid", "==", studentUid)
            .get();
        uidSnap.forEach((doc) => bookings.set(doc.id, doc.data() || {}));
        const normalizedEmail = String(email || "").trim().toLowerCase();
        if (normalizedEmail && uidSnap.empty) {
            const emailSnap = await window.db
                .collection("bookings")
                .where("email", "==", normalizedEmail)
                .get();
            emailSnap.forEach((doc) => bookings.set(doc.id, doc.data() || {}));
        }
        return Array.from(bookings.values()).some((booking) => {
            return String(booking.status || "booked").toLowerCase() !== "canceled";
        });
    }

    els.bookingForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isStudentSignedIn()) {
            setStatus(els.bookingMsg, "Please sign in as a student before booking.", "error");
            els.studentAuthModal?.classList.add("modal--open");
            return;
        }

        if (state.bookingSubmissionInFlight) {
            setStatus(els.bookingMsg, "This booking request is already being processed.", "error");
            return;
        }
        state.bookingSubmissionInFlight = true;
        if (els.bookingSubmit) els.bookingSubmit.disabled = true;
        try {

        const freshProfileSnap = await window.db.collection("users").doc(state.currentUser.uid).get();
        const profile = freshProfileSnap.exists ? (freshProfileSnap.data() || {}) : (state.studentProfile || {});
        state.studentProfile = profile;
        const email = (state.currentUser.email || "").trim().toLowerCase();
        const hasPriorBooking = profile.trialUsed === true
            ? true
            : await hasPriorStudentBooking(state.currentUser.uid, email);
        const isTrial = !hasPriorBooking;
        if (hasPriorBooking && profile.trialUsed !== true) {
            const trialUsedAt = Date.now();
            await window.db.collection("users").doc(state.currentUser.uid).set({
                trialUsed: true,
                trialUsedAt,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            state.studentProfile = {
                ...profile,
                trialUsed: true,
                trialUsedAt,
            };
            updateStudentAccountUi();
        }
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
                isFreeTrial: isTrial,
            },
            bookingSubmit: els.bookingSubmit,
            bookingSubmitLabel: els.bookingSubmit?.querySelector(".btn__label"),
            bookingMsg: els.bookingMsg,
            bookingSuccessModal: els.bookingSuccessModal,
            bookingSuccessText: els.bookingSuccessText,
            bookingSuccessWhatsAppBtn: els.bookingSuccessWhatsAppBtn,
            bookingSuccessTrialIntro: els.bookingSuccessTrialIntro,
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
            createBookingViaAppsScript: window.createBookingViaAppsScript,
            commitBookingWithBilling: commitBookingWithReservation,
            buildWhatsAppUrl,
            loadBookingStatus,
            isLocalDevHost,
        }));
        await loadStudentBookings();
        } catch (error) {
            setStatus(els.bookingMsg, error.message || "Booking failed. Please try again.", "error");
        } finally {
            state.bookingSubmissionInFlight = false;
            updateBookingSubmitState();
        }
    });

    if (els.studentRatingSelect && !els.studentRatingSelect.querySelector("option[value='1']")) {
        els.studentRatingSelect.insertAdjacentHTML(
            "beforeend",
            '<option value="2">⭐⭐ (2/5 Needs Improvement)</option><option value="1">⭐ (1/5 Poor)</option>'
        );
    }

    const reviewCharacterCount = document.getElementById("studentReviewCharacterCount");
    const reviewPreview = document.getElementById("studentReviewPreview");
    const updateReviewPreview = () => {
        const text = (els.studentReviewText?.value || "").trim();
        if (reviewCharacterCount) reviewCharacterCount.textContent = String(els.studentReviewText?.value.length || 0);
        if (!reviewPreview) return;
        reviewPreview.hidden = !text;
        reviewPreview.innerHTML = text
            ? `<span>${"★".repeat(Number(els.studentRatingSelect?.value || 5))}${"☆".repeat(5 - Number(els.studentRatingSelect?.value || 5))}</span><p>${escapeHtml(text)}</p>`
            : "";
    };
    els.studentReviewText?.addEventListener("input", updateReviewPreview);
    els.studentRatingSelect?.addEventListener("change", updateReviewPreview);

    document.getElementById("studentReviewDraftBtn")?.addEventListener("click", () => {
        const goal = (document.getElementById("studentReviewGoal")?.value || "").trim();
        const progress = (document.getElementById("studentReviewProgress")?.value || "").trim();
        const recommendation = document.getElementById("studentReviewRecommend")?.value || "yes";
        const traits = Array.from(document.querySelectorAll("[data-review-trait]:checked"))
            .map((input) => input.value);
        const sentences = [];
        if (goal) sentences.push(`I started lessons with Jaffer because I wanted to improve ${goal}.`);
        if (traits.length) sentences.push(`I especially appreciate his ${traits.join(", ")}.`);
        if (progress) sentences.push(`Since starting the lessons, I have improved my ${progress}.`);
        if (recommendation === "yes") {
            sentences.push("I would recommend Jaffer to anyone who wants to learn practical Palestinian Arabic.");
        } else if (recommendation === "maybe") {
            sentences.push("The lessons may be a good fit for students with similar learning goals.");
        } else {
            sentences.push("I think the learning experience could be improved further.");
        }
        if (!sentences.length) {
            setStatus(els.studentReviewMsg, "Add your goal or choose what stood out first.", "error");
            return;
        }
        if (els.studentReviewText) {
            els.studentReviewText.value = sentences.join(" ");
            els.studentReviewText.focus();
            updateReviewPreview();
        }
        setStatus(els.studentReviewMsg, "Draft created. Please edit it so it reflects your honest experience.", "success");
    });

    els.studentReviewForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const profile = state.studentProfile || {};
        if (profile.reviewRequested !== true || profile.hasSubmittedReview === true) {
            setStatus(els.studentReviewMsg, "Review is not available right now.", "error");
            syncStudentReviewUi();
            return;
        }
        const rating = Number(els.studentRatingSelect?.value || 5);
        const country = (els.studentReviewCountry?.value || "").trim();
        const tag = (els.studentReviewTag?.value || "").trim();
        const text = (els.studentReviewText?.value || "").trim();
        if (text.length < 20) {
            setStatus(els.studentReviewMsg, "Please write at least 20 characters.", "error");
            return;
        }

        const user = state.currentUser;
        const name = getStudentName() || user?.displayName || "Student";
        const newReview = {
            id: user?.uid || `rev_${Date.now()}`,
            name,
            country: country || "🌐 Student",
            rating,
            tag: tag || "Arabic Lesson",
            date: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }),
            text,
            avatar: name.substring(0, 2).toUpperCase(),
            source: "Student Review",
            studentUid: user?.uid || null,
            createdAt: Date.now(),
        };

        try {
            await withButtonLoading(els.studentReviewSubmit, "Submitting...", async () => {
                await addReviewToCloud(window.db, newReview);
                state.reviews.unshift(newReview);
                saveLocalReviews("teacher_reviews_v1", state.reviews);
                renderReviewsUi();

                const key = `review_submitted_${user?.uid || user?.email || "guest"}`;
                localStorage.setItem(key, "true");
                if (user?.uid && window.db) {
                    try {
                        await window.db.collection("users").doc(user.uid).set({
                            hasSubmittedReview: true,
                            reviewRequested: false,
                            reviewSubmittedAt: Date.now(),
                        }, { merge: true });
                        state.studentProfile = {
                            ...(state.studentProfile || {}),
                            hasSubmittedReview: true,
                            reviewRequested: false,
                            reviewSubmittedAt: Date.now(),
                        };
                    } catch (uErr) {
                        console.warn("Could not update hasSubmittedReview on user profile:", uErr);
                    }
                }
                syncStudentReviewUi();
            });
        } catch (error) {
            let msg = error.message || "Could not submit review.";
            try {
                const parsed = JSON.parse(msg);
                if (parsed.error) msg = parsed.error;
            } catch (_) {}
            setStatus(els.studentReviewMsg, msg, "error");
        }
    });

    els.studentReviewPromptWrite?.addEventListener("click", () => {
        if (els.studentReviewPrompt) els.studentReviewPrompt.hidden = true;
        els.studentReviewCard?.scrollIntoView({ behavior: "smooth", block: "start" });
        window.setTimeout(() => els.studentReviewText?.focus(), 450);
    });

    els.studentReviewPromptLater?.addEventListener("click", () => {
        const key = els.studentReviewPrompt?.dataset.sessionKey;
        if (key) sessionStorage.setItem(key, "true");
        if (els.studentReviewPrompt) els.studentReviewPrompt.hidden = true;
    });

    els.studentReviewPromptDismiss?.addEventListener("click", async () => {
        const user = state.currentUser;
        if (!user?.uid || !window.db) return;
        try {
            await withButtonLoading(els.studentReviewPromptDismiss, "Saving...", async () => {
                await window.db.collection("users").doc(user.uid).set({
                    reviewRequested: false,
                }, { merge: true });
                state.studentProfile = {
                    ...(state.studentProfile || {}),
                    reviewRequested: false,
                };
                syncStudentReviewUi();
            });
        } catch (error) {
            setStatus(els.studentReviewPromptMsg, error.message || "Could not close the review request.", "error");
        }
    });

    const selectPaymentPackage = (event) => {
        const card = event.target.closest("[data-package-lessons]");
        if (!card) return;
        document.querySelectorAll("#packagesGrid .package-card, #paymentPackagesGrid .package-card").forEach(c => {
            const matches = c.dataset.packageLessons === card.dataset.packageLessons
                && c.dataset.packagePrice === card.dataset.packagePrice;
            c.classList.toggle("is-selected", matches);
        });

        const lessons = Number(card.dataset.packageLessons || 0);
        const price = Number(card.dataset.packagePrice || 0);
        if (!(lessons > 0) || !(price > 0)) return;
        const label = card.dataset.packageLabel || `${lessons} Lessons ($${price})`;

        state.selectedPackage = { lessons, price, label };
        const display = document.getElementById("selectedPackageDisplay");
        if (display) display.textContent = label;
        if (els.studentPaypalLink) {
            els.studentPaypalLink.disabled = !els.studentPaypalLink.dataset.paypalBase;
        }
        const selectionMsg = document.getElementById("paymentPackageSelectionMsg");
        if (selectionMsg) selectionMsg.textContent = `${label} selected. The teacher must confirm your payment.`;
    };
    document.getElementById("packagesGrid")?.addEventListener("click", selectPaymentPackage);
    document.getElementById("paymentPackagesGrid")?.addEventListener("click", selectPaymentPackage);

    els.studentPaypalLink?.addEventListener("click", () => {
        if (!state.selectedPackage || !els.studentPaypalLink.dataset.paypalBase) return;
        const packageStep = document.getElementById("studentPaymentPackageStep");
        const warningStep = document.getElementById("studentPaymentWarningStep");
        if (packageStep) packageStep.hidden = true;
        if (warningStep) warningStep.hidden = false;
    });

    document.getElementById("studentPaymentBackBtn")?.addEventListener("click", () => {
        const packageStep = document.getElementById("studentPaymentPackageStep");
        const warningStep = document.getElementById("studentPaymentWarningStep");
        if (packageStep) packageStep.hidden = false;
        if (warningStep) warningStep.hidden = true;
    });

    document.getElementById("studentPaypalContinueBtn")?.addEventListener("click", async () => {
        if (!state.selectedPackage || !els.studentPaypalLink?.dataset.paypalBase) return;
        const paymentTab = window.open("about:blank", "_blank");
        if (!paymentTab) {
            window.alert("Allow pop-ups for this site, then click Open PayPal again.");
            return;
        }
        paymentTab.opener = null;
        try {
            await requestFullCourseAccess();
            const paymentUrl = buildPayPalPackageUrl(
                els.studentPaypalLink.dataset.paypalBase,
                state.selectedPackage.price
            );
            if (!paymentUrl) throw new Error("The teacher has not configured a valid PayPal link.");
            paymentTab.location.replace(paymentUrl);
            updateCourseAccessRequestUi();
        } catch (error) {
            paymentTab.close();
            const selectionMsg = document.getElementById("paymentPackageSelectionMsg");
            if (selectionMsg) setStatus(selectionMsg, error.message || "Could not prepare the payment.", "error");
        }
    });

    document.getElementById("requestCourseAccessBtn")?.addEventListener("click", async (event) => {
        await withButtonLoading(event.currentTarget, "Sending...", async () => {
            await requestFullCourseAccess();
        });
    });

    document.getElementById("packageWhatsAppBtn")?.addEventListener("click", () => {
        const pkg = state.selectedPackage;
        if (!pkg) return;
        const studentName = getStudentName() || (state.currentUser?.email || "Student");
        const message = `Hello Jaffer! I am ${studentName}. I would like to pay/paid for the package: ${pkg.label}. Please confirm and add credits to my account.`;
        const url = buildWhatsAppUrl(state.contactSettings, message);
        if (!url) {
            const msgEl = document.getElementById("courseAccessRequestMsg");
            if (msgEl) setStatus(msgEl, "Teacher WhatsApp number is not configured yet in contact settings.", "error");
            return;
        }
        window.open(url, "_blank", "noopener,noreferrer");
    });

    els.preplyBioToggleBtn?.addEventListener("click", () => {
        const textEl = els.preplyBioText;
        const toggleTextEl = els.preplyBioToggleText;
        const chevronEl = els.preplyBioToggleChevron;
        const fadeEl = els.bioFadeOverlay;

        if (!textEl) return;

        const isCollapsed = textEl.style.maxHeight === "180px" || !textEl.style.maxHeight;
        if (isCollapsed) {
            textEl.style.maxHeight = `${textEl.scrollHeight}px`;
            if (toggleTextEl) toggleTextEl.textContent = "Read less";
            if (chevronEl) chevronEl.style.transform = "rotate(180deg)";
            if (fadeEl) fadeEl.style.opacity = "0";
        } else {
            textEl.style.maxHeight = "180px";
            if (toggleTextEl) toggleTextEl.textContent = "Read more";
            if (chevronEl) chevronEl.style.transform = "rotate(0deg)";
            if (fadeEl) fadeEl.style.opacity = "1";
        }
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
    if (els.teacherClassroomMeetingUrl) els.teacherClassroomMeetingUrl.value = state.contactSettings.classroomMeetingUrl || "";
    if (els.teacherRevenueTotalInput) els.teacherRevenueTotalInput.value = Number(state.teacherRevenueTotal || 0).toFixed(2);
    const offers = state.bookingSettings.courseOffers || {};
    if (els.courseAccessPrice) els.courseAccessPrice.value = String(offers.courseAccessPrice ?? 15);
    if (els.courseAccessUnits) els.courseAccessUnits.value = String(offers.courseAccessUnits ?? 15);
    if (els.freeTrialLessons) els.freeTrialLessons.value = String(offers.freeTrialLessons ?? 1);
    if (els.paypalPaymentLink) els.paypalPaymentLink.value = String(offers.paypalPaymentLink ?? "");
    if (els.paypalReminder) {
        els.paypalReminder.value = offers.paypalReminder ||
            "Just a quick reminder: when you choose to pay through PayPal, please choose Goods and Services. Choosing another option may affect my PayPal account.";
    }
    renderTeacherDays();
    renderExceptions();
    renderTeacherPackagesUi();

    const lastSync = state.bookingSettings?.lastGoogleSync;
    if (lastSync && els.googleSyncIndicator && els.googleSyncTime) {
        try {
            const date = new Date(lastSync);
            const formatted = date.toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: state.bookingSettings.timezone || getTeacherTimezone()
            });
            els.googleSyncTime.textContent = formatted;
            els.googleSyncIndicator.style.display = "inline-flex";
        } catch (e) {
            console.error("Error formatting google last sync time:", e);
            els.googleSyncIndicator.style.display = "none";
        }
    } else if (els.googleSyncIndicator) {
        els.googleSyncIndicator.style.display = "none";
    }
}

function getExceptionEndMs(item, timezone) {
    const [year, month, day] = String(item?.date || "").split("-").map(Number);
    const [endHour, endMinute] = String(item?.end || "").split(":").map(Number);
    if (![year, month, day, endHour, endMinute].every(Number.isFinite)) return NaN;

    const [startHour, startMinute] = String(item?.start || "").split(":").map(Number);
    const crossesMidnight = [startHour, startMinute].every(Number.isFinite)
        && endHour * 60 + endMinute <= startHour * 60 + startMinute;
    const endDate = crossesMidnight ? addDaysToDateKey(item.date, 1) : item.date;
    const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
    return zonedDateTimeToUtcMs(timezone, endYear, endMonth, endDay, endHour, endMinute);
}

function renderExceptions() {
    if (!els.exceptionList) return;
    const now = Date.now();
    const timezone = getTeacherTimezone();
    const exceptions = (Array.isArray(state.bookingSettings.exceptions)
        ? state.bookingSettings.exceptions
        : [])
        .map((item, originalIndex) => ({ item, originalIndex }))
        .filter(({ item }) => {
            if (!item?.date || !item?.end) return true;
            const endMs = getExceptionEndMs(item, timezone);
            return !Number.isFinite(endMs) || endMs > now;
        });
    exceptions.sort((a, b) => `${a.item.date} ${a.item.start}`.localeCompare(`${b.item.date} ${b.item.start}`));

    if (!exceptions.length) {
        els.exceptionList.innerHTML = `<div class="empty-state">No busy blocks yet.</div>`;
        return;
    }

    els.exceptionList.innerHTML = exceptions.map(({ item, originalIndex }) => `
        <div class="exception-item">
            <div><strong>${escapeHtml(item.date || "")}</strong> ${escapeHtml(item.start || "")} - ${escapeHtml(item.end || "")}</div>
            <div class="small-note">${escapeHtml(item.note || "Busy")}</div>
            <div class="action-row">
                <button type="button" class="btn btn--ghost btn--small" data-remove-exception="${originalIndex}">Remove</button>
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

function removeExpiredExceptions() {
    const exceptions = Array.isArray(state.bookingSettings.exceptions)
        ? state.bookingSettings.exceptions
        : [];
    const now = Date.now();
    const timezone = getTeacherTimezone();
    const active = exceptions.filter((item) => {
        if (!item?.date || !item?.end) return true;
        const endMs = getExceptionEndMs(item, timezone);
        return !Number.isFinite(endMs) || endMs > now;
    });
    const removedCount = exceptions.length - active.length;
    if (removedCount) state.bookingSettings.exceptions = active;
    return removedCount;
}

async function removeImportedCalendarExceptions() {
    const exceptions = Array.isArray(state.bookingSettings.exceptions) ? state.bookingSettings.exceptions : [];
    const manualOnly = exceptions.filter((item) => {
        const source = String(item?.source || "").toLowerCase();
        return source !== "googlecalendar" && !String(item?.sourceEventId || "").trim();
    });
    if (manualOnly.length === exceptions.length) return 0;
    state.bookingSettings.exceptions = manualOnly;
    await saveTeacherSettings();
    renderExceptions();
    return exceptions.length - manualOnly.length;
}

async function saveBookingSettingsPublicMirror() {
    const publicCourseOffers = {
        ...(state.bookingSettings.courseOffers || {}),
        packages: Array.isArray(state.bookingSettings.courseOffers?.packages)
            ? state.bookingSettings.courseOffers.packages.map((pkg, index) => ({
                id: String(pkg.id || `pkg-${index + 1}`),
                lessons: Math.max(1, Number.parseInt(pkg.lessons || "1", 10) || 1),
                price: Math.max(0.01, Number.parseFloat(pkg.price || "10") || 10),
                badge: String(pkg.badge || "").slice(0, 60),
                popular: pkg.popular === true,
            }))
            : [],
    };
    await window.db.collection("bookingSettings").doc("primary").set({
        timezone: state.bookingSettings.timezone,
        slotMinutes: state.bookingSettings.slotMinutes,
        breakMinutes: state.bookingSettings.breakMinutes,
        totalSlotMinutes: state.bookingSettings.totalSlotMinutes,
        days: state.bookingSettings.days,
        exceptions: state.bookingSettings.exceptions,
        courseOffers: publicCourseOffers,
        updatedAt: Date.now(),
    }, { merge: true });
}

async function saveContactPublicMirror() {
    await window.db.collection("bookingSettings").doc("primary").set({
        whatsapp: state.contactSettings.whatsapp || "",
        contactEmail: state.contactSettings.email || "",
        classroomMeetingUrl: state.contactSettings.classroomMeetingUrl || "",
        updatedAt: Date.now(),
    }, { merge: true });
}

async function saveTeacherSettings() {
    state.bookingSettings = ensureBookingSettingsShape(state.bookingSettings);
    window.bookingSettings = state.bookingSettings;
    await saveBookingSettingsToCloud(window.db, state.bookingSettings);
    await saveBookingSettingsPublicMirror();
}

async function saveCourseOffers() {
    const rawPayPalLink = (els.paypalPaymentLink?.value || "").trim();
    const paypalPaymentLink = normalizePayPalLink(rawPayPalLink);
    if (rawPayPalLink && !paypalPaymentLink) {
        throw new Error("Use a secure https://paypal.com or https://paypal.me payment link.");
    }
    state.bookingSettings.courseOffers = {
        ...state.bookingSettings.courseOffers,
        courseAccessPrice: toMoneyValue(els.courseAccessPrice?.value),
        courseAccessUnits: Math.max(1, Number.parseInt(els.courseAccessUnits?.value || "15", 10) || 15),
        freeTrialLessons: Math.max(0, Number.parseInt(els.freeTrialLessons?.value || "1", 10) || 0),
        paypalPaymentLink: paypalPaymentLink.slice(0, 500),
        paypalReminder: (els.paypalReminder?.value || "").trim().slice(0, 500),
        updatedAt: Date.now(),
    };
    await saveTeacherSettings();
    updateStudentOfferUi();
    setStatus(els.courseOffersMsg, "Course offers saved.", "success");
}

function renderTeacherPackagesUi() {
    if (!els.teacherPackagesContainer) return;
    const offers = state.bookingSettings.courseOffers || {};
    const pkgs = offers.packages || [];
    els.teacherPackagesContainer.innerHTML = "";

    if (pkgs.length === 0) {
        els.teacherPackagesContainer.innerHTML = `<div class="small-note" style="text-align: center; padding: 10px; color: var(--muted);">No packages defined. Click 'Add New Package' to get started.</div>`;
        return;
    }

    pkgs.forEach((p, idx) => {
        const row = document.createElement("div");
        row.className = "package-row";
        row.dataset.id = p.id || `pkg-${idx}-${Date.now()}`;
        row.style.cssText = "display: flex; gap: 10px; align-items: center; background: var(--bg-soft); padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-md); margin-bottom: 8px; flex-wrap: wrap;";
        row.innerHTML = `
            <div style="flex: 2; min-width: 140px;">
                <span style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px;">Badge / Discount Label</span>
                <input type="text" class="package-badge-input" value="${escapeHtml(p.badge || "")}" placeholder="e.g. Save 7%" style="width: 100%; padding: 4px 8px; font-size: 0.85rem;" />
            </div>
            <div style="flex: 1; min-width: 70px;">
                <span style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px;">Lessons</span>
                <input type="number" class="package-lessons-input" value="${p.lessons || 1}" min="1" step="1" required style="width: 100%; padding: 4px 8px; font-size: 0.85rem;" />
            </div>
            <div style="flex: 1; min-width: 80px;">
                <span style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px;">Price (USD)</span>
                <input type="number" class="package-price-input" value="${p.price || 15}" min="0.01" step="0.01" required style="width: 100%; padding: 4px 8px; font-size: 0.85rem;" />
            </div>
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 50px; min-width: 50px;">
                <span style="font-size: 0.75rem; color: var(--muted); display: block; margin-bottom: 2px; text-align: center;">Popular</span>
                <input type="radio" name="popular_package" class="package-popular-input" ${p.popular ? "checked" : ""} style="cursor: pointer; transform: scale(1.1);" />
            </div>
            <div style="margin-top: 15px;">
                <button type="button" class="btn btn--danger package-delete-btn" style="padding: 4px 8px; font-size: 0.8rem; background: #ef4444; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Delete</button>
            </div>
        `;

        row.querySelector(".package-delete-btn")?.addEventListener("click", () => {
            row.remove();
        });

        els.teacherPackagesContainer.appendChild(row);
    });
}

function getRecommendedPackagesForPrice(price = 20) {
    const lessonPrice = Math.max(1, toMoneyValue(price) || 20);
    return [
        { id: "pkg-1", lessons: 1, price: lessonPrice, badge: "Single Lesson", popular: false },
        { id: "pkg-5", lessons: 5, price: Math.round(lessonPrice * 5 * 0.96), badge: "Starter Pack", popular: false },
        { id: "pkg-10", lessons: 10, price: Math.round(lessonPrice * 10 * 0.9), badge: "POPULAR", popular: true },
        { id: "pkg-20", lessons: 20, price: Math.round(lessonPrice * 20 * 0.85), badge: "Best Value", popular: false },
    ];
}

function gatherPackagesFromUi() {
    if (!els.teacherPackagesContainer) return [];
    const rows = els.teacherPackagesContainer.querySelectorAll(".package-row");
    const pkgs = [];
    rows.forEach(row => {
        const id = row.dataset.id;
        const badgeInput = row.querySelector(".package-badge-input");
        const lessonsInput = row.querySelector(".package-lessons-input");
        const priceInput = row.querySelector(".package-price-input");
        const popularInput = row.querySelector(".package-popular-input");

        const badge = (badgeInput?.value || "").trim();
        const lessons = Math.max(1, Number.parseInt(lessonsInput?.value || "1", 10) || 1);
        const price = Number.parseFloat(priceInput?.value || "0");
        if (!(price > 0)) return;
        const popular = popularInput ? popularInput.checked : false;

        pkgs.push({ id, badge, lessons, price, popular });
    });
    return pkgs;
}

async function saveTeacherPackages() {
    const gatheredPackages = gatherPackagesFromUi();
    const pkgs = gatheredPackages;
    if (pkgs.length > 0) {
        const popularCount = pkgs.filter(p => p.popular).length;
        if (popularCount === 0) {
            pkgs[0].popular = true;
        } else if (popularCount > 1) {
            let found = false;
            pkgs.forEach(p => {
                if (p.popular) {
                    if (!found) found = true;
                    else p.popular = false;
                }
            });
        }
    }
    state.bookingSettings.courseOffers.packages = pkgs;
    await saveTeacherSettings();
    await loadPublicSettings({ force: true });
    updateStudentOfferUi();
    renderTeacherPackagesUi();
}

async function saveTeacherContactSettings() {
    await saveContactSettingsToCloud(window.db, window.firebase, state.contactSettings);
    await saveContactPublicMirror();
}

let publicBookingPrivacyMigrationDone = false;

async function removePrivateFieldsFromPublicBookings() {
    if (publicBookingPrivacyMigrationDone || !state.teacherUser || state.teacherRole !== "teacher") return;
    const documentId = window.firebase.firestore.FieldPath.documentId();
    const deleteField = window.firebase.firestore.FieldValue.delete();
    let lastDoc = null;
    do {
        let query = window.db.collection("publicBookings").orderBy(documentId).limit(300);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snapshot = await query.get();
        if (snapshot.empty) break;
        const batch = window.db.batch();
        let changedCount = 0;
        snapshot.docs.forEach((doc) => {
            const data = doc.data() || {};
            if (!Object.prototype.hasOwnProperty.call(data, "emailHash") &&
                !Object.prototype.hasOwnProperty.call(data, "studentUid")) {
                return;
            }
            batch.update(doc.ref, {
                emailHash: deleteField,
                studentUid: deleteField,
            });
            changedCount += 1;
        });
        if (changedCount) await batch.commit();
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < 300) break;
    } while (lastDoc);
    publicBookingPrivacyMigrationDone = true;
}

async function refreshTeacherDashboard() {
    if (!state.teacherUser || state.teacherRole !== "teacher") return;
    const teacherSnap = await window.db.collection("teachers").doc(state.teacherUser.uid).get();
    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
    state.teacherCalendarStatistics = teacherData.calendarStatistics || state.teacherCalendarStatistics || {};
    state.teacherRevenueTotal = Number.isFinite(Number(teacherData.revenueTotal))
        ? Number(teacherData.revenueTotal)
        : 0;
    state.bookingSettings = ensureBookingSettingsShape({
        ...getDefaultBookingSettings(getTeacherTimezone()),
        ...(teacherData.bookingSettings || {}),
    });
    state.contactSettings = {
        ...createInitialContactSettings(),
        ...(teacherData.contactSettings || {}),
    };
    window.bookingSettings = state.bookingSettings;
    if (removeExpiredExceptions() > 0) {
        await saveTeacherSettings();
    }
    await refreshRuntimeBusyBlocks();
    syncTeacherFormFields();
    await refreshTeacherBookings({ reconcile: false });
    renderTeacherWeekCalendar();
    const secondaryLoads = [
        state.activeTeacherTab === "tab-students" ? refreshTeacherStudents() : Promise.resolve(),
        refreshGoogleCalendarStatus(),
        renderBookingCalendar(),
        reconcileStudentBalances().then(async (result) => {
            if (result?.chargedCount) {
                await Promise.all([refreshTeacherStudents(), refreshTeacherBookings({ reconcile: false })]);
            }
            return result;
        }),
    ];
    Promise.allSettled(secondaryLoads).then((results) => {
        results.filter((result) => result.status === "rejected").forEach((result) => {
            console.warn("A secondary teacher dashboard task failed.", result.reason);
        });
    });
    updateTeacherOverviewStats();
}

function switchTeacherTab(tabId) {
    if (!tabId) return;
    const teacherDash = document.getElementById("teacherDashboard");
    if (!teacherDash) return;

    const tabBtns = teacherDash.querySelectorAll(".teacher-nav-tabs .teacher-tab-btn");
    const tabPanels = teacherDash.querySelectorAll(".teacher-tab-content");

    tabBtns.forEach((btn) => {
        const isActive = btn.dataset.teacherTab === tabId;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    tabPanels.forEach((panel) => {
        const isActive = panel.id === tabId;
        panel.classList.toggle("is-active", isActive);
        if (isActive) {
            panel.removeAttribute("hidden");
        } else {
            panel.setAttribute("hidden", "hidden");
        }
    });

    state.activeTeacherTab = tabId;
    if (tabId === "tab-schedule") {
        refreshTeacherCalendarData({ force: true }).catch((error) => console.warn("Could not refresh teacher schedule.", error));
    }
    if (tabId === "tab-students" && Date.now() - state.teacherStudentsLastRefreshAt >= 30000) {
        refreshTeacherStudents().catch((error) => console.warn("Could not refresh students.", error));
    }
    if (tabId === "tab-reviews" && !state.teacherLessonFeedbackLoaded) {
        ensureAllReviewsLoaded().catch((error) => console.warn("Could not load all reviews.", error));
        refreshTeacherLessonFeedback().catch((error) => {
            console.warn("Could not load lesson feedback.", error);
        });
    }
}

let teacherUpcomingBannerInterval = null;

function renderTeacherUpcomingLessonBanner() {
    const bannerEl = document.getElementById("teacherUpcomingLessonBanner");
    if (!bannerEl) return;

    if (teacherUpcomingBannerInterval) {
        clearInterval(teacherUpcomingBannerInterval);
        teacherUpcomingBannerInterval = null;
    }

    const bookings = state.bookingCache instanceof Map
        ? Array.from(state.bookingCache.values())
        : (Array.isArray(state.bookingCache) ? state.bookingCache : []);

    if (!bookings || !bookings.length) {
        bannerEl.style.display = "none";
        bannerEl.innerHTML = "";
        return;
    }

    const now = Date.now();
    const cutoffMs = 12 * 60 * 60 * 1000; // 12 hours window

    const activeAndFuture = bookings.filter((b) => {
        const status = (b.status || "").toLowerCase();
        if (status === "canceled" || status === "completed") return false;

        const slotStart = Number(b.slot || b.timeSlot || 0);
        if (!slotStart) return false;
        const durationMinutes = Number(b.durationMinutes || b.slotMinutes || 50);
        const slotEnd = slotStart + durationMinutes * 60 * 1000;
        const accessState = getLessonAccessState(slotStart, now, { lessonMinutes: durationMinutes });

        // Keep the banner on the current lesson only until its real end. The
        // re-entry grace period remains valid from lesson history, but it must
        // not hide a back-to-back lesson that is starting now.
        if (now >= slotStart && now < slotEnd && accessState.canEnter) return true;
        if (slotStart > now && (slotStart - now) <= cutoffMs) return true;

        return false;
    });

    if (!activeAndFuture.length) {
        bannerEl.style.display = "none";
        bannerEl.innerHTML = "";
        return;
    }

    // Sort ascending to get the earliest upcoming booking
    activeAndFuture.sort((a, b) => Number(a.slot || a.timeSlot || 0) - Number(b.slot || b.timeSlot || 0));
    const nextBooking = activeAndFuture[0];
    const slotStart = Number(nextBooking.slot || nextBooking.timeSlot);
    const lessonDurationMinutes = Number(nextBooking.durationMinutes || nextBooking.slotMinutes || 50);
    const slotEnd = slotStart + lessonDurationMinutes * 60 * 1000;

    bannerEl.style.display = "block";

    const updateBannerContent = () => {
        const currentNow = Date.now();
        if (currentNow >= slotEnd) {
            renderTeacherUpcomingLessonBanner();
            return;
        }
        const isLive = currentNow >= slotStart && currentNow < slotEnd;
        const accessState = getLessonAccessState(slotStart, currentNow, { lessonMinutes: lessonDurationMinutes });
        let countdownText = "";
        let pulseClass = "";

        const timezone = getTeacherTimezone();
        const dateStr = new Date(slotStart).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            timeZone: timezone
        });
        const startTimeStr = new Date(slotStart).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: timezone
        });
        const endTimeStr = new Date(slotEnd).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: timezone
        });
        const fullTimeStr = `${startTimeStr} – ${endTimeStr}`;

        const studentName = nextBooking.name || nextBooking.studentName || "Student";
        const studentInitial = (studentName.trim()[0] || "S").toUpperCase();
        const studentEmail = nextBooking.email || nextBooking.studentEmail || "";

        if (isLive) {
            const minsActive = Math.floor((currentNow - slotStart) / 60000);
            countdownText = `🔴 Arabic Lesson with ${escapeHtml(studentName)} is LIVE NOW! Started ${minsActive} min${minsActive === 1 ? "" : "s"} ago.`;
            pulseClass = "pulse-active";
        } else {
            countdownText = `Upcoming lesson with ${escapeHtml(studentName)}: ${getUpcomingRelativeTime(slotStart)}`;
            const timeToStart = slotStart - currentNow;
            if (timeToStart <= 15 * 60 * 1000) {
                pulseClass = "pulse-active";
            }
        }

        bannerEl.innerHTML = `
            <div class="upcoming-banner-card" style="border: 2px solid var(--primary); background: linear-gradient(135deg, #ffffff, #f0fdf4);">
                <div class="upcoming-banner-main" style="display: flex; flex-direction: column; gap: 8px;">
                    <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
                        <div style="width: 46px; height: 46px; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.3rem; border-radius: var(--radius-sm); flex-shrink: 0; box-shadow: 0 4px 12px rgba(15,118,110,0.22);">
                            ${escapeHtml(studentInitial)}
                        </div>
                        <div>
                            <div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: #b91c1c; background: #fef2f2; border: 1px solid #fee2e2; padding: 2px 8px; border-radius: 6px; display: inline-block; margin-bottom: 4px;">
                                ⏰ Next Lesson Notice (Within 12 Hours)
                            </div>
                            <div style="font-weight: 800; font-size: 1.2rem; color: var(--ink); line-height: 1.2;">
                                Student: ${escapeHtml(studentName)} ${studentEmail ? `<span style="font-size: 0.85rem; font-weight: 500; color: var(--muted);">(${escapeHtml(studentEmail)})</span>` : ""}
                            </div>
                        </div>
                    </div>
                    <div>
                        <div class="upcoming-banner-time" style="font-size: 1.12rem; font-weight: 800; color: var(--ink);">${escapeHtml(fullTimeStr)}</div>
                        <div style="font-size: 0.82rem; color: var(--primary); font-weight: 700; margin-top: -2px; text-transform: uppercase; letter-spacing: 0.4px;">${escapeHtml(dateStr)}</div>
                        <div style="font-size: 0.76rem; color: var(--muted); font-weight: 700; margin-top: 2px;">Timezone: ${escapeHtml(timezone)} (${escapeHtml(formatTimezoneGmt(timezone))})</div>
                        <div class="upcoming-banner-countdown" style="margin: 6px 0 12px 0; font-size: 0.92rem; font-weight: 700; color: var(--muted); display: flex; align-items: center; gap: 6px;">
                            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isLive ? '#ef4444' : 'var(--primary)'};"></span>
                            ${countdownText}
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button class="btn upcoming-banner-btn ${pulseClass}" id="teacherBannerJoinBtn" ${accessState.canEnter ? "" : "disabled"} aria-disabled="${accessState.canEnter ? "false" : "true"}">
                            🎓 ${getLessonEntryLabel(accessState)}
                        </button>
                    </div>
                </div>
                <!-- Custom Clock Illustration -->
                <svg width="125" height="125" viewBox="0 0 130 130" fill="none" xmlns="http://www.w3.org/2000/svg" style="align-self: flex-end; margin-left: auto; flex-shrink: 0;">
                    <rect x="25" y="80" width="85" height="40" rx="8" fill="#F59E0B" stroke="var(--ink)" stroke-width="2.5" />
                    <rect x="35" y="105" width="30" height="8" rx="2" fill="#D97706" />
                    <circle cx="80" cy="100" r="6" fill="#0F766E" stroke="var(--ink)" stroke-width="2" />
                    <circle cx="95" cy="100" r="6" fill="#0F766E" stroke="var(--ink)" stroke-width="2" />
                    <rect x="35" y="55" width="60" height="30" rx="6" fill="#C2410C" stroke="var(--ink)" stroke-width="2.5" />
                    <rect x="42" y="60" width="46" height="20" rx="3" fill="#FFFDF9" stroke="var(--ink)" stroke-width="2" />
                    <path d="M65 70 L75 70" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" />
                    <path d="M65 70 L65 63" stroke="#C2410C" stroke-width="2" stroke-linecap="round" />
                    <circle cx="65" cy="70" r="2.5" fill="var(--ink)" />
                    <line x1="45" y1="52" x2="40" y2="58" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <line x1="85" y1="52" x2="90" y2="58" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <circle cx="45" cy="18" r="7" fill="#5F6875" stroke="var(--ink)" stroke-width="2" />
                    <path d="M42 22 L48 28" stroke="var(--ink)" stroke-width="3" />
                    <circle cx="85" cy="18" r="7" fill="#5F6875" stroke="var(--ink)" stroke-width="2" />
                    <path d="M88 22 L82 28" stroke="var(--ink)" stroke-width="3" />
                    <path d="M55 12 H75" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
                    <circle cx="65" cy="35" r="20" fill="#0F766E" stroke="var(--ink)" stroke-width="2.5" />
                    <circle cx="65" cy="35" r="15" fill="#FFFDF9" stroke="var(--ink)" stroke-width="2" />
                    <path d="M65 35 L73 38" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
                    <path d="M65 35 L60 28" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" />
                    <circle cx="65" cy="35" r="2" fill="var(--ink)" />
                </svg>
            </div>
        `;

        const btn = bannerEl.querySelector("#teacherBannerJoinBtn");
        if (accessState.canEnter) {
            btn?.addEventListener("click", () => {
                openClassroomDirectly(nextBooking);
            });
        }
    };

    updateBannerContent();
    teacherUpcomingBannerInterval = setInterval(updateBannerContent, 30000);
}

function updateTeacherOverviewStats() {
    const teacherNameEl = document.getElementById("dashTeacherName");
    const activeStudentsEl = document.getElementById("dashActiveStudentsVal");
    const upcomingBookingsEl = document.getElementById("dashUpcomingBookingsVal");
    const hoursTaughtEl = document.getElementById("dashHoursTaughtVal");
    const ratingEl = document.getElementById("dashRatingVal");

    if (teacherNameEl) {
        teacherNameEl.textContent = state.profileSettings?.teacherName || state.teacherUser?.displayName || "Jaffer";
    }

    const bookingsList = state.bookingCache instanceof Map
        ? Array.from(state.bookingCache.values())
        : (Array.isArray(state.bookingCache) ? state.bookingCache : []);

    const now = Date.now();

    // Active students combines current accounts with unique taught students
    // retained by the existing Preply/platform synchronization history.
    if (activeStudentsEl) {
        activeStudentsEl.textContent = getActiveStudentCount().toLocaleString();
    }

    // 2. Calculate Upcoming Bookings
    if (upcomingBookingsEl) {
        const upcomingCount = bookingsList.filter((b) => {
            const status = String(b.status || "confirmed").toLowerCase();
            return status !== "canceled" && status !== "completed" && !isLessonHistorical(b, now);
        }).length;
        upcomingBookingsEl.textContent = upcomingCount;
    }

    if (hoursTaughtEl) {
        const baseStr = state.profileSettings?.hoursTaught || "1,200+";
        const parsedBase = parseInt(String(baseStr).replace(/[^0-9]/g, ""), 10);
        const totalLessons = Number.isFinite(parsedBase) ? parsedBase : 1200;
        hoursTaughtEl.textContent = `${totalLessons.toLocaleString()}+`;
    }

    // 4. Calculate Average Rating
    if (ratingEl) {
        if (Array.isArray(state.reviews) && state.reviews.length > 0) {
            const sum = state.reviews.reduce((acc, r) => acc + (Number(r.rating) || 5), 0);
            const avg = (sum / state.reviews.length).toFixed(1);
            ratingEl.textContent = avg;
        } else {
            ratingEl.textContent = "5.0";
        }
    }

    // 5. Show cumulative payments received, independent from remaining lesson credit.
    const dashTotalBalanceEl = document.getElementById("dashTotalStudentBalanceVal");
    const headTotalBalanceEl = document.getElementById("teacherTotalStudentBalanceHead");
    const headTotalStudentsEl = document.getElementById("teacherTotalStudentsCount");

    const studentList = Array.isArray(state.studentsCache) && state.studentsCache.length > 0
        ? state.studentsCache
        : Array.from(state.studentCache.values());

    const formattedTotalBalance = formatMoney(Number(state.teacherRevenueTotal ?? 0));

    if (dashTotalBalanceEl) {
        dashTotalBalanceEl.textContent = formattedTotalBalance;
    }
    if (headTotalBalanceEl) {
        headTotalBalanceEl.textContent = formattedTotalBalance;
    }
    if (headTotalStudentsEl) {
        headTotalStudentsEl.textContent = String(studentList.length || 0);
    }

    renderTeacherUpcomingLessonBanner();
    updateSystemSyncStatusIndicator();
}

function parseProfileCounter(value, fallback = 0) {
    const parsed = Number.parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getActiveStudentCount(students = state.studentsCache, statistics = state.teacherCalendarStatistics) {
    const registered = Array.isArray(students) ? students : [];
    const registeredAliases = new Set();
    registered.forEach((student) => [student.id, student.uid, student.email, student.name].forEach((value) => {
        const key = String(value || "").trim().toLowerCase();
        if (key) registeredAliases.add(key);
    }));
    const taught = new Set([
        ...(Array.isArray(statistics?.knownStudentKeys) ? statistics.knownStudentKeys : []),
        ...(Array.isArray(statistics?.knownPlatformStudentKeys) ? statistics.knownPlatformStudentKeys : []),
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
    let externalTaught = 0;
    taught.forEach((key) => { if (!registeredAliases.has(key)) externalTaught += 1; });
    return registered.length + externalTaught;
}

async function syncPublicStudentCounts(students = state.studentsCache) {
    const registeredCount = Array.isArray(students) ? students.length : 0;
    const activeCount = getActiveStudentCount(students);
    const currentRegistered = parseProfileCounter(state.profileSettings?.registeredStudentsCount, -1);
    const currentActive = parseProfileCounter(state.profileSettings?.activeStudentsCount ?? state.profileSettings?.studentsCount, -1);
    if (currentRegistered === registeredCount && currentActive === activeCount) return false;
    state.profileSettings = { ...state.profileSettings, registeredStudentsCount: String(registeredCount), activeStudentsCount: String(activeCount), studentsCount: String(activeCount) };
    await window.db.collection("teacherProfile").doc("primary").set({
        registeredStudentsCount: String(registeredCount), activeStudentsCount: String(activeCount), studentsCount: String(activeCount), studentCountsUpdatedAt: Date.now(),
    }, { merge: true });
    saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
    renderProfileUi();
    return true;
}

function renderPreplyStatisticsSummary(statistics = {}) {
    if (!els.preplyStatsSummary) return;
    const initialized = statistics.initialized === true;
    els.preplyStatsSummary.hidden = false;
    els.preplyStatsSummary.innerHTML = initialized
        ? `
            <strong>Preply automatic statistics active</strong>
            <span>${Number(statistics.processedEventIds?.length || 0)} completed calendar lessons tracked</span>
            <span>${Number(statistics.knownStudentKeys?.length || 0)} unique calendar students recognized</span>
            <span>${Number(statistics.processedPlatformBookingIds?.length || 0)} completed platform lessons tracked</span>
            <span>${Number(statistics.knownPlatformStudentKeys?.length || 0)} unique platform students recognized</span>
            <small>Last sync: ${statistics.lastSyncedAt ? escapeHtml(new Date(statistics.lastSyncedAt).toLocaleString()) : "Not synced yet"}</small>
        `
        : `
            <strong>Preply statistics are not initialized</strong>
            <span>The first sync records existing events as the baseline without increasing your public totals.</span>
        `;
}

async function syncPreplyStatistics() {
    if (!state.teacherUser || state.teacherRole !== "teacher") {
        throw new Error("Teacher login is required.");
    }
    const teacherRef = window.db.collection("teachers").doc(state.teacherUser.uid);
    const teacherSnap = await teacherRef.get();
    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
    const previous = teacherData.calendarStatistics || {};
    const firstSync = previous.initialized !== true;
    const lastSyncedAt = Number(previous.lastSyncedAt || 0);
    const elapsedDays = lastSyncedAt > 0 ? Math.ceil((Date.now() - lastSyncedAt) / (24 * 60 * 60 * 1000)) : 1;
    const lookbackDays = firstSync ? 730 : Math.min(7, Math.max(2, elapsedDays + 1));
    const result = await window.getPreplyStatisticsViaAppsScript?.({ days: lookbackDays });
    if (!result?.success) {
        throw new Error(result?.message || "Could not load Preply calendar statistics.");
    }
    const currentEventIds = Array.isArray(result.eventIds) ? result.eventIds.map(String) : [];
    const currentStudentKeys = Array.isArray(result.studentKeys) ? result.studentKeys.map(String) : [];
    const existingEventIds = new Set(Array.isArray(previous.processedEventIds) ? previous.processedEventIds.map(String) : []);
    const existingStudentKeys = new Set(Array.isArray(previous.knownStudentKeys) ? previous.knownStudentKeys.map(String) : []);
    const newEventIds = firstSync ? [] : currentEventIds.filter((eventId) => !existingEventIds.has(eventId));
    const newStudentKeys = firstSync ? [] : currentStudentKeys.filter((studentKey) => !existingStudentKeys.has(studentKey));
    const currentLessons = parseProfileCounter(state.profileSettings?.hoursTaught, 1200);
    const now = Date.now();
    const calendarStatistics = {
        ...previous,
        initialized: true,
        processedEventIds: Array.from(new Set([...existingEventIds, ...currentEventIds])).slice(-5000),
        knownStudentKeys: Array.from(new Set([...existingStudentKeys, ...currentStudentKeys])).slice(-5000),
        baselineLessons: Number(previous.baselineLessons || currentLessons),
        baselineStudents: Number(previous.baselineStudents || getActiveStudentCount()),
        lessonsAdded: Number(previous.lessonsAdded || 0) + newEventIds.length,
        studentsAdded: Number(previous.studentsAdded || 0) + newStudentKeys.length,
        lastCalendarLessonCount: Number(result.completedLessons || 0),
        lastCalendarStudentCount: Number(result.uniqueStudents || 0),
        lastLookbackDays: lookbackDays,
        lastSyncedAt: now,
    };
    state.teacherCalendarStatistics = calendarStatistics;
    await teacherRef.set({
        calendarStatistics,
        updatedAt: now,
    }, { merge: true });
    await syncPublicStudentCounts();
    if (!firstSync && (newEventIds.length || newStudentKeys.length)) {
        state.profileSettings = {
            ...state.profileSettings,
            hoursTaught: `${currentLessons + newEventIds.length}+`,
            calendarStatsUpdatedAt: now,
        };
        await saveCloudProfileSettings(window.db, state.profileSettings);
        saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
        renderProfileUi();
        updateTeacherOverviewStats();
    }
    renderPreplyStatisticsSummary(calendarStatistics);
    return {
        firstSync,
        newLessons: newEventIds.length,
        newStudents: newStudentKeys.length,
    };
}

async function syncPlatformStatistics() {
    if (!state.teacherUser || state.teacherRole !== "teacher" || !window.db) return null;
    const bookings = state.bookingCache instanceof Map
        ? Array.from(state.bookingCache.entries()).map(([id, booking]) => ({ id, ...(booking || {}) }))
        : [];
    const now = Date.now();
    const completed = bookings.filter((booking) => {
        const status = String(booking.status || "booked").toLowerCase();
        const slot = Number(booking.slot || booking.timeSlot || 0);
        const durationMinutes = Number(booking.durationMinutes || booking.slotMinutes || 50);
        return booking.id && status !== "canceled" && slot > 0 && slot + durationMinutes * 60000 <= now;
    });
    const completedIds = completed.map((booking) => String(booking.id));
    const studentKeys = Array.from(new Set(completed.map((booking) => String(
        booking.studentUid || booking.email || booking.studentEmail || booking.name || ""
    ).trim().toLowerCase()).filter(Boolean)));

    const teacherRef = window.db.collection("teachers").doc(state.teacherUser.uid);
    const teacherSnap = await teacherRef.get();
    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
    const previous = teacherData.calendarStatistics || {};
    const platformInitialized = previous.platformInitialized === true;
    const knownLessonIds = new Set(Array.isArray(previous.processedPlatformBookingIds)
        ? previous.processedPlatformBookingIds.map(String)
        : []);
    const knownStudentKeys = new Set(Array.isArray(previous.knownPlatformStudentKeys)
        ? previous.knownPlatformStudentKeys.map(String)
        : []);
    const newLessonIds = platformInitialized
        ? completedIds.filter((id) => !knownLessonIds.has(id))
        : [];
    const newStudentKeys = platformInitialized
        ? studentKeys.filter((key) => !knownStudentKeys.has(key))
        : [];
    const nextLessonIds = Array.from(new Set([...knownLessonIds, ...completedIds])).slice(-5000);
    const nextStudentKeys = Array.from(new Set([...knownStudentKeys, ...studentKeys])).slice(-5000);
    const unchanged = platformInitialized && !newLessonIds.length && !newStudentKeys.length &&
        nextLessonIds.length === knownLessonIds.size && nextStudentKeys.length === knownStudentKeys.size;
    if (unchanged) return { firstSync: false, newLessons: 0, newStudents: 0 };

    const syncedAt = Date.now();
    const calendarStatistics = {
        ...previous,
        platformInitialized: true,
        processedPlatformBookingIds: nextLessonIds,
        knownPlatformStudentKeys: nextStudentKeys,
        platformLessonsAdded: Number(previous.platformLessonsAdded || 0) + newLessonIds.length,
        platformStudentsAdded: Number(previous.platformStudentsAdded || 0) + newStudentKeys.length,
        lastPlatformLessonCount: completedIds.length,
        lastPlatformStudentCount: studentKeys.length,
        lastPlatformSyncedAt: syncedAt,
    };
    state.teacherCalendarStatistics = calendarStatistics;
    await teacherRef.set({ calendarStatistics, updatedAt: syncedAt }, { merge: true });
    await syncPublicStudentCounts();

    if (newLessonIds.length || newStudentKeys.length) {
        const currentLessons = parseProfileCounter(state.profileSettings?.hoursTaught, 1200);
        state.profileSettings = {
            ...state.profileSettings,
            hoursTaught: `${currentLessons + newLessonIds.length}+`,
            platformStatsUpdatedAt: syncedAt,
        };
        await saveCloudProfileSettings(window.db, state.profileSettings);
        saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
        renderProfileUi();
        updateTeacherOverviewStats();
    }
    renderPreplyStatisticsSummary(calendarStatistics);
    return {
        firstSync: !platformInitialized,
        newLessons: newLessonIds.length,
        newStudents: newStudentKeys.length,
    };
}

function stopPreplyStatisticsAutoSync() {
    if (!state.preplyStatisticsSyncTimer) return;
    window.clearInterval(state.preplyStatisticsSyncTimer);
    state.preplyStatisticsSyncTimer = null;
}

function startPreplyStatisticsAutoSync() {
    stopPreplyStatisticsAutoSync();
    if (!state.teacherUser || state.teacherRole !== "teacher") return;
    state.preplyStatisticsSyncTimer = window.setInterval(() => {
        if (document.hidden || !state.teacherUser || state.teacherRole !== "teacher") return;
        syncPreplyStatistics()
            .then(() => syncPlatformStatistics())
            .catch((error) => {
            console.warn("Automatic completed-lesson statistics sync failed.", error);
        });
    }, 24 * 60 * 60 * 1000);
}

function updateSystemSyncStatusIndicator() {
    const badgeEl = document.getElementById("teacherSystemStatusBadge");
    const dotEl = document.getElementById("teacherStatusDot");
    const textEl = document.getElementById("teacherStatusText");
    if (!badgeEl || !textEl || !dotEl) return;

    const isOnline = typeof navigator !== "undefined" && navigator.onLine !== false;
    const isDbConnected = !!window.db;
    const isAppsScriptSyncOk = state.busySyncReady === true;
    const isGoogleCalendarConnected = state.googleCalendarConnected === true;
    const isCalendarSyncOk = isAppsScriptSyncOk || isGoogleCalendarConnected;

    if (!isOnline || !isDbConnected) {
        badgeEl.style.background = "#fef2f2";
        badgeEl.style.color = "#b91c1c";
        badgeEl.style.borderColor = "#fecaca";
        dotEl.style.background = "#ef4444";
        dotEl.style.boxShadow = "0 0 0 2px rgba(239, 68, 68, 0.25)";
        textEl.textContent = !isOnline ? "🔴 Internet Offline" : "🔴 Backend Connection Down";
        badgeEl.title = "Backend database or network is unreachable. Click to re-test connection.";
        return;
    }

    if (!isCalendarSyncOk) {
        badgeEl.style.background = "#fef3c7";
        badgeEl.style.color = "#b45309";
        badgeEl.style.borderColor = "#fde68a";
        dotEl.style.background = "#f59e0b";
        dotEl.style.boxShadow = "0 0 0 2px rgba(245, 158, 11, 0.25)";
        textEl.textContent = "⚠️ Google Calendar Sync Down";
        badgeEl.title = `Google Calendar sync issue: ${state.busySyncMessage || "Could not reach Google Calendar."}. Click to test & sync now.`;
        return;
    }

    badgeEl.style.background = "#e6f4ea";
    badgeEl.style.color = "#137333";
    badgeEl.style.borderColor = "#ceead6";
    dotEl.style.background = "#34a853";
    dotEl.style.boxShadow = "0 0 0 2px rgba(52, 168, 83, 0.25)";
    textEl.textContent = isAppsScriptSyncOk
        ? "🟢 System & Calendar Sync Online"
        : "🟢 Google Calendar Connected";
    badgeEl.title = isAppsScriptSyncOk
        ? "Backend database and calendar availability sync are connected and active. Click to refresh status."
        : "Google Calendar is connected. Apps Script availability sync is optional and currently unavailable.";
}

if (typeof window !== "undefined") {
    window.addEventListener("online", updateSystemSyncStatusIndicator);
    window.addEventListener("offline", updateSystemSyncStatusIndicator);

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("teacherSystemStatusBadge")?.addEventListener("click", async () => {
            const textEl = document.getElementById("teacherStatusText");
            const dotEl = document.getElementById("teacherStatusDot");
            if (textEl && dotEl) {
                textEl.textContent = "🔄 Checking Connection & Sync...";
                dotEl.style.background = "#3b82f6";
            }
            try {
                await refreshRuntimeBusyBlocks({ force: true });
            } catch (err) {
                console.error("Manual sync check failed:", err);
            }
            updateSystemSyncStatusIndicator();
        });
    });
}

async function refreshTeacherBookings({ reconcile = false, bookingSnapshot = null } = {}) {
    state.bookingCache = await renderTeacherBookings({
        db: window.db,
        teacherBookingList: els.teacherBookingList,
        bookingCache: state.bookingCache,
        escapeHtml,
        formatSlotTime,
        bookingSnapshot,
    });
    renderTeacherWeekCalendar();
    updateTeacherOverviewStats();
    if (reconcile) {
        reconcileStudentBalances().then(async (balanceResult) => {
            if (balanceResult.chargedCount && els.teacherStudentsMsg) {
                setStatus(els.teacherStudentsMsg, `Deducted ${balanceResult.chargedCount} due lesson charge${balanceResult.chargedCount === 1 ? "" : "s"}.`, "success");
                await refreshTeacherStudents();
            } else if (balanceResult.missingPriceCount && els.teacherStudentsMsg) {
                setStatus(els.teacherStudentsMsg, "Some due lessons were not deducted because lesson price is not set.", "error");
            }
        }).catch((error) => console.warn("Background lesson consumption check failed.", error));
    }
}

function renderTeacherWeekCalendar() {
    const grid = document.getElementById("teacherCalendarGrid");
    const rangeLabel = document.getElementById("teacherCalendarRange");
    if (!grid) return;

    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const calendarView = state.teacherCalendarView || "week";
    const periodOffset = Number(state.teacherCalendarWeekOffset || 0);
    const baseDateKey = calendarView === "day"
        ? addDaysToDateKey(getDateKey(new Date(), timezone), periodOffset)
        : getScheduleStartDateKey(periodOffset, timezone);
    const dayCount = calendarView === "day" ? 1 : 7;
    const dayKeys = Array.from({ length: dayCount }, (_, index) => addDaysToDateKey(baseDateKey, index));
    const todayKey = getDateKey(new Date(), timezone);
    const startHour = 0;
    const endHour = 24;
    const pixelsPerMinute = 1;
    const calendarHeight = (endHour - startHour) * 60 * pixelsPerMinute;
    const bookings = state.bookingCache instanceof Map
        ? Array.from(state.bookingCache.values())
        : (Array.isArray(state.bookingCache) ? state.bookingCache : []);
    const eventsByDay = new Map(dayKeys.map((key) => [key, []]));
    const bookingIntervals = [];

    bookings.forEach((booking) => {
        const status = String(booking?.status || "booked").toLowerCase();
        const slot = Number(booking?.slot || 0);
        if (!slot || status === "canceled") return;
        const dateKey = getDateKey(new Date(slot), timezone);
        if (!eventsByDay.has(dateKey)) return;
        const durationMinutes = Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50);
        bookingIntervals.push({
            startMs: slot,
            endMs: slot + durationMinutes * 60000,
        });
        eventsByDay.get(dateKey).push({
            id: booking.id || "",
            startMs: slot,
            durationMinutes,
            label: booking.name || booking.studentName || booking.email || "Student lesson",
            type: booking.isFreeTrial ? "trial" : (booking.source === "teacher" ? "private" : "confirmed"),
            studentTimezone: booking.studentTimeZone || "",
        });
    });

    const busyBlocks = dedupeCalendarMirrors([
        ...(Array.isArray(state.bookingSettings?.exceptions) ? state.bookingSettings.exceptions : []),
        ...(Array.isArray(state.runtimeBusyBlocks) ? state.runtimeBusyBlocks : []),
    ], bookings.map((booking) => booking.id).filter(Boolean));
    busyBlocks.forEach((block) => {
        if (!block) return;
        let startMs = Number(block.startMs || 0);
        let endMs = Number(block.endMs || 0);
        if ((!startMs || !endMs) && block.date && block.start && block.end) {
            const [year, month, day] = String(block.date).split("-").map(Number);
            const startMinutes = String(block.start).split(":").map(Number);
            const endMinutes = String(block.end).split(":").map(Number);
            startMs = zonedDateTimeToUtcMs(timezone, year, month, day, startMinutes[0], startMinutes[1]);
            endMs = zonedDateTimeToUtcMs(timezone, year, month, day, endMinutes[0], endMinutes[1]);
            if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
        }
        if (!startMs || !endMs || endMs <= startMs) return;
        const duplicatesBooking = bookingIntervals.some((booking) => (
            Math.abs(booking.startMs - startMs) < 2 * 60 * 1000
            || (startMs < booking.endMs && endMs > booking.startMs)
        ));
        if (duplicatesBooking) return;
        const dateKey = getDateKey(new Date(startMs), timezone);
        if (!eventsByDay.has(dateKey)) return;
        eventsByDay.get(dateKey).push({
            startMs,
            durationMinutes: Math.max(15, Math.round((endMs - startMs) / 60000)),
            label: block.note || block.summary || "Busy",
            type: "busy",
        });
    });

    const firstDate = new Date(zonedDateTimeToUtcMs(
        timezone,
        ...baseDateKey.split("-").map(Number),
        12,
        0
    ));
    const lastKey = dayKeys[dayKeys.length - 1];
    const lastDate = new Date(zonedDateTimeToUtcMs(
        timezone,
        ...lastKey.split("-").map(Number),
        12,
        0
    ));
    if (rangeLabel) {
        const startLabel = firstDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone });
        const endLabel = lastDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone });
        const studentTimezone = getDisplayTimezone();
        const timezoneLabel = studentTimezone && studentTimezone !== timezone
            ? `${timezone} · Student view: ${studentTimezone}`
            : timezone;
        rangeLabel.textContent = calendarView === "day"
            ? `${startLabel}, ${firstDate.toLocaleDateString("en-US", { year: "numeric", timeZone: timezone })} · ${timezoneLabel}`
            : `${startLabel} – ${endLabel} · ${timezoneLabel}`;
    }

    if (calendarView === "agenda") {
        const agendaItems = dayKeys.flatMap((dateKey) => (
            (eventsByDay.get(dateKey) || []).map((event) => ({ ...event, dateKey }))
        )).sort((a, b) => a.startMs - b.startMs);
        grid.className = "teacher-calendar-grid teacher-calendar-grid--agenda";
        grid.style.gridTemplateColumns = "";
        grid.innerHTML = agendaItems.length
            ? agendaItems.map((event) => {
                const teacherTime = new Date(event.startMs).toLocaleString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: timezone,
                });
                const studentTimezone = event.studentTimezone || getDisplayTimezone();
                const studentTime = studentTimezone !== timezone
                    ? new Date(event.startMs).toLocaleString([], {
                        weekday: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: studentTimezone,
                    })
                    : "";
                const bookingAttribute = event.id ? ` data-calendar-booking-id="${escapeHtml(event.id)}"` : "";
                return `<button type="button" class="teacher-agenda-item is-${event.type}"${bookingAttribute}>
                    <span>${escapeHtml(teacherTime)}</span>
                    <strong>${escapeHtml(event.label)}</strong>
                    ${studentTime ? `<small>Student timezone: ${escapeHtml(studentTime)}</small>` : ""}
                </button>`;
            }).join("")
            : `<div class="teacher-calendar-empty">No lessons or busy times in this period.</div>`;
        return;
    }

    const headerCells = dayKeys.map((dateKey) => {
        const [year, month, day] = dateKey.split("-").map(Number);
        const date = new Date(zonedDateTimeToUtcMs(timezone, year, month, day, 12, 0));
        const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone: timezone });
        return `<div class="teacher-calendar-day-head${dateKey === todayKey ? " is-today" : ""}">
            <span>${escapeHtml(weekday)}</span><strong>${day}</strong>
        </div>`;
    }).join("");

    const timeLabels = Array.from({ length: endHour - startHour + 1 }, (_, index) => {
        const hour = startHour + index;
        const label = new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
        return `<span style="top:${index * 60}px">${escapeHtml(label)}</span>`;
    }).join("");

    const dayColumns = dayKeys.map((dateKey) => {
        const eventHtml = (eventsByDay.get(dateKey) || []).map((event) => {
            const parts = getZonedParts(new Date(event.startMs), timezone);
            const startMinute = parts.hour * 60 + parts.minute;
            const top = Math.max(0, (startMinute - startHour * 60) * pixelsPerMinute);
            const availableHeight = Math.max(0, calendarHeight - top);
            const height = Math.min(Math.max(28, event.durationMinutes * pixelsPerMinute), availableHeight);
            if (top >= calendarHeight || height <= 0) return "";
            const endTime = new Date(event.startMs + event.durationMinutes * 60000);
            const time = `${new Date(event.startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone })}–${endTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: timezone })}`;
            const studentTimezone = event.studentTimezone || "";
            const studentTime = studentTimezone && studentTimezone !== timezone
                ? new Date(event.startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: studentTimezone })
                : "";
            const bookingAttribute = event.id
                ? ` draggable="true" data-calendar-booking-id="${escapeHtml(event.id)}" data-calendar-slot="${event.startMs}"`
                : "";
            return `<button type="button" class="teacher-calendar-event is-${event.type}" style="top:${top}px;height:${height}px"${bookingAttribute}>
                <span>${escapeHtml(time)}</span>
                <strong>${escapeHtml(event.label)}</strong>
                ${studentTime ? `<em>Student: ${escapeHtml(studentTime)}</em>` : ""}
                ${event.id ? `<i class="teacher-calendar-resize-handle" data-calendar-resize title="Drag to change lesson duration"></i>` : ""}
            </button>`;
        }).join("");
        return `<div class="teacher-calendar-day-column${dateKey === todayKey ? " is-today" : ""}" data-calendar-date="${dateKey}" data-calendar-start-hour="${startHour}" data-calendar-end-hour="${endHour}" style="height:${calendarHeight}px">${eventHtml}</div>`;
    }).join("");

    grid.className = `teacher-calendar-grid teacher-calendar-grid--${calendarView}`;
    grid.style.gridTemplateColumns = `64px repeat(${dayCount}, minmax(${calendarView === "day" ? "420px" : "135px"}, 1fr))`;
    grid.innerHTML = `
        <div class="teacher-calendar-head-spacer"></div>
        ${headerCells}
        <div class="teacher-calendar-time-axis" style="height:${calendarHeight}px">${timeLabels}</div>
        ${dayColumns}
    `;
}

function clearTeacherCalendarDropPreview() {
    document.querySelectorAll(".teacher-calendar-day-column.is-drop-target").forEach((column) => {
        column.classList.remove("is-drop-target");
    });
    document.querySelectorAll(".teacher-calendar-drop-preview").forEach((preview) => preview.remove());
}

function getTeacherCalendarDropDetails(column, clientY, booking) {
    const dateKey = column?.dataset.calendarDate || "";
    const startHour = Number(column?.dataset.calendarStartHour || 0);
    const endHour = Number(column?.dataset.calendarEndHour || 24);
    const rect = column?.getBoundingClientRect();
    if (!dateKey || !rect) return null;
    const durationMinutes = Number(
        booking?.durationMinutes
        || booking?.slotMinutes
        || state.bookingSettings?.slotMinutes
        || 50
    );
    const rawMinutes = startHour * 60 + (clientY - rect.top);
    const snappedMinutes = Math.round(rawMinutes / 30) * 30;
    const latestStart = endHour * 60 - durationMinutes;
    const localMinutes = Math.max(startHour * 60, Math.min(latestStart, snappedMinutes));
    const [year, month, day] = dateKey.split("-").map(Number);
    const timezone = state.bookingSettings?.timezone || getTeacherTimezone();
    const slot = zonedDateTimeToUtcMs(
        timezone,
        year,
        month,
        day,
        Math.floor(localMinutes / 60),
        localMinutes % 60
    );
    return {
        slot,
        top: localMinutes - startHour * 60,
        height: Math.max(28, durationMinutes),
        durationMinutes,
    };
}

function showTeacherCalendarDropPreview(column, details) {
    clearTeacherCalendarDropPreview();
    if (!column || !details) return;
    column.classList.add("is-drop-target");
    const preview = document.createElement("div");
    preview.className = "teacher-calendar-drop-preview";
    preview.style.top = `${details.top}px`;
    preview.style.height = `${details.height}px`;
    preview.textContent = new Date(details.slot).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: state.bookingSettings?.timezone || getTeacherTimezone(),
    });
    column.appendChild(preview);
}

function showTeacherCalendarSelectionPreview(column, details, label = "New lesson") {
    document.querySelectorAll(".teacher-calendar-selection-preview").forEach((preview) => preview.remove());
    if (!column || !details) return;
    const preview = document.createElement("div");
    preview.className = "teacher-calendar-selection-preview";
    preview.style.top = `${details.top}px`;
    preview.style.height = `${Math.max(28, details.height)}px`;
    preview.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(new Date(details.slot).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: state.bookingSettings?.timezone || getTeacherTimezone(),
    }))}</strong>`;
    column.appendChild(preview);
    return preview;
}

function clearTeacherCalendarSelectionPreview() {
    document.querySelectorAll(".teacher-calendar-selection-preview").forEach((preview) => preview.remove());
}

async function commitTeacherCalendarMove(dragState, newSlot) {
    if (!dragState?.bookingId || !dragState.booking || !newSlot) return;
    if (newSlot === Number(dragState.booking.slot || 0)) return;
    if (newSlot <= Date.now()) {
        setStatus(els.teacherBookingMsg, "Choose a future time.", "error");
        renderTeacherWeekCalendar();
        return;
    }
    try {
        setAppLoading(true, "Moving lesson...");
        const previousSlot = Number(dragState.booking.slot || 0);
        await rescheduleTeacherBooking(dragState.bookingId, dragState.booking, newSlot);
        await refreshRuntimeBusyBlocks({ force: true });
        await refreshTeacherBookings();
        await renderBookingCalendar();
        setStatus(els.teacherBookingMsg, "Lesson moved. The student schedule and Google Calendar are updated.", "success");
        offerTeacherCalendarUndo(dragState.bookingId, previousSlot);
    } catch (error) {
        renderTeacherWeekCalendar();
        setStatus(els.teacherBookingMsg, error.message || "Could not move the lesson.", "error");
    } finally {
        state.teacherCalendarDrag = {
            ...dragState,
            endedAt: Date.now(),
        };
        setAppLoading(false);
    }
}

function startBalanceReconcileAutoRefresh() {
    if (state.balanceReconcileTimer) return;
    state.balanceReconcileTimer = window.setInterval(() => {
        if (!state.teacherUser || state.teacherRole !== "teacher") return;
        if (document.hidden) return;
        if (state.balanceReconcileInFlight) return;
        state.balanceReconcileInFlight = reconcileStudentBalances()
            .then(async (result) => {
                if (result?.chargedCount) {
                    setStatus(els.teacherStudentsMsg, `Deducted ${result.chargedCount} due lesson charge${result.chargedCount === 1 ? "" : "s"}.`, "success");
                    await refreshTeacherStudents();
                    await refreshTeacherBookings({ reconcile: false });
                }
            })
            .catch(console.error)
            .finally(() => { state.balanceReconcileInFlight = null; });
    }, 2 * 60 * 60 * 1000);
}

function stopBalanceReconcileAutoRefresh() {
    if (!state.balanceReconcileTimer) return;
    window.clearInterval(state.balanceReconcileTimer);
    state.balanceReconcileTimer = null;
}

function resizeImageToDataUrl(file, maxDimension = 300) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith("image/")) {
            return reject(new Error("Selected file is not an image."));
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDimension) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    }
                } else if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                resolve(canvas.toDataURL("image/jpeg", 0.88));
            };
            img.onerror = () => reject(new Error("Failed to process image file."));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsDataURL(file);
    });
}

function updateAvatarPreview(url) {
    const container = document.getElementById("avatarPreviewContainer");
    const img = document.getElementById("avatarPreviewImg");
    if (!container || !img) return;
    const cleanUrl = (url || "").trim();
    if (cleanUrl && (cleanUrl.startsWith("http") || cleanUrl.startsWith("data:image"))) {
        img.src = cleanUrl;
        container.style.display = "flex";
    } else {
        container.style.display = "none";
        img.src = "";
    }
}

function buildProfileVideoHtml(rawUrl) {
    const url = (rawUrl || "").trim();
    if (!url) return "";

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return "";
    }

    const host = parsed.hostname.replace(/^www\./, "");
    let embedUrl = "";

    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
        let videoId = "";
        if (host === "youtu.be") {
            videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
        } else if (parsed.pathname.startsWith("/watch")) {
            videoId = parsed.searchParams.get("v") || "";
        } else if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) {
            videoId = parsed.pathname.split("/").filter(Boolean)[1] || "";
        }
        if (!videoId) return "";
        embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
    } else if (host === "vimeo.com" || host === "player.vimeo.com") {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const videoId = host === "player.vimeo.com" ? parts[1] : parts[0];
        if (!videoId || !/^\d+$/.test(videoId)) return "";
        embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
    } else if (url.match(/\.(mp4|webm|ogg)(\?.*)?$/i)) {
        return `<video src="${escapeHtml(url)}" style="width:100%;height:100%;border:none;border-radius:var(--radius-md);object-fit:cover;" controls playsinline></video>`;
    }

    if (!embedUrl) return "";
    return `<iframe src="${escapeHtml(embedUrl)}" style="width:100%;height:100%;border:none;border-radius:var(--radius-md);" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
}

function normalizeMeetingUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        const url = new URL(raw);
        return url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

function getClassroomMeetingUrl(booking) {
    const bookingUrl = normalizeMeetingUrl(booking?.meetingUrl);
    if (bookingUrl) return bookingUrl;
    const configuredUrl = normalizeMeetingUrl(state.contactSettings?.classroomMeetingUrl);
    if (configuredUrl) return configuredUrl;
    return "";
}

function renderProfileUi() {
    const p = state.profileSettings || createInitialProfileSettings();
    if (els.preplyTeacherName) els.preplyTeacherName.textContent = p.name || "Jaffer";
    if (els.preplyArabicName) els.preplyArabicName.textContent = "";
    if (els.preplyTeacherHeadline) els.preplyTeacherHeadline.textContent = p.headline || "";
    if (els.preplyHoursBadge) els.preplyHoursBadge.textContent = p.hoursTaught || "1,200+";
    if (els.preplyStudentsBadge) els.preplyStudentsBadge.textContent = p.activeStudentsCount ?? p.studentsCount ?? "0";
    if (els.preplyQuoteArabic) els.preplyQuoteArabic.textContent = p.quoteArabic ? `"${p.quoteArabic.replace(/^["'«»]|["'«»]$/g, '')}"` : "";
    if (els.preplyBioText) {
        els.preplyBioText.innerHTML = escapeHtml(p.bioText || "").replace(/\n/g, "<br>");

        // Reset collapsible state to collapsed by default
        els.preplyBioText.style.maxHeight = "180px";
        if (els.preplyBioToggleText) els.preplyBioToggleText.textContent = "Read more";
        if (els.preplyBioToggleChevron) els.preplyBioToggleChevron.style.transform = "rotate(0deg)";
        if (els.bioFadeOverlay) {
            els.bioFadeOverlay.style.opacity = "1";
            els.bioFadeOverlay.style.display = "block";
        }

        // Measure after a small delay to let browser calculate rendering sizes
        setTimeout(() => {
            const isCollapsible = els.preplyBioText.scrollHeight > 185;
            if (els.preplyBioToggleBtn) {
                els.preplyBioToggleBtn.style.display = isCollapsible ? "inline-flex" : "none";
            }
            if (els.bioFadeOverlay) {
                els.bioFadeOverlay.style.display = isCollapsible ? "block" : "none";
            }
        }, 50);
    }
    if (els.preplyRateDisplay) {
        const configuredRateText = String(p.rateText || "").trim();
        els.preplyRateDisplay.textContent = configuredRateText
            ? (/^regular rate\s*:/i.test(configuredRateText) ? configuredRateText : `Regular rate: ${configuredRateText}`)
            : "Rate set by teacher";
    }

    if (els.preplyAvatarContainer) {
        const avatarStr = (p.avatarUrl || "").trim();
        if (avatarStr && (avatarStr.startsWith("http") || avatarStr.startsWith("data:image"))) {
            els.preplyAvatarContainer.innerHTML = `
                <img src="${escapeHtml(avatarStr)}" alt="Teacher Avatar" class="teacher-avatar-img" style="object-fit:cover; width:100%; height:100%; border-radius:50%;" />
                <span class="online-status-badge" title="Online & Available"></span>
            `;
        }
    }
    updateAvatarPreview(p.avatarUrl);

    if (els.preplyVideoContainer && p.videoUrl && p.videoUrl.trim()) {
        const videoHtml = buildProfileVideoHtml(p.videoUrl);
        if (videoHtml) {
            els.preplyVideoContainer.innerHTML = videoHtml;
        } else {
            els.preplyVideoContainer.innerHTML = `
                <div class="video-preview-overlay">
                    <div class="video-preview-text">
                        <strong>Video link not supported</strong>
                        <p>Use a YouTube, Vimeo, or direct MP4/WebM video link.</p>
                    </div>
                </div>
            `;
        }
    }

    if (els.teacherProfileNameInput) els.teacherProfileNameInput.value = p.name || "";
    if (els.teacherProfileRateInput) els.teacherProfileRateInput.value = p.rateText || "";
    if (els.teacherProfileHeadlineInput) els.teacherProfileHeadlineInput.value = p.headline || "";
    if (els.teacherProfileAvatarUrlInput) els.teacherProfileAvatarUrlInput.value = p.avatarUrl || "";
    if (els.teacherProfileVideoUrlInput) els.teacherProfileVideoUrlInput.value = p.videoUrl || "";
    if (els.teacherProfileHoursInput) els.teacherProfileHoursInput.value = p.hoursTaught || "";
    if (els.teacherProfileStudentsInput) els.teacherProfileStudentsInput.value = p.studentsCount || "";
    if (els.teacherProfileQuoteInput) els.teacherProfileQuoteInput.value = p.quoteArabic || "";
    if (els.teacherProfileBioInput) els.teacherProfileBioInput.value = p.bioText || "";
    updateStudentOfferUi();
}

function getReviewTimestamp(r) {
    if (r.createdAt) return r.createdAt;
    if (r.date) {
        const parsed = Date.parse(r.date);
        if (!isNaN(parsed)) return parsed;
    }
    return 0;
}

async function ensureAllReviewsLoaded() {
    if (state.reviewsLoadedAll || !window.db) return state.reviews;
    if (state.reviewsLoadInFlight) return state.reviewsLoadInFlight;
    state.reviewsLoadInFlight = loadCloudReviews(window.db, state.reviews, { limit: 100 })
        .then((reviews) => {
            if (Array.isArray(reviews) && reviews.length) {
                state.reviews = reviews
                    .filter((review) => !["rev-preply-1", "rev-preply-2", "rev-preply-3"].includes(review.id))
                    .sort((a, b) => getReviewTimestamp(b) - getReviewTimestamp(a));
                saveLocalReviews("teacher_reviews_v1", state.reviews);
            }
            state.reviewsLoadedAll = true;
            state.reviewsMayHaveMore = false;
            renderReviewsUi();
            return state.reviews;
        })
        .finally(() => { state.reviewsLoadInFlight = null; });
    return state.reviewsLoadInFlight;
}

async function syncPublicReviewSummary(reviews = state.reviews) {
    const list = Array.isArray(reviews) ? reviews : [];
    const count = list.length;
    const average = count
        ? Math.round((list.reduce((sum, review) => sum + Number(review.rating || 5), 0) / count) * 100) / 100
        : 0;
    const oldCount = Number(state.profileSettings?.reviewsTotalCount || 0);
    const oldAverage = Number(state.profileSettings?.reviewsAverageRating || 0);
    state.profileSettings = { ...state.profileSettings, reviewsTotalCount: count, reviewsAverageRating: average };
    if (oldCount === count && oldAverage === average) return false;
    await window.db.collection("teacherProfile").doc("primary").set({
        reviewsTotalCount: count,
        reviewsAverageRating: average,
        reviewsSummaryUpdatedAt: Date.now(),
    }, { merge: true });
    saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
    return true;
}

function renderReviewsUi() {
    const list = state.reviews || [];
    const loadedCount = list.length;
    const storedTotal = Math.max(0, Number(state.profileSettings?.reviewsTotalCount || 0));
    const count = state.reviewsLoadedAll ? loadedCount : Math.max(loadedCount, storedTotal);
    let totalStars = 0;
    list.forEach(r => { totalStars += Number(r.rating || 5); });
    const storedAverage = Number(state.profileSettings?.reviewsAverageRating || 0);
    const avgScore = !state.reviewsLoadedAll && storedAverage > 0
        ? storedAverage.toFixed(1)
        : loadedCount > 0 ? (totalStars / loadedCount).toFixed(1) : "5.0";

    const hidePublic = !!state.profileSettings?.hideReviewsPublic;
    if (els.studentReviewsSection) {
        els.studentReviewsSection.hidden = hidePublic;
    }
    if (els.togglePublicReviewsBtn) {
        els.togglePublicReviewsBtn.textContent = hidePublic ? "Show Reviews" : "Hide Reviews";
        els.togglePublicReviewsBtn.className = hidePublic ? "btn btn--primary" : "btn btn--outline";
    }

    if (els.preplyReviewCountBadge) els.preplyReviewCountBadge.textContent = String(count);
    if (els.preplyReviewCountHeader) els.preplyReviewCountHeader.textContent = String(count);
    if (els.preplyAverageRatingLabel) els.preplyAverageRatingLabel.textContent = avgScore;
    if (els.preplyAverageScoreText) els.preplyAverageScoreText.textContent = avgScore;
    if (els.teacherReviewsCountLabel) els.teacherReviewsCountLabel.textContent = String(count);

    if (els.preplyReviewsSort) {
        els.preplyReviewsSort.value = state.reviewsSortMode || "newest";
    }

    if (els.preplyReviewsGrid) {
        if (!loadedCount) {
            els.preplyReviewsGrid.innerHTML = `<div class="small-note">No reviews published yet. Be the first to leave a review!</div>`;
        } else {
            const sortedList = [...list];
            if (state.reviewsSortMode === "highest_rated") {
                sortedList.sort((a, b) => {
                    const ratingA = Number(a.rating || 5);
                    const ratingB = Number(b.rating || 5);
                    if (ratingB !== ratingA) return ratingB - ratingA;
                    return getReviewTimestamp(b) - getReviewTimestamp(a);
                });
            } else {
                sortedList.sort((a, b) => getReviewTimestamp(b) - getReviewTimestamp(a));
            }

            const visibleReviews = state.reviewsExpanded ? sortedList : sortedList.slice(0, 6);
            els.preplyReviewsGrid.innerHTML = visibleReviews.map(r => {
                const stars = "⭐".repeat(Math.min(5, Math.max(1, Number(r.rating || 5))));
                const avatarText = escapeHtml(r.avatar || (r.name ? r.name.substring(0, 2).toUpperCase() : "ST"));
                return `
                    <div class="review-item" id="review-${escapeHtml(r.id)}" itemscope itemtype="https://schema.org/Review">
                        <span itemprop="itemReviewed" itemscope itemtype="https://schema.org/Person" hidden>
                            <meta itemprop="name" content="Jaffer" />
                        </span>
                        <div class="review-top">
                            <div class="reviewer-info" itemprop="author" itemscope itemtype="https://schema.org/Person">
                                <span class="reviewer-avatar">${avatarText}</span>
                                <div>
                                    <strong itemprop="name">${escapeHtml(r.name || "Student")}</strong>
                                    <span class="reviewer-country">${escapeHtml(r.country || "🌐 Student")}</span>
                                </div>
                            </div>
                            <span class="review-date">${escapeHtml(r.date || "Recent")}</span>
                        </div>
                        <div class="review-stars" itemprop="reviewRating" itemscope itemtype="https://schema.org/Rating">
                            <meta itemprop="ratingValue" content="${Number(r.rating || 5)}" />
                            <meta itemprop="bestRating" content="5" />
                            <meta itemprop="worstRating" content="1" />
                            ${stars}
                        </div>
                        <p class="review-text" itemprop="reviewBody">"${escapeHtml(r.text || "")}"</p>
                        <span class="review-tag">${escapeHtml(r.tag || "Arabic Lesson")}</span>
                    </div>
                `;
            }).join("");
        }
    }

    if (els.studentReviewsToggleBtn) {
        const hasMoreReviews = count > 6 || state.reviewsMayHaveMore;
        els.studentReviewsToggleBtn.hidden = !hasMoreReviews;
        els.studentReviewsToggleBtn.textContent = state.reviewsExpanded
            ? "Show fewer reviews"
            : (state.reviewsLoadedAll ? `Show all ${count} reviews` : "Show more reviews");
        els.studentReviewsToggleBtn.setAttribute("aria-expanded", state.reviewsExpanded ? "true" : "false");
    }

    if (els.teacherReviewsAdminList) {
        if (!loadedCount) {
            els.teacherReviewsAdminList.innerHTML = `<div class="small-note">No reviews stored yet.</div>`;
        } else {
            els.teacherReviewsAdminList.innerHTML = list.map(r => {
                return `
                    <div class="review-admin-card" data-review-id="${escapeHtml(r.id)}">
                        <div class="review-admin-card__main">
                            <div class="review-admin-card__author">${escapeHtml(r.name || "Student")} (${escapeHtml(r.country || "Country")}) - ⭐ ${Number(r.rating || 5)}/5</div>
                            <div class="review-admin-card__meta">Tag: ${escapeHtml(r.tag || "Lesson")} | Date: ${escapeHtml(r.date || "Recent")}${r.source && !/preply/i.test(r.source) ? " | " + escapeHtml(r.source) : ""}</div>
                            <div class="review-admin-card__text">"${escapeHtml(r.text || "")}"</div>
                        </div>
                        <button type="button" class="btn btn--ghost btn--small" data-action="delete-review" data-id="${escapeHtml(r.id)}">Delete</button>
                    </div>
                `;
            }).join("");
        }
    }
}

function syncStudentReviewUi() {
    if (!els.studentReviewCard || !els.studentReviewForm || !els.studentReviewSuccessBox) return;
    const user = state.currentUser;
    const studentProfile = state.studentProfile || {};
    const hasReviewed = localStorage.getItem(`review_submitted_${user?.uid || user?.email || "guest"}`) === "true" || studentProfile.hasSubmittedReview === true;
    const reviewRequested = studentProfile.reviewRequested === true && !hasReviewed;
    const requestStamp = studentProfile.reviewRequestedAt?.toMillis?.()
        || studentProfile.reviewRequestedAt?.seconds
        || studentProfile.reviewRequestedAt
        || "active";
    const promptSessionKey = `review_prompt_later_${user?.uid || user?.email || "guest"}_${requestStamp}`;
    if (els.studentReviewPrompt) {
        els.studentReviewPrompt.hidden = !reviewRequested || sessionStorage.getItem(promptSessionKey) === "true";
        els.studentReviewPrompt.dataset.sessionKey = promptSessionKey;
    }

    const shouldShowReviewCard = reviewRequested && !hasReviewed;
    els.studentReviewCard.hidden = !shouldShowReviewCard;
    els.studentReviewCard.style.display = shouldShowReviewCard ? "" : "none";

    if (hasReviewed) {
        els.studentReviewForm.hidden = true;
        els.studentReviewSuccessBox.hidden = false;
    } else if (!reviewRequested) {
        els.studentReviewForm.hidden = true;
        els.studentReviewSuccessBox.hidden = false;
        els.studentReviewSuccessBox.innerHTML = `
            <span class="badge-dot"></span>
            <strong>Review not requested yet</strong>
            <p class="small-note">The review form appears here only when the teacher asks you for feedback.</p>
        `;
    } else {
        els.studentReviewForm.hidden = false;
        els.studentReviewSuccessBox.hidden = true;
        els.studentReviewSuccessBox.innerHTML = `
            <span class="badge-dot"></span>
            <strong>Thank you for your feedback!</strong>
            <p class="small-note">Your feedback has been published on the teacher's profile.</p>
        `;
    }
}

function closeStudentLessonsModal() {
    const modal = document.getElementById("studentLessonsModal");
    modal?.classList.remove("modal--open");
    modal?.setAttribute("aria-hidden", "true");
}

function renderStudentLessonRecords(rows, className) {
    if (!rows.length) return '<div class="small-note">No lessons in this section.</div>';
    return rows.map((booking) => {
        const slot = getBookingSlotMs(booking.slot);
        const duration = Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50);
        const dateLabel = slot ? new Date(slot).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: getTeacherTimezone() }) : "Date unavailable";
        const status = String(booking.status || "booked").toLowerCase();
        const detail = booking.isFreeTrial ? "Free trial" : `${duration} minutes · ${status}`;
        const deductions = (Array.isArray(booking.deductions) ? booking.deductions : []).filter((entry) => String(entry.type || "consume") === "consume");
        const ledger = booking.accounting || deductions[0] || null;
        let accounting = "Price: unavailable / legacy";
        if (ledger && Number.isFinite(Number(ledger.amount))) {
            const difference = Number(ledger.defaultPriceAtBooking || 0) - Number(ledger.amount || 0);
            const differenceLabel = difference > 0 ? ` · Discount: ${formatMoney(difference)}` : difference < 0 ? ` · Adjustment: +${formatMoney(Math.abs(difference))}` : "";
            accounting = `Booking ID: ${booking.id} · Lesson deducted: ${Number(ledger.lessonDeducted ?? 1)} · Price: ${formatMoney(ledger.amount)} ${ledger.currency || "USD"} · Pricing: ${ledger.pricingSource || "legacy"}${Number(ledger.defaultPriceAtBooking) > 0 ? ` · Default then: ${formatMoney(ledger.defaultPriceAtBooking)}` : ""}${Number(ledger.customPriceAtBooking) > 0 ? ` · Custom then: ${formatMoney(ledger.customPriceAtBooking)}` : ""}${differenceLabel} · Consumed: ${ledger.createdAt ? new Date(Number(ledger.createdAt)).toLocaleString() : "recorded"}`;
        }
        const deductionAudit = deductions.length
            ? `<small style="color:${deductions.length > 1 ? "#b91c1c" : "#166534"};font-weight:700;">${deductions.length > 1 ? `⚠ Duplicate deduction records: ${deductions.length}` : "Deduction records: 1"} — ${escapeHtml(deductions.map((entry) => `${entry.transactionId || "legacy"}: ${formatMoney(Math.abs(Number(entry.amount || 0)))}`).join(" | "))}</small>`
            : '<small>No deduction transaction found for this lesson.</small>';
        const refundState = booking.consumptionRefundedAt
            ? `<span class="student-lesson-record__refunded">Refunded ${escapeHtml(new Date(Number(booking.consumptionRefundedAt)).toLocaleString())}</span>`
            : (ledger && !booking.isFreeTrial ? `<button type="button" class="btn btn--outline btn--small student-lesson-record__refund" data-refund-booking-id="${escapeHtml(booking.id)}">Refund this deduction</button>` : "");
        return `<article class="student-lesson-record ${className}"><div class="student-lesson-record__heading"><strong>${escapeHtml(dateLabel)}</strong><span class="student-lesson-record__status">${escapeHtml(status)}</span></div><span>${escapeHtml(detail)}</span><dl class="student-lesson-record__details"><div><dt>Booking</dt><dd>${escapeHtml(booking.id)}</dd></div><div><dt>Accounting</dt><dd>${escapeHtml(accounting)}</dd></div></dl>${deductionAudit}${refundState}</article>`;
    }).join("");
}

function renderStudentFinancialHistory(student, ledgerRows = []) {
    const rows = (Array.isArray(student?.transactions) ? student.transactions : []).map((entry) => ({
        id: String(entry.id || ""), at: Number(entry.at || entry.createdAt || 0), amount: Number(entry.amount || 0),
        lessonDelta: Number(entry.lessonCreditAdjustment || 0), description: String(entry.description || "Balance adjustment"),
        balanceAfter: Number.isFinite(Number(entry.newBalance)) ? Number(entry.newBalance) : null,
    }));
    const known = new Set(rows.map((row) => row.id).filter(Boolean));
    ledgerRows.forEach((entry) => {
        const id = String(entry.transactionId || entry.id || "");
        if (!id || known.has(id)) return;
        const isRefund = String(entry.type || "") === "refund";
        rows.push({ id, at: Number(entry.createdAt || entry.at || 0), amount: (isRefund ? 1 : -1) * Math.abs(Number(entry.amount || 0)), lessonDelta: (isRefund ? 1 : -1) * Number(entry.lessonDeducted || 1), description: isRefund ? "Lesson deduction refunded" : "Lesson completed / balance deducted", balanceAfter: null });
    });
    rows.sort((a, b) => b.at - a.at);
    if (!rows.length) return '<div class="small-note">No financial activity recorded yet.</div>';
    return `<div class="student-financial-timeline">${rows.map((row) => {
        const modifier = row.amount > 0 || row.lessonDelta > 0 ? "is-credit" : row.amount < 0 || row.lessonDelta < 0 ? "is-debit" : "is-neutral";
        const money = row.amount ? `${row.amount > 0 ? "+" : "-"}${formatMoney(Math.abs(row.amount))}` : "";
        const lessons = row.lessonDelta ? `${row.lessonDelta > 0 ? "+" : ""}${row.lessonDelta} lesson${Math.abs(row.lessonDelta) === 1 ? "" : "s"}` : "";
        return `<div class="student-financial-entry ${modifier}"><div><strong>${escapeHtml(row.description)}</strong><time>${row.at ? escapeHtml(new Date(row.at).toLocaleString()) : "Date unavailable"}</time></div><div class="student-financial-entry__amount">${escapeHtml([money, lessons].filter(Boolean).join(" · ") || "Recorded")}${row.balanceAfter !== null ? `<small>Balance after: ${escapeHtml(formatMoney(row.balanceAfter))}</small>` : ""}</div></div>`;
    }).join("")}</div>`;
}

async function refundBookingConsumption(studentId, bookingId) {
    const bookingRef = window.db.collection("bookings").doc(bookingId);
    const consumeRef = window.db.collection("lessonBalanceTransactions").doc(`consume_${bookingId}`);
    const refundRef = window.db.collection("lessonBalanceTransactions").doc(`refund_${bookingId}`);
    const userRef = window.db.collection("users").doc(studentId);
    const accountingRef = window.db.collection("studentAccounting").doc(studentId);
    await window.db.runTransaction(async (transaction) => {
        const bookingSnap = await transaction.get(bookingRef);
        const consumeSnap = await transaction.get(consumeRef);
        const refundSnap = await transaction.get(refundRef);
        const userSnap = await transaction.get(userRef);
        const accountingSnap = await transaction.get(accountingRef);
        if (!bookingSnap.exists || !consumeSnap.exists || !userSnap.exists) throw new Error("The lesson deduction record was not found.");
        if (refundSnap.exists || bookingSnap.data()?.consumptionRefundedAt) return;
        const consume = consumeSnap.data() || {};
        if (String(consume.studentUid || "") !== String(studentId)) throw new Error("This deduction belongs to another student.");
        const packageRef = consume.packageId ? window.db.collection("lessonPackageEntitlements").doc(String(consume.packageId)) : null;
        const packageSnap = packageRef ? await transaction.get(packageRef) : null;
        const user = userSnap.data() || {};
        const accounting = accountingSnap.exists ? (accountingSnap.data() || {}) : {};
        const amount = Math.abs(Number(consume.amount || 0));
        const lessonDelta = Math.max(0, Number(consume.lessonDeducted || 0));
        const now = Date.now();
        const nextBalance = toMoneyValue(Number(accounting.balance || 0) + amount);
        const tx = { id: refundRef.id, at: now, amount, type: "refund", description: `Refunded lesson deduction: ${new Date(Number(bookingSnap.data()?.slot || now)).toLocaleString()}`, newBalance: nextBalance, lessonCreditAdjustment: lessonDelta, bookingId };
        transaction.set(accountingRef, { balance: nextBalance, transactions: window.firebase.firestore.FieldValue.arrayUnion(tx), financeUpdatedAt: now, updatedAt: now }, { merge: true });
        if (lessonDelta > 0) transaction.set(userRef, { lessonCredits: Math.max(0, Number(user.lessonCredits || 0)) + lessonDelta, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (packageRef && packageSnap?.exists) {
            const packageData = packageSnap.data() || {};
            transaction.set(packageRef, {
                remainingLessons: Math.min(Number(packageData.totalLessons || Infinity), Number(packageData.remainingLessons || 0) + lessonDelta),
                consumedLessons: Math.max(0, Number(packageData.consumedLessons || 0) - lessonDelta),
                remainingValueCents: Math.max(0, Number(packageData.remainingValueCents || 0) + Math.round(amount * 100)),
                status: "active",
                updatedAt: now,
            }, { merge: true });
        }
        transaction.set(refundRef, { bookingId, studentUid: studentId, amount, lessonDeducted: lessonDelta, type: "refund", originalTransactionId: consumeRef.id, createdAt: now });
        transaction.set(bookingRef, { consumptionRefundedAt: now, consumptionRefundTransactionId: refundRef.id, consumptionState: "refunded", reservationState: "refunded", updatedAt: now }, { merge: true });
    });
}

function getBookingSlotMs(value) {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

async function openStudentLessonsModal(student) {
    const modal = document.getElementById("studentLessonsModal");
    const content = document.getElementById("studentLessonsModalContent");
    const title = document.getElementById("studentLessonsModalTitle");
    const subtitle = document.getElementById("studentLessonsModalSubtitle");
    if (!modal || !content || !student?.id) return;
    title.textContent = `${student.name || "Student"}'s Lessons`;
    subtitle.textContent = student.email || "";
    content.innerHTML = '<div class="small-note">Loading lesson history...</div>';
    modal.classList.add("modal--open");
    modal.setAttribute("aria-hidden", "false");
    try {
        const uidSnapshot = await window.db.collection("bookings").where("studentUid", "==", student.id).limit(200).get();
        const queries = [Promise.resolve(uidSnapshot)];
        if (uidSnapshot.empty && student.email) queries.push(window.db.collection("bookings").where("email", "==", student.email).limit(200).get());
        if (uidSnapshot.empty && !student.email && student.name) queries.push(window.db.collection("bookings").where("name", "==", student.name).limit(200).get());
        const [snapshots, ledgerSnap, accountingSnap] = await Promise.all([
            Promise.all(queries),
            window.db.collection("lessonBalanceTransactions").where("studentUid", "==", student.id).limit(300).get(),
            window.db.collection("studentAccounting").doc(student.id).get(),
        ]);
        const deductionsByBooking = new Map();
        const seenTransactionIds = new Set();
        const addDeduction = (bookingId, entry) => {
            if (!bookingId) return;
            const transactionId = String(entry.transactionId || entry.id || "");
            if (transactionId && seenTransactionIds.has(transactionId)) return;
            if (transactionId) seenTransactionIds.add(transactionId);
            if (!deductionsByBooking.has(bookingId)) deductionsByBooking.set(bookingId, []);
            deductionsByBooking.get(bookingId).push(entry);
        };
        const ledgerRows = [];
        ledgerSnap.forEach((doc) => {
            const row = doc.data() || {};
            ledgerRows.push({ transactionId: doc.id, ...row });
            if (row.bookingId && String(row.type || "consume") === "consume") addDeduction(String(row.bookingId), { transactionId: doc.id, ...row });
        });
        const accountingData = accountingSnap.exists ? (accountingSnap.data() || {}) : {};
        (Array.isArray(student.transactions) ? student.transactions : []).forEach((transaction) => {
            const transactionId = String(transaction?.id || "");
            const inferredBookingId = String(transaction?.bookingId || transactionId.match(/^consume_(.+)$/)?.[1] || transactionId.match(/^tx_(.+)_charge$/)?.[1] || "");
            if (inferredBookingId) addDeduction(inferredBookingId, { transactionId, ...transaction, source: "student-accounting" });
        });
        const rowMap = new Map();
        const normalizedEmail = String(student.email || "").trim().toLowerCase();
        const normalizedName = String(student.name || "").trim().toLowerCase();
        snapshots.forEach((snapshot) => snapshot.forEach((doc) => {
            const row = doc.data() || {};
            const matchesUid = String(row.studentUid || "") === String(student.id);
            const matchesEmail = normalizedEmail && String(row.email || row.studentEmail || "").trim().toLowerCase() === normalizedEmail;
            const matchesLegacyName = !row.studentUid && normalizedName && String(row.name || row.studentName || "").trim().toLowerCase() === normalizedName;
            if (matchesUid || matchesEmail || matchesLegacyName) rowMap.set(doc.id, { id: doc.id, ...row });
        }));
        const now = Date.now();
        const rows = Array.from(rowMap.values()).map((row) => {
            const deductions = deductionsByBooking.get(row.id) || [];
            return { ...row, deductions, accounting: deductions[0] || null };
        }).sort((a, b) => getBookingSlotMs(a.slot) - getBookingSlotMs(b.slot));
        const canceled = rows.filter((row) => String(row.status || "").toLowerCase() === "canceled").reverse();
        const upcoming = rows.filter((row) => {
            const status = String(row.status || "booked").toLowerCase();
            return status !== "canceled" && status !== "completed" && !isLessonHistorical(row, now);
        });
        const taken = rows.filter((row) => {
            const status = String(row.status || "booked").toLowerCase();
            return status !== "canceled" && (status === "completed" || isLessonHistorical(row, now));
        }).reverse();
        const duplicateDeductions = rows.filter((row) => Array.isArray(row.deductions) && row.deductions.length > 1);
        const deductionAuditAlert = duplicateDeductions.length
            ? `<div class="status-line is-error" style="margin-bottom:12px;"><strong>⚠ Duplicate deduction detected</strong><br>${escapeHtml(duplicateDeductions.map((row) => `Booking ${row.id}: ${row.deductions.length} records`).join(" · "))}</div>`
            : '<div class="small-note" style="margin-bottom:12px;">Deduction audit: no booking has more than one unique deduction transaction.</div>';
        content.innerHTML = `
            ${deductionAuditAlert}
            <div class="student-lessons-summary"><div><strong>${upcoming.length}</strong><span>Upcoming</span></div><div><strong>${taken.length}</strong><span>Taken</span></div><div><strong>${canceled.length}</strong><span>Canceled</span></div></div>
            <section class="student-financial-history"><div class="student-financial-history__head"><div><span>Financial record</span><h4>Balance & lesson activity</h4></div><small>Credits, payments, deductions and refunds with their recorded dates.</small></div>${renderStudentFinancialHistory({ ...student, transactions: accountingData.transactions || student.transactions || [] }, ledgerRows)}</section>
            <div class="student-lessons-groups">
                <section class="student-lessons-group"><h4>Upcoming Lessons</h4>${renderStudentLessonRecords(upcoming, "")}</section>
                <section class="student-lessons-group"><h4>Taken Lessons</h4>${renderStudentLessonRecords(taken, "student-lesson-record--taken")}</section>
                <section class="student-lessons-group"><h4>Canceled Lessons</h4>${renderStudentLessonRecords(canceled, "student-lesson-record--canceled")}</section>
            </div>`;
        content.querySelectorAll("[data-refund-booking-id]").forEach((button) => {
            button.addEventListener("click", async () => {
                if (!window.confirm("Return this lesson's money and lesson credit to the student?")) return;
                button.disabled = true;
                button.textContent = "Refunding...";
                try {
                    await refundBookingConsumption(student.id, button.dataset.refundBookingId);
                    await openStudentLessonsModal(state.studentCache.get(student.id) || student);
                    await refreshTeacherStudents();
                } catch (error) {
                    button.disabled = false;
                    button.textContent = "Refund this deduction";
                    window.alert(error.message || "Could not refund this deduction.");
                }
            });
        });
    } catch (error) {
        content.innerHTML = `<div class="status-line is-error">${escapeHtml(error.message || "Could not load lesson history.")}</div>`;
    }
}

function confirmStudentCancellation(booking) {
    const modal = document.getElementById("studentCancelConfirmModal");
    const message = document.getElementById("studentCancelConfirmMessage");
    const charge = document.getElementById("studentCancelConfirmCharge");
    if (!modal || !message || !charge) return Promise.resolve(window.confirm("Cancel this lesson?"));
    const hoursRemaining = (Number(booking?.slot || 0) - Date.now()) / 3600000;
    const lateCharge = booking?.isFreeTrial !== true && hoursRemaining < 12;
    message.textContent = `Lesson scheduled for ${new Date(Number(booking?.slot || 0)).toLocaleString()}.`;
    charge.classList.toggle("is-free", !lateCharge);
    charge.textContent = lateCharge
        ? "Late cancellation: one lesson credit will be deducted. Do you want to continue?"
        : "This cancellation is outside the 12-hour charge window. No lesson credit will be deducted.";
    modal.classList.add("modal--open");
    modal.setAttribute("aria-hidden", "false");
    return new Promise((resolve) => {
        const finish = (answer) => { modal.classList.remove("modal--open"); modal.setAttribute("aria-hidden", "true"); resolve(answer); };
        modal.querySelectorAll("[data-cancel-confirm]").forEach((button) => { button.onclick = () => finish(button.dataset.cancelConfirm === "yes"); });
    });
}

async function refreshTeacherStudents() {
    if (!els.teacherStudentsList) return;
    els.teacherStudentsList.innerHTML = "<div class=\"small-note\">Loading students...</div>";
    state.studentCache.clear();
    try {
        state.teacherStudentsLastRefreshAt = Date.now();
        const privatePricingSnap = await window.db.collection("teacherAccountingSettings").doc("primary").get();
        const storedDefaultPrice = privatePricingSnap.exists ? toMoneyValue(privatePricingSnap.data()?.defaultLessonPrice) : 0;
        if (storedDefaultPrice > 0) state.profileSettings.rateText = `$${storedDefaultPrice}`;
        const configuredDefaultPrice = storedDefaultPrice || getConfiguredLessonPrice();
        if (configuredDefaultPrice > 0 && storedDefaultPrice <= 0) {
            await window.db.collection("teacherAccountingSettings").doc("primary").set({
                defaultLessonPrice: configuredDefaultPrice,
                currency: "USD",
                updatedAt: Date.now(),
            }, { merge: true });
        }
        const migrationMarkerSnap = await window.db.collection("accountingMigration").doc("primary").get();
        const migrationAlreadyComplete = migrationMarkerSnap.exists && migrationMarkerSnap.data()?.complete === true;
        if (!state.privateAccountingMigrated && !migrationAlreadyComplete) {
            await migrateLegacyBookingAccounting();
            state.privateAccountingMigrated = true;
        } else if (migrationAlreadyComplete) {
            state.privateAccountingMigrated = true;
        }
        const [snap, accountingSnap, creditClaimsSnap, futureBookingsSnap] = await Promise.all([
            window.db.collection("users").where("role", "==", "student").get(),
            window.db.collection("studentAccounting").limit(2000).get(),
            window.db.collection("lessonCreditClaims").limit(5000).get(),
            window.db.collection("bookings").where("slot", ">", Date.now()).orderBy("slot", "asc").limit(500).get(),
        ]);
        const accountingByStudent = new Map();
        accountingSnap.forEach((doc) => accountingByStudent.set(doc.id, doc.data() || {}));
        const reservedByStudent = new Map();
        const pendingLateCancellationByStudent = new Map();
        const futureBookingById = new Map();
        futureBookingsSnap.forEach((doc) => futureBookingById.set(doc.id, doc.data() || {}));
        const claimedBookingIds = new Set();
        creditClaimsSnap.forEach((doc) => {
            const claim = doc.data() || {};
            if (!claim.studentUid || claim.state !== "reserved") return;
            if (claim.bookingId) claimedBookingIds.add(claim.bookingId);
            const linkedBooking = claim.bookingId ? futureBookingById.get(claim.bookingId) : null;
            if (linkedBooking && String(linkedBooking.status || "booked").toLowerCase() === "canceled") {
                if (isChargeableLateCancellation(linkedBooking, STUDENT_CHANGE_CUTOFF_MS) && linkedBooking.lessonConsumed !== true && !linkedBooking.balanceChargedAt) {
                    pendingLateCancellationByStudent.set(claim.studentUid, Number(pendingLateCancellationByStudent.get(claim.studentUid) || 0) + 1);
                }
                return;
            }
            reservedByStudent.set(claim.studentUid, Number(reservedByStudent.get(claim.studentUid) || 0) + 1);
        });
        // Compatibility for teacher-created bookings saved before teacher
        // scheduling began creating lessonCreditClaims.
        futureBookingsSnap.forEach((doc) => {
            if (claimedBookingIds.has(doc.id)) return;
            const booking = doc.data() || {};
            if (!booking.studentUid || booking.isFreeTrial === true || String(booking.status || "booked").toLowerCase() === "canceled" || booking.lessonConsumed === true) return;
            reservedByStudent.set(booking.studentUid, Number(reservedByStudent.get(booking.studentUid) || 0) + 1);
        });
        const students = [];
        const migrations = [];
        snap.forEach((doc) => {
            const profile = doc.data() || {};
            const accounting = accountingByStudent.get(doc.id) || {};
            const storedLessonCredits = Math.max(0, Math.floor(Number(accounting.lessonCredits ?? profile.lessonCredits ?? 0)));
            const pendingLateCancellations = Number(pendingLateCancellationByStudent.get(doc.id) || 0);
            const hasLegacyFinance = ["balance", "lessonPrice", "totalPaid", "transactions"].some((key) => Object.prototype.hasOwnProperty.call(profile, key));
            if (hasLegacyFinance) migrations.push({ id: doc.id, profile, accounting });
            students.push({
                id: doc.id,
                ...profile,
                ...accounting,
                lessonCredits: storedLessonCredits,
                displayLessonCredits: Math.max(0, storedLessonCredits - pendingLateCancellations),
                reservedLessons: Number(reservedByStudent.get(doc.id) || 0),
            });
        });
        if (!migrationAlreadyComplete) {
            if (migrations.length) await migrateLegacyStudentAccounting(migrations);
            await window.db.collection("accountingMigration").doc("primary").set({
                complete: true,
                completedAt: Date.now(),
                studentCount: students.length,
                updatedAt: Date.now(),
            }, { merge: true });
        }
        students.sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));
        state.studentsCache = students;
        await syncPublicStudentCounts(students).catch((error) => console.warn("Could not update the public student counts.", error));
        updateTeacherOverviewStats();
        if (!students.length) {
            els.teacherStudentsList.innerHTML = "<div class=\"small-note\">No students yet.</div>";
            return;
        }
        els.teacherStudentsList.innerHTML = students.map((student) => {
            state.studentCache.set(student.id, student);
            const balance = formatMoney(student.balance);
            const lessonPrice = toMoneyValue(student.customLessonPrice);
            const remainingLessons = Math.max(0, Math.floor(Number(student.displayLessonCredits ?? student.lessonCredits ?? 0)));
            const reservedLessons = Math.max(0, Math.floor(Number(student.reservedLessons || 0)));
            const availableLessons = student.allowOverdraft === true ? "Unlimited" : Math.max(0, remainingLessons - reservedLessons);
            const courseAccess = student.courseAccess === true;
            const accessLabel = courseAccess ? "Course: unlocked" : "Course: locked";
            const accessRequested = (student.courseAccessRequested === true || student.paymentStatus === "pending")
                && Number(student.requestedAmount || 0) > 0
                && Number(student.requestedLessons || 0) > 0;
            const requestLabel = accessRequested && !courseAccess ? " | Access requested" : "";
            const requestedPkg = student.requestedPackage || "Lesson Package";
            const requestedAmt = Number(student.requestedAmount || 0);
            const requestedLessons = Number(student.requestedLessons || 0);
            const reviewRequested = student.reviewRequested === true;
            const hasSubmittedReview = student.hasSubmittedReview === true;
            const reviewStatus = hasSubmittedReview
                ? "Review submitted"
                : reviewRequested
                    ? "Review requested"
                    : "Review not requested";
            const trialUsed = student.trialUsed === true;

            return `
                <div class="student-admin-item" data-student-id="${escapeHtml(student.id)}">
                    <button class="student-admin-item__summary" type="button" data-student-action="toggle">
                        <span class="student-admin-item__identity">
                            <span class="student-admin-item__avatar">${escapeHtml(String(student.name || student.email || "S").slice(0, 1).toUpperCase())}</span>
                            <span><strong>${escapeHtml(student.name || "Student")}</strong><span>${escapeHtml(student.email || "")}</span></span>
                        </span>
                        <span class="student-admin-metrics">
                            <span class="student-admin-metric"><small>Available</small><strong>${availableLessons}</strong></span>
                            <span class="student-admin-metric"><small>Reserved</small><strong>${reservedLessons}</strong></span>
                            <span class="student-admin-metric"><small>Balance</small><strong>${balance}</strong></span>
                            <span class="student-admin-metric student-admin-metric--status"><small>Access</small><strong>${accessLabel.replace("Course: ", "")}${requestLabel}</strong></span>
                        </span>
                        <span class="student-admin-item__chevron" aria-hidden="true">⌄</span>
                    </button>
                    <form class="student-admin-editor" data-student-editor hidden>
                        <div class="student-admin-editor__head">
                            <div><strong>Student account</strong><span>${escapeHtml(student.phone || "No phone number")}</span></div>
                            <div class="student-admin-editor__actions">
                                <button class="btn btn--outline btn--small" type="button" data-student-action="send-booking-invitation" data-student-id="${escapeHtml(student.id)}">Send Lesson Invitation</button>
                                <button class="btn btn--outline btn--small" type="button" data-student-action="view-lessons" data-student-id="${escapeHtml(student.id)}">View Lessons & deductions</button>
                            </div>
                        </div>
                        ${accessRequested ? `
                            <div style="background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 10px 12px; border-radius: 8px; font-weight: 600; margin-bottom: 12px; font-size: 0.9rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                                <span>⚡ Payment Request: <strong>${escapeHtml(requestedPkg)}</strong> ${requestedAmt ? `($${requestedAmt})` : ""}</span>
                                <button type="button" class="btn btn--primary btn--small" data-quick-credit="${requestedAmt}" data-package-lessons="${requestedLessons}" data-approve-package="true" data-student-id="${escapeHtml(student.id)}" ${requestedAmt > 0 && requestedLessons > 0 ? "" : "disabled"}>Confirm ${requestedLessons} lessons / ${formatMoney(requestedAmt)}</button>
                            </div>
                        ` : ""}

                        <div class="student-admin-redundant-note" style="margin-bottom: 10px;">
                            <span style="font-size: 0.8rem; font-weight: 700; color: var(--ink-light); display: block; margin-bottom: 4px;">⚡ Quick Add Credit (1-Click):</span>
                            <div class="quick-credit-btn-group">
                                <span class="small-note">Use the balance and lesson-price fields below for manual adjustments.</span>
                            </div>
                        </div>

                        <div style="margin-bottom: 12px; background: #f8fafc; border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                            <span style="font-size: 0.86rem; font-weight: 700; color: var(--ink);">Review status: ${escapeHtml(reviewStatus)}</span>
                            ${hasSubmittedReview ? "" : `
                                <button type="button" class="btn btn--outline btn--small" data-student-action="request-review" data-student-id="${escapeHtml(student.id)}" ${reviewRequested ? "disabled" : ""}>
                                    ${reviewRequested ? "Review Requested" : "Ask for Review"}
                                </button>
                            `}
                        </div>

                        <div class="student-trial-control">
                            <span><strong>Free trial:</strong> ${trialUsed ? "Already used" : "Available"}</span>
                            <button type="button" class="btn btn--outline btn--small" data-student-action="${trialUsed ? "reset-trial" : "mark-trial-used"}" data-student-id="${escapeHtml(student.id)}">
                                ${trialUsed ? "Reset Free Trial" : "Mark Trial as Used"}
                            </button>
                        </div>

                        <div class="student-finance-grid">
                            <label class="field student-finance-card student-finance-card--payment">
                                <span>Payment Received (+$)</span>
                                <input data-student-add-payment type="number" min="0" step="0.01" placeholder="100" />
                                <button class="btn btn--primary btn--small" type="button" data-student-action="add-payment" data-student-id="${escapeHtml(student.id)}">Add Payment</button>
                            </label>
                            <label class="field student-finance-card student-finance-card--refund">
                                <span>Return Credit / Refund (+$)</span>
                                <input data-student-add-refund type="number" min="0" step="0.01" placeholder="10" />
                                <button class="btn btn--outline btn--small" type="button" data-student-action="add-refund" data-student-id="${escapeHtml(student.id)}">Return Credit</button>
                            </label>
                            <label class="field student-finance-card student-finance-card--total">
                                <span>Total Balance ($) — set exact amount</span>
                                <input data-student-balance type="number" step="0.01" value="${escapeHtml(toMoneyValue(student.balance))}" />
                            </label>
                            <label class="field student-finance-card student-finance-card--detail">
                                <span>Custom Lesson Price ($, optional)</span>
                                <input data-student-price type="number" min="0" step="0.01" value="${escapeHtml(lessonPrice)}" />
                                <small>Leave at 0 to use the regular lesson price.</small>
                            </label>
                            <label class="field student-finance-card student-finance-card--detail">
                                <span>Remaining Lessons — set exact number</span>
                                <input data-student-lesson-credits type="number" min="0" step="1" value="${escapeHtml(remainingLessons)}" />
                                <small>${reservedLessons} reserved · ${availableLessons} currently available</small>
                            </label>
                        </div>
                        <div style="display: flex; gap: 24px; margin-bottom: 12px; flex-wrap: wrap;">
                            <label class="field checkbox-field" style="margin: 0; flex: 1; min-width: 200px;">
                                <span>Course Access</span>
                                <label><input data-student-course-access type="checkbox" ${courseAccess ? "checked" : ""} /> Unlock full course for this student</label>
                            </label>
                            <label class="field checkbox-field" style="margin: 0; flex: 1; min-width: 250px;">
                                <span>Overdraft Booking</span>
                                <label><input data-student-allow-overdraft type="checkbox" ${student.allowOverdraft === true ? "checked" : ""} /> Allow booking with 0 or negative balance</label>
                            </label>
                        </div>
                        <div class="inline-fields">
                            <label class="field">
                                <span>Access Type</span>
                                <select data-student-access-type>
                                    <option value="none" ${!courseAccess ? "selected" : ""}>No access</option>
                                    <option value="lifetime" ${student.accessType === "lifetime" ? "selected" : ""}>Lifetime</option>
                                    <option value="trial" ${student.accessType === "trial" ? "selected" : ""}>Trial</option>
                                    <option value="manual" ${student.accessType === "manual" ? "selected" : ""}>Manual</option>
                                </select>
                            </label>
                            <label class="field">
                                <span>Payment Status</span>
                                <select data-student-payment-status>
                                    <option value="none" ${!student.paymentStatus || student.paymentStatus === "none" ? "selected" : ""}>None</option>
                                    <option value="pending" ${student.paymentStatus === "pending" ? "selected" : ""}>Pending</option>
                                    <option value="approved" ${student.paymentStatus === "approved" ? "selected" : ""}>Approved</option>
                                </select>
                            </label>
                            <label class="field">
                                <span>Payment Note</span>
                                <input data-student-payment-note type="text" value="${escapeHtml(student.paymentNote || "")}" placeholder="PayPal email, transaction ID, offer..." />
                            </label>
                        </div>
                        <div class="action-row">
                            <button class="btn btn--primary btn--small" type="submit" data-student-action="save">Save Student</button>
                            <button class="btn btn--ghost btn--small" type="button" data-student-action="delete">Delete Student</button>
                        </div>
                    </form>
                </div>
            `;
        }).join("");
    } catch (error) {
        console.error("Could not load students.", error);
        const permissionHint = error?.code === "permission-denied"
            ? " Deploy the latest firestore.rules first, then reload the teacher dashboard to run the private-accounting migration."
            : "";
        els.teacherStudentsList.innerHTML = `<div class="small-note">Unable to load students.${escapeHtml(permissionHint)}</div>`;
    }
}

async function migrateLegacyBookingAccounting() {
    const snapshot = await window.db.collection("bookings").limit(2000).get();
    const legacy = snapshot.docs.filter((doc) => {
        const row = doc.data() || {};
        return Object.prototype.hasOwnProperty.call(row, "lessonPrice") || Object.prototype.hasOwnProperty.call(row, "chargedAmount") || (row.history || []).some((item) => Object.prototype.hasOwnProperty.call(item || {}, "amount"));
    });
    for (let offset = 0; offset < legacy.length; offset += 150) {
        const batch = window.db.batch();
        legacy.slice(offset, offset + 150).forEach((doc) => {
            const booking = doc.data() || {};
            const effectivePrice = toMoneyValue(booking.lessonPrice || booking.chargedAmount);
            batch.set(window.db.collection("bookingAccounting").doc(doc.id), {
                bookingId: doc.id,
                studentUid: booking.studentUid || "",
                effectivePrice: effectivePrice || null,
                currency: "USD",
                pricingSource: effectivePrice > 0 ? "legacy-snapshot" : "legacy-unavailable",
                defaultPriceAtBooking: null,
                customPriceAtBooking: null,
                capturedAt: Number(booking.createdAt || booking.consumedAt || Date.now()),
                migratedAt: Date.now(),
            }, { merge: true });
            batch.set(doc.ref, {
                lessonPrice: window.firebase.firestore.FieldValue.delete(),
                chargedAmount: window.firebase.firestore.FieldValue.delete(),
                history: Array.isArray(booking.history) ? booking.history.map(({ amount, ...item }) => item) : [],
                updatedAt: Number(booking.updatedAt || Date.now()),
            }, { merge: true });
        });
        await batch.commit();
    }
}

async function migrateLegacyStudentAccounting(records) {
    const financialKeys = ["balance", "lessonPrice", "totalPaid", "transactions", "financeUpdatedAt"];
    for (let offset = 0; offset < records.length; offset += 200) {
        const batch = window.db.batch();
        records.slice(offset, offset + 200).forEach(({ id, profile, accounting }) => {
            const privateData = {
                balance: toMoneyValue(accounting.balance ?? profile.balance),
                customLessonPrice: toMoneyValue(accounting.customLessonPrice ?? profile.lessonPrice),
                totalPaid: toMoneyValue(accounting.totalPaid ?? profile.totalPaid),
                transactions: Array.isArray(accounting.transactions) ? accounting.transactions : (Array.isArray(profile.transactions) ? profile.transactions : []),
                migratedAt: Date.now(),
                updatedAt: Date.now(),
            };
            batch.set(window.db.collection("studentAccounting").doc(id), privateData, { merge: true });
            const publicPatch = {};
            financialKeys.forEach((key) => { if (Object.prototype.hasOwnProperty.call(profile, key)) publicPatch[key] = window.firebase.firestore.FieldValue.delete(); });
            if (!Number.isFinite(Number(profile.lessonCredits))) {
                const price = privateData.customLessonPrice || getConfiguredLessonPrice();
                publicPatch.lessonCredits = price > 0 ? Math.max(0, Math.floor(privateData.balance / price)) : 0;
            }
            publicPatch.updatedAt = window.firebase.firestore.FieldValue.serverTimestamp();
            batch.set(window.db.collection("users").doc(id), publicPatch, { merge: true });
        });
        await batch.commit();
    }
}

async function saveStudentFinance(studentId, balance, lessonPrice, accessData = {}) {
    const userRef = window.db.collection("users").doc(studentId);
    const accountingRef = window.db.collection("studentAccounting").doc(studentId);
    const accountingSnap = await accountingRef.get();
    const userData = accountingSnap.exists ? (accountingSnap.data() || {}) : {};

    const oldBalance = Number(userData.balance || 0);
    const newBalance = toMoneyValue(balance);
    const diff = newBalance - oldBalance;
    const lessonCreditAdjustment = Number.isFinite(Number(accessData.lessonCreditAdjustment))
        ? Math.trunc(Number(accessData.lessonCreditAdjustment))
        : 0;
    const now = Date.now();
    const countsAsPayment = accessData.adjustmentType === "payment";

    const privateUpdate = {
        balance: newBalance,
        customLessonPrice: toMoneyValue(lessonPrice),
        financeUpdatedAt: now,
        updatedAt: now,
    };
    const updateData = {
        courseAccess: accessData.courseAccess === true,
        accessType: accessData.courseAccess ? (accessData.accessType || "lifetime") : "none",
        accessProduct: accessData.courseAccess ? "palestinian-arabic-starter" : "",
        paymentStatus: accessData.paymentStatus || "none",
        paymentNote: (accessData.paymentNote || "").trim().slice(0, 300),
        courseAccessRequested: accessData.courseAccess ? false : accessData.courseAccessRequested === true,
        courseAccessUpdatedAt: now,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (typeof accessData.allowOverdraft !== "undefined") {
        updateData.allowOverdraft = accessData.allowOverdraft === true;
    }

    if (typeof accessData.reviewRequested !== "undefined") {
        updateData.reviewRequested = accessData.reviewRequested === true;
        updateData.reviewRequestedAt = accessData.reviewRequested ? now : null;
    }

    if (Number.isFinite(accessData.lessonCredits)) {
        updateData.lessonCredits = Math.max(0, Math.floor(accessData.lessonCredits));
    }
    if (Number.isFinite(accessData.totalPaid)) {
        privateUpdate.totalPaid = Math.max(0, toMoneyValue(accessData.totalPaid));
    }

    if (diff !== 0 || lessonCreditAdjustment !== 0) {
        const txDesc = diff > 0
            ? `📥 Balance Credited: +$${diff.toFixed(2)}${accessData.paymentNote ? ` (${accessData.paymentNote})` : ""}`
            : diff < 0
                ? `📤 Balance Adjusted: -$${Math.abs(diff).toFixed(2)}`
                : `Lesson credits adjusted: ${lessonCreditAdjustment > 0 ? "+" : ""}${lessonCreditAdjustment}`;

        const tx = {
            id: `tx_${now}_${Math.random().toString(36).substr(2, 5)}`,
            at: now,
            amount: diff,
            type: diff > 0 ? "credit" : diff < 0 ? "charge" : "lesson-credit-adjustment",
            description: txDesc,
            newBalance,
            lessonCreditAdjustment,
            lessonCreditsAfter: Number.isFinite(Number(accessData.lessonCredits))
                ? Math.max(0, Math.floor(Number(accessData.lessonCredits)))
                : null,
        };
        privateUpdate.transactions = window.firebase.firestore.FieldValue.arrayUnion(tx);
    }

    const teacherRef = window.db.collection("teachers").doc(state.teacherUser.uid);
    await window.db.runTransaction(async (transaction) => {
        const teacherSnap = await transaction.get(teacherRef);
        transaction.set(userRef, updateData, { merge: true });
        transaction.set(accountingRef, privateUpdate, { merge: true });
        if (diff !== 0 && countsAsPayment) {
            const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
            const currentRevenue = Number.isFinite(Number(teacherData.revenueTotal))
                ? Number(teacherData.revenueTotal)
                : 0;
            transaction.set(teacherRef, {
                revenueTotal: currentRevenue + diff,
                revenueUpdatedAt: now,
            }, { merge: true });
        }
    });
    if (diff !== 0 && countsAsPayment) {
        state.teacherRevenueTotal = Number(state.teacherRevenueTotal ?? 0) + diff;
    }
    updateTeacherOverviewStats();
}

async function approveStudentPackage(studentId, student, packageLessons, packageAmount) {
    const lessons = Math.max(1, Math.floor(Number(packageLessons || 0)));
    const amount = toMoneyValue(packageAmount);
    if (!studentId || lessons < 1 || amount <= 0) throw new Error("Package lessons and amount are required.");

    const requestAt = Math.max(1, Math.floor(Number(student.courseAccessRequestedAt || Date.now())));
    const packageId = `pkg_${studentId}_${requestAt}`;
    const userRef = window.db.collection("users").doc(studentId);
    const accountingRef = window.db.collection("studentAccounting").doc(studentId);
    const entitlementRef = window.db.collection("lessonPackageEntitlements").doc(packageId);
    const teacherRef = window.db.collection("teachers").doc(state.teacherUser.uid);
    const now = Date.now();
    let alreadyApproved = false;

    await window.db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const accountingSnap = await transaction.get(accountingRef);
        const entitlementSnap = await transaction.get(entitlementRef);
        const teacherSnap = await transaction.get(teacherRef);
        if (!userSnap.exists) throw new Error("Student account was not found.");
        if (entitlementSnap.exists) {
            alreadyApproved = true;
            return;
        }

        const freshStudent = userSnap.data() || {};
        const accounting = accountingSnap.exists ? (accountingSnap.data() || {}) : {};
        const teacher = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
        const oldBalance = toMoneyValue(accounting.balance);
        const newBalance = toMoneyValue(oldBalance + amount);
        const currentCredits = Math.max(0, Math.floor(Number(freshStudent.lessonCredits || 0)));
        const amountPaidCents = Math.round(amount * 100);
        const tx = {
            id: `package_${packageId}`,
            at: now,
            amount,
            type: "package-payment",
            description: `Package approved: ${lessons} lessons for ${formatMoney(amount)}`,
            newBalance,
            lessonCreditAdjustment: lessons,
            lessonCreditsAfter: currentCredits + lessons,
            packageId,
        };

        transaction.set(entitlementRef, {
            packageId,
            studentUid: studentId,
            label: String(student.requestedPackage || `${lessons} lessons`).slice(0, 180),
            totalLessons: lessons,
            remainingLessons: lessons,
            consumedLessons: 0,
            amountPaid: amount,
            amountPaidCents,
            remainingValueCents: amountPaidCents,
            currency: "USD",
            status: "active",
            requestCreatedAt: requestAt,
            createdAt: now,
            updatedAt: now,
        });
        transaction.set(userRef, {
            lessonCredits: currentCredits + lessons,
            courseAccessRequested: false,
            paymentStatus: "approved",
            paymentNote: `Package approved: ${lessons} lessons for ${formatMoney(amount)}`,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(accountingRef, {
            balance: newBalance,
            totalPaid: toMoneyValue(accounting.totalPaid) + amount,
            transactions: window.firebase.firestore.FieldValue.arrayUnion(tx),
            financeUpdatedAt: now,
            updatedAt: now,
        }, { merge: true });
        transaction.set(teacherRef, {
            revenueTotal: toMoneyValue(teacher.revenueTotal) + amount,
            revenueUpdatedAt: now,
        }, { merge: true });
    });

    if (!alreadyApproved) state.teacherRevenueTotal = Number(state.teacherRevenueTotal || 0) + amount;
    updateTeacherOverviewStats();
    return { packageId, alreadyApproved };
}

async function markStudentTrialUsed(studentId) {
    if (!studentId) throw new Error("Choose a student first.");
    await window.db.collection("users").doc(studentId).set({
        trialUsed: true,
        trialUsedAt: Date.now(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}

async function resetStudentFreeTrial(studentId) {
    if (!studentId) throw new Error("Choose a student first.");
    const batch = window.db.batch();
    batch.set(window.db.collection("users").doc(studentId), {
        trialUsed: false,
        trialUsedAt: window.firebase.firestore.FieldValue.delete(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.delete(window.db.collection("trialClaims").doc(studentId));
    await batch.commit();
}

async function deleteStudentProfile(studentId) {
    await window.db.collection("users").doc(studentId).delete();
    state.studentCache.delete(studentId);
}

async function loadBalanceChargeCandidates(now) {
    const docsById = new Map();
    const addDocs = (snap) => {
        snap.forEach((doc) => {
            docsById.set(doc.id, doc);
        });
    };

    try {
        const recentPastCutoff = now - 14 * 24 * 60 * 60 * 1000;
        const pastSnap = await window.db
            .collection("bookings")
            .where("slot", ">=", recentPastCutoff)
            .where("slot", "<=", now)
            .orderBy("slot", "desc")
            .limit(100)
            .get();
        addDocs(pastSnap);
    } catch {
        const fallbackSnap = await window.db
            .collection("bookings")
            .orderBy("slot", "desc")
            .limit(100)
            .get();
        addDocs(fallbackSnap);
    }

    try {
        const canceledSnap = await window.db.collection("bookings")
            .where("status", "==", "canceled")
            .orderBy("slot", "desc")
            .limit(50)
            .get();
        addDocs(canceledSnap);
    } catch {
        try {
            const canceledFallback = await window.db.collection("bookings")
                .where("status", "==", "canceled")
                .limit(50)
                .get();
            addDocs(canceledFallback);
        } catch {
            // The regular query still handles completed lessons if an old
            // deployment temporarily rejects the optional cancellation query.
        }
    }

    return Array.from(docsById.values());
}

async function reconcileStudentBalancesLegacy() {
    const now = Date.now();
    const docs = await loadBalanceChargeCandidates(now);
    let chargedCount = 0;
    const studentDocs = new Map();
    const missingPrice = new Set();
    for (const doc of docs) {
        const booking = doc.data() || {};
        const status = String(booking.status || "booked").toLowerCase();
        if (!booking.studentUid || booking.balanceChargedAt || booking.balanceCharged) continue;
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

        const isFreeTrial = booking.isFreeTrial === true;
        const lessonPrice = isFreeTrial ? 0 : toMoneyValue(booking.lessonPrice || student.lessonPrice);

        if (lessonPrice === 0 && !isFreeTrial) {
            missingPrice.add(booking.studentUid);
            continue;
        }

        const chargeReason = isFreeTrial ? "free-trial" : (lateCanceled ? "late-cancel" : "lesson");
        const lessonDateStr = new Date(booking.slot).toLocaleDateString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit" });

        const txDesc = isFreeTrial
            ? `🎁 First Free Lesson: ${lessonDateStr}`
            : (lateCanceled ? `❌ Late cancellation charge: ${lessonDateStr}` : `Lesson deduction: ${lessonDateStr}`);

        const tx = {
            id: `tx_${doc.id}_charge`,
            at: now,
            amount: -lessonPrice,
            type: isFreeTrial ? "trial" : (lateCanceled ? "late-cancel" : "charge"),
            description: txDesc,
            newBalance: toMoneyValue(student.balance) - lessonPrice
        };

        const batch = window.db.batch();
        const remainingLessonCredits = isFreeTrial
            ? Number(student.lessonCredits || 0)
            : Math.max(0, Number(student.lessonCredits || 0) - 1);
        const studentChargeUpdate = {
            balance: toMoneyValue(student.balance) - lessonPrice,
            transactions: window.firebase.firestore.FieldValue.arrayUnion(tx),
            financeUpdatedAt: now,
            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        };
        if (Object.prototype.hasOwnProperty.call(student, "lessonCredits")) {
            studentChargeUpdate.lessonCredits = remainingLessonCredits;
        }
        batch.set(window.db.collection("users").doc(booking.studentUid), studentChargeUpdate, { merge: true });
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
            data: () => ({
                ...student,
                balance: toMoneyValue(student.balance) - lessonPrice,
                lessonCredits: remainingLessonCredits,
                transactions: [...(student.transactions || []), tx]
            }),
        });
        chargedCount += 1;
    }
    return { chargedCount, missingPriceCount: missingPrice.size };
}

async function reconcileStudentBalances(priorityBookingIds = []) {
    const docs = await loadBalanceChargeCandidates(Date.now());
    const docsById = new Map(docs.map((doc) => [doc.id, doc]));
    for (const bookingId of priorityBookingIds) {
        if (!bookingId || docsById.has(bookingId)) continue;
        const priorityDoc = await window.db.collection("bookings").doc(bookingId).get();
        if (priorityDoc.exists) {
            docs.push(priorityDoc);
            docsById.set(priorityDoc.id, priorityDoc);
        }
    }
    let chargedCount = 0;
    const missingPrice = new Set();
    for (const doc of docs) {
        const initialBooking = doc.data() || {};
        const initialStatus = String(initialBooking.status || "booked").toLowerCase();
        const lessonEndAt = getLessonEndAt(initialBooking);
        const initialLateCancellation = isChargeableLateCancellation(initialBooking, STUDENT_CHANGE_CUTOFF_MS);
        if (!initialBooking.studentUid || (initialStatus === "canceled" && !initialLateCancellation) || (!initialLateCancellation && initialStatus !== "completed" && lessonEndAt > Date.now())) continue;

        const bookingRef = window.db.collection("bookings").doc(doc.id);
        const userRef = window.db.collection("users").doc(initialBooking.studentUid);
        const studentAccountingRef = window.db.collection("studentAccounting").doc(initialBooking.studentUid);
        const bookingAccountingRef = window.db.collection("bookingAccounting").doc(doc.id);
        const ledgerRef = window.db.collection("lessonBalanceTransactions").doc(`consume_${doc.id}`);
        const existingLedger = await ledgerRef.get();
        if (existingLedger.exists) continue;
        let claimRefs = [];
        if (initialBooking.reservationClaimId) {
            claimRefs = [window.db.collection("lessonCreditClaims").doc(initialBooking.reservationClaimId)];
        } else {
            const claims = await window.db.collection("lessonCreditClaims")
                .where("studentUid", "==", initialBooking.studentUid)
                .where("bookingId", "==", doc.id)
                .limit(5)
                .get();
            claimRefs = claims.docs.map((claimDoc) => claimDoc.ref);
        }
        const packageEntitlementSnap = initialBooking.isFreeTrial === true
            ? null
            : await window.db.collection("lessonPackageEntitlements")
                .where("studentUid", "==", initialBooking.studentUid)
                .limit(50)
                .get();
        const packageRefs = packageEntitlementSnap
            ? packageEntitlementSnap.docs
                .sort((a, b) => Number(a.data()?.createdAt || 0) - Number(b.data()?.createdAt || 0))
                .map((packageDoc) => packageDoc.ref)
            : [];

        let consumed = false;
        let missingLessonPrice = false;
        await window.db.runTransaction(async (transaction) => {
            const bookingSnap = await transaction.get(bookingRef);
            const ledgerSnap = await transaction.get(ledgerRef);
            const studentSnap = await transaction.get(userRef);
            const studentAccountingSnap = await transaction.get(studentAccountingRef);
            const bookingAccountingSnap = await transaction.get(bookingAccountingRef);
            const claimSnaps = [];
            for (const claimRef of claimRefs) claimSnaps.push(await transaction.get(claimRef));
            const packageSnaps = [];
            for (const packageRef of packageRefs) packageSnaps.push(await transaction.get(packageRef));
            if (!bookingSnap.exists || ledgerSnap.exists || !studentSnap.exists) return;

            const booking = bookingSnap.data() || {};
            if (!shouldConsumeLesson(booking, Date.now(), ledgerSnap.exists)) return;
            const lateCancellation = isChargeableLateCancellation(booking, STUDENT_CHANGE_CUTOFF_MS);

            const student = studentSnap.data() || {};
            const studentAccounting = studentAccountingSnap.exists ? (studentAccountingSnap.data() || {}) : {};
            const priceSnapshot = bookingAccountingSnap.exists ? (bookingAccountingSnap.data() || {}) : {};
            const isFreeTrial = booking.isFreeTrial === true;
            let lessonPrice = isFreeTrial ? 0 : toMoneyValue(priceSnapshot.effectivePrice);
            let packageEntitlement = null;
            let packageEntitlementRef = null;
            if (!isFreeTrial) {
                const packageIndex = packageSnaps.findIndex((packageSnap) => {
                    if (!packageSnap.exists) return false;
                    const value = packageSnap.data() || {};
                    return String(value.status || "active") === "active" && Number(value.remainingLessons || 0) > 0;
                });
                if (packageIndex >= 0) {
                    packageEntitlement = packageSnaps[packageIndex].data() || {};
                    packageEntitlementRef = packageRefs[packageIndex];
                    lessonPrice = getPackageLessonChargeCents(
                        packageEntitlement.amountPaidCents,
                        packageEntitlement.totalLessons,
                        packageEntitlement.consumedLessons
                    ) / 100;
                }
            }
            if (!isFreeTrial && lessonPrice <= 0) {
                missingLessonPrice = true;
                return;
            }

            const consumedAt = Date.now();
            const nextBalance = toMoneyValue(studentAccounting.balance) - lessonPrice;
            const balanceTransaction = {
                id: ledgerRef.id,
                at: consumedAt,
                amount: -lessonPrice,
                type: isFreeTrial ? "trial" : (lateCancellation ? "late-cancel" : "charge"),
                description: isFreeTrial ? "First free lesson" : (lateCancellation ? `Late cancellation deduction: ${new Date(booking.slot).toLocaleString()}` : `Lesson deduction: ${new Date(booking.slot).toLocaleString()}`),
                newBalance: nextBalance,
                bookingId: doc.id,
                packageId: packageEntitlement?.packageId || null,
            };
            const accountingUpdate = {
                balance: nextBalance,
                transactions: window.firebase.firestore.FieldValue.arrayUnion(balanceTransaction),
                financeUpdatedAt: consumedAt,
                updatedAt: consumedAt,
            };
            const studentUpdate = { updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() };
            if (Object.prototype.hasOwnProperty.call(student, "lessonCredits") && !isFreeTrial) {
                studentUpdate.lessonCredits = Math.max(0, Number(student.lessonCredits || 0) - 1);
            }
            transaction.set(userRef, studentUpdate, { merge: true });
            transaction.set(studentAccountingRef, accountingUpdate, { merge: true });
            if (packageEntitlementRef && packageEntitlement) {
                const chargeCents = Math.round(lessonPrice * 100);
                const nextRemainingLessons = Math.max(0, Number(packageEntitlement.remainingLessons || 0) - 1);
                transaction.set(packageEntitlementRef, {
                    remainingLessons: nextRemainingLessons,
                    consumedLessons: Math.min(Number(packageEntitlement.totalLessons || 0), Number(packageEntitlement.consumedLessons || 0) + 1),
                    remainingValueCents: Math.max(0, Number(packageEntitlement.remainingValueCents || 0) - chargeCents),
                    status: nextRemainingLessons > 0 ? "active" : "consumed",
                    updatedAt: consumedAt,
                }, { merge: true });
                transaction.set(bookingAccountingRef, {
                    bookingId: doc.id,
                    studentUid: booking.studentUid,
                    effectivePrice: lessonPrice,
                    currency: "USD",
                    pricingSource: "package",
                    packageId: packageEntitlement.packageId || packageEntitlementRef.id,
                    packageTotalLessons: Number(packageEntitlement.totalLessons || 0),
                    packageAmountPaid: toMoneyValue(Number(packageEntitlement.amountPaidCents || 0) / 100),
                    capturedAt: consumedAt,
                }, { merge: true });
            }
            transaction.set(bookingRef, {
                lessonConsumed: true,
                consumedAt,
                balanceChargedAt: consumedAt,
                chargeReason: isFreeTrial ? "free-trial" : (lateCancellation ? "late-cancel" : "lesson"),
                balanceTransactionId: ledgerRef.id,
                reservationState: "consumed",
                updatedAt: consumedAt,
                history: window.firebase.firestore.FieldValue.arrayUnion({
                    at: consumedAt,
                    action: lateCancellation ? "late-cancellation-consumed" : "lesson-consumed",
                    by: "teacher",
                }),
            }, { merge: true });
            transaction.set(ledgerRef, {
                bookingId: doc.id,
                studentUid: booking.studentUid,
                amount: lessonPrice,
                currency: priceSnapshot.currency || "USD",
                pricingSource: packageEntitlement ? "package" : (priceSnapshot.pricingSource || (isFreeTrial ? "free-trial" : "legacy-unavailable")),
                packageId: packageEntitlement?.packageId || null,
                defaultPriceAtBooking: priceSnapshot.defaultPriceAtBooking ?? null,
                customPriceAtBooking: priceSnapshot.customPriceAtBooking ?? null,
                priceSnapshotCapturedAt: priceSnapshot.capturedAt || 0,
                lessonDeducted: isFreeTrial ? 0 : 1,
                type: "consume",
                createdAt: consumedAt,
            });
            claimRefs.forEach((claimRef, index) => {
                if (claimSnaps[index]?.exists) transaction.delete(claimRef);
            });
            // Past interval claims use absolute timestamps and cannot block a
            // future booking. Keep them to avoid 10+ unnecessary deletes for
            // every completed lesson. Cancel/reschedule still releases claims.
            consumed = true;
        });
        if (missingLessonPrice) missingPrice.add(initialBooking.studentUid);
        if (consumed) chargedCount += 1;
    }
    return { chargedCount, missingPriceCount: missingPrice.size };
}

function updateEmailQuotaUi(result) {
    if (!els.appsScriptEmailQuota || !els.appsScriptEmailQuotaValue) return;
    if (!result?.success || !Number.isFinite(Number(result.emailQuotaRemaining))) {
        els.appsScriptEmailQuota.hidden = false;
        els.appsScriptEmailQuotaValue.textContent = "Unavailable";
        els.appsScriptEmailQuota.title = result?.message || "Connect and test Apps Script to load the email quota.";
        return;
    }
    els.appsScriptEmailQuota.hidden = false;
    els.appsScriptEmailQuotaValue.textContent = String(Number(result.emailQuotaRemaining));
    els.appsScriptEmailQuota.title = result?.resetWindow || "Remaining daily email recipients reported by Google Apps Script.";
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
    const persistentConnected = state.busySyncReady === true;
    let browserConnected = false;
    if (!persistentConnected) {
        await ensureGoogleCalendarModuleLoaded();
        browserConnected = await window.isGoogleCalendarConnected?.();
    }
    const connected = persistentConnected || browserConnected === true;
    state.googleCalendarConnected = connected;
    const base = persistentConnected
        ? "Google Calendar is connected through the persistent Apps Script integration."
        : browserConnected
            ? "Google Calendar browser authorization is connected."
            : "Google Calendar is not connected.";
    setStatus(els.googleCalendarStatus, [base, state.googleCalendarMessage].filter(Boolean).join(" "));
    updateSystemSyncStatusIndicator();
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
    els.teacherForgotPasswordBtn?.addEventListener("click", async (event) => {
        try {
            await sendPasswordResetLink({
                emailInput: els.teacherEmail,
                statusElement: els.teacherLoginMsg,
                button: event.currentTarget,
            });
        } catch (error) {
            setStatus(els.teacherLoginMsg, error.message || "Could not send password reset email.", "error");
        }
    });

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

    els.teacherProfileForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await withButtonLoading(els.saveTeacherProfileBtn, "Saving...", async () => {
                const updated = {
                    ...state.profileSettings,
                    name: (els.teacherProfileNameInput?.value || "").trim() || "Jaffer",
                    headline: (els.teacherProfileHeadlineInput?.value || "").trim(),
                    rateText: (els.teacherProfileRateInput?.value || "").trim(),
                    avatarUrl: (els.teacherProfileAvatarUrlInput?.value || "").trim(),
                    videoUrl: (els.teacherProfileVideoUrlInput?.value || "").trim(),
                    hoursTaught: (els.teacherProfileHoursInput?.value || "").trim() || "1,200+",
                    studentsCount: (els.teacherProfileStudentsInput?.value || "").trim() || "85+",
                    quoteArabic: (els.teacherProfileQuoteInput?.value || "").trim(),
                    bioText: (els.teacherProfileBioInput?.value || "").trim(),
                };
                state.profileSettings = updated;
                saveLocalProfileSettings("teacher_profile_v1", updated);
                await saveCloudProfileSettings(window.db, updated);
                const defaultLessonPrice = toMoneyValue(String(updated.rateText || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0]);
                if (defaultLessonPrice > 0) {
                    await window.db.collection("teacherAccountingSettings").doc("primary").set({
                        defaultLessonPrice,
                        currency: "USD",
                        updatedAt: Date.now(),
                    }, { merge: true });
                }
                renderProfileUi();
                updateStudentOfferUi();
                setStatus(els.teacherProfileMsg, "Profile settings saved successfully!", "success");
            });
        } catch (error) {
            setStatus(els.teacherProfileMsg, error.message || "Could not save profile settings.", "error");
        }
    });

    els.teacherProfileAvatarFileInput?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            setStatus(els.teacherProfileMsg, "Optimizing image...", "");
            const dataUrl = await resizeImageToDataUrl(file, 300);
            if (els.teacherProfileAvatarUrlInput) {
                els.teacherProfileAvatarUrlInput.value = dataUrl;
            }
            updateAvatarPreview(dataUrl);
            setStatus(els.teacherProfileMsg, "Image ready! Click 'Save Profile Settings' to apply.", "success");
        } catch (err) {
            setStatus(els.teacherProfileMsg, err.message || "Could not process image.", "error");
        }
    });

    els.teacherProfileAvatarUrlInput?.addEventListener("input", (e) => {
        updateAvatarPreview(e.target.value);
    });

    document.getElementById("removeAvatarBtn")?.addEventListener("click", () => {
        if (els.teacherProfileAvatarUrlInput) els.teacherProfileAvatarUrlInput.value = "";
        if (els.teacherProfileAvatarFileInput) els.teacherProfileAvatarFileInput.value = "";
        updateAvatarPreview("");
        setStatus(els.teacherProfileMsg, "Image removed. Click 'Save Profile Settings' to revert to default avatar.", "success");
    });

    els.togglePublicReviewsBtn?.addEventListener("click", async () => {
        if (!state.profileSettings) {
            state.profileSettings = createInitialProfileSettings();
        }
        const newVal = !state.profileSettings.hideReviewsPublic;
        state.profileSettings.hideReviewsPublic = newVal;
        saveLocalProfileSettings("teacher_profile_v1", state.profileSettings);
        try {
            await saveCloudProfileSettings(window.db, state.profileSettings);
        } catch (err) {
            console.error("Could not save public reviews visibility setting to cloud", err);
        }
        renderReviewsUi();
    });

    const syncPreplyReviews = async (rebuild = false) => {
        const result = await window.getPreplyReviewsViaAppsScript?.();
        if (!result?.success || !Array.isArray(result.reviews)) throw new Error(result?.message || "Could not load Preply reviews.");
        const snapshot = await window.db.collection("reviews").limit(200).get();
        const existingById = new Map(snapshot.docs.map((doc) => [doc.id, doc.data() || {}]));
        const incomingIds = new Set(result.reviews.map((review) => review.id));
        const batch = window.db.batch();
        let writeCount = 0;
        let newCount = 0;
        let updatedCount = 0;
        let removedCount = 0;
        snapshot.docs.forEach((doc) => {
            const source = String((doc.data() || {}).source || "");
            const isLegacyPreplyReview = /^(?:jaffer-preply-|rev-preply-)/i.test(doc.id);
            const isMissingCurrentPreplyReview = source === "Preply" && !incomingIds.has(doc.id);
            if (isLegacyPreplyReview || (rebuild && isMissingCurrentPreplyReview)) {
                batch.delete(doc.ref);
                writeCount += 1;
                removedCount += 1;
            }
        });
        result.reviews.forEach((review) => {
            const existing = existingById.get(review.id);
            const comparable = (value = {}) => JSON.stringify([value.name, value.rating, value.date, value.text, value.source, value.createdAt, value.preplyOrder]);
            if (rebuild || !existing || comparable(existing) !== comparable(review)) {
                batch.set(window.db.collection("reviews").doc(review.id), review);
                writeCount += 1;
                if (existing) updatedCount += 1;
                else newCount += 1;
            }
        });
        if (writeCount) await batch.commit();
        const websiteReviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((review) => review.source === "Student Review");
        state.reviews = [...result.reviews, ...websiteReviews];
        saveLocalReviews("teacher_reviews_v1", state.reviews);
        await syncPublicReviewSummary(state.reviews);
        renderReviewsUi();
        return { total: result.reviews.length, writes: writeCount, newCount, updatedCount, removedCount };
    };

    els.syncPreplyReviewsBtn?.addEventListener("click", async (event) => {
        try {
            await withButtonLoading(event.currentTarget, "Syncing...", async () => {
                const summary = await syncPreplyReviews(false);
                const message = summary.writes
                    ? `${summary.newCount} new, ${summary.updatedCount} updated, and ${summary.removedCount} duplicate/old reviews removed. ${summary.total} total on Preply.`
                    : `Already up to date. ${summary.total} Preply reviews; no Firebase writes needed.`;
                setStatus(els.preplyReviewsSyncMsg, message, "success");
            });
        } catch (error) {
            setStatus(els.preplyReviewsSyncMsg, error.message || "Could not sync Preply reviews.", "error");
        }
    });

    els.rebuildPreplyReviewsBtn?.addEventListener("click", async (event) => {
        if (!window.confirm("Rebuild all Preply reviews from the source? Website-submitted reviews will be preserved.")) return;
        try {
            await withButtonLoading(event.currentTarget, "Rebuilding...", async () => {
                const summary = await syncPreplyReviews(true);
                setStatus(els.preplyReviewsSyncMsg, `${summary.total} Preply reviews rebuilt successfully.`, "success");
            });
        } catch (error) {
            setStatus(els.preplyReviewsSyncMsg, error.message || "Could not rebuild Preply reviews.", "error");
        }
    });

    els.toggleAdminReviewsListBtn?.addEventListener("click", () => {
        const list = document.getElementById("teacherReviewsAdminList");
        if (!list) return;
        const isHidden = list.style.display === "none";
        list.style.display = isHidden ? "" : "none";
        els.toggleAdminReviewsListBtn.textContent = isHidden ? "Hide List" : "Show List";
        els.toggleAdminReviewsListBtn.className = isHidden ? "btn btn--ghost btn--small" : "btn btn--primary btn--small";
    });

    els.teacherReviewsAdminList?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-action='delete-review']");
        if (!button) return;
        const reviewId = button.getAttribute("data-id");
        if (!reviewId) return;
        if (!window.confirm("Are you sure you want to delete this review?")) return;

        try {
            await withButtonLoading(button, "...", async () => {
                await deleteReviewFromCloud(window.db, reviewId);
                state.reviews = state.reviews.filter(r => r.id !== reviewId);
                saveLocalReviews("teacher_reviews_v1", state.reviews);
                await syncPublicReviewSummary(state.reviews);
                renderReviewsUi();
            });
        } catch (error) {
            console.error("Failed to delete review:", error);
        }
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

    els.courseOffersForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            await withButtonLoading(event.submitter, "Saving...", saveCourseOffers);
        } catch (error) {
            setStatus(els.courseOffersMsg, error.message || "Could not save course offers.", "error");
        }
    });

    els.teacherAddPackageBtn?.addEventListener("click", () => {
        const current = gatherPackagesFromUi();
        const newId = `pkg-${Date.now()}`;
        current.push({
            id: newId,
            badge: "New Promo",
            lessons: 10,
            price: Math.max(0.01, Number(state.bookingSettings.courseOffers?.courseAccessPrice || 0)),
            popular: current.length === 0
        });
        state.bookingSettings.courseOffers.packages = current;
        renderTeacherPackagesUi();
    });

    els.teacherPackagesForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const submitter = event.submitter || event.target.querySelector("button[type='submit']");
            await withButtonLoading(submitter, "Saving...", async () => {
                await saveTeacherPackages();
            });
            setStatus(els.teacherPackagesMsg, "Lesson packages saved and published on the main page.", "success");
        } catch (error) {
            setStatus(els.teacherPackagesMsg, error.message || "Could not save lesson packages.", "error");
        }
    });

    els.contactSettingsForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                state.contactSettings.whatsapp = (els.teacherWhatsapp?.value || "").trim();
                state.contactSettings.email = (els.teacherContactEmail?.value || "").trim();
                const rawMeetingUrl = (els.teacherClassroomMeetingUrl?.value || "").trim();
                const meetingUrl = normalizeMeetingUrl(rawMeetingUrl);
                if (rawMeetingUrl && !meetingUrl) {
                    throw new Error("Use a valid https meeting link.");
                }
                state.contactSettings.classroomMeetingUrl = meetingUrl;
                await saveTeacherContactSettings();
            });
            setStatus(els.contactMsg, "Contact settings saved.", "success");
        } catch (error) {
            setStatus(els.contactMsg, error.message || "Could not save contact settings.", "error");
        }
    });

    els.revenueSettingsForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = event.submitter;
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                const total = Number(els.teacherRevenueTotalInput?.value);
                if (!Number.isFinite(total) || total < 0) {
                    throw new Error("Enter a valid total of 0 or more.");
                }
                const normalizedTotal = Math.round(total * 100) / 100;
                await window.db.collection("teachers").doc(state.teacherUser.uid).set({
                    revenueTotal: normalizedTotal,
                    revenueUpdatedAt: Date.now(),
                }, { merge: true });
                state.teacherRevenueTotal = normalizedTotal;
                if (els.teacherRevenueTotalInput) els.teacherRevenueTotalInput.value = normalizedTotal.toFixed(2);
                updateTeacherOverviewStats();
            });
            setStatus(els.revenueSettingsMsg, "Total Payments Received updated successfully.", "success");
        } catch (error) {
            setStatus(els.revenueSettingsMsg, error.message || "Could not update the payments total.", "error");
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
        let removedCount = 0;
        await withButtonLoading(event.currentTarget, "Importing...", async () => {
            await refreshRuntimeBusyBlocks({ force: true, minDays: 31 });
            removedCount = await removeImportedCalendarExceptions();
            await renderBookingCalendar();
        });
        setStatus(els.appsScriptMsg, state.runtimeBusyBlocks.length
            ? `Loaded ${state.runtimeBusyBlocks.length} current busy blocks${removedCount ? ` and removed ${removedCount} stale imported block${removedCount === 1 ? "" : "s"}` : ""}.`
            : "Apps Script busy blocks refreshed.", "success");
    });

    els.appsScriptSyncPendingBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Syncing...", () => window.syncPendingBookingsViaAppsScript?.({ limit: 25 }));
        setStatus(els.appsScriptMsg, result?.message || "Pending booking sync finished.", result?.success ? "success" : "error");
        await refreshTeacherBookings();
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

    els.appsScriptPreplyStatsBtn?.addEventListener("click", async (event) => {
        try {
            const syncResult = await withButtonLoading(event.currentTarget, "Syncing...", syncPreplyStatistics);
            setStatus(
                els.appsScriptMsg,
                syncResult.firstSync
                    ? "Preply baseline saved. Future completed lessons and new students will increase the public totals."
                    : `Preply statistics synced: +${syncResult.newLessons} lessons, +${syncResult.newStudents} students.`,
                "success"
            );
            startPreplyStatisticsAutoSync();
        } catch (error) {
            setStatus(els.appsScriptMsg, error.message || "Could not sync Preply statistics.", "error");
        }
    });

    els.appsScriptBalanceCheckBtn?.addEventListener("click", async (event) => {
        const result = await withButtonLoading(event.currentTarget, "Checking...", () => reconcileStudentBalances());
        const count = Number(result?.chargedCount || 0);
        const message = `Balance check finished. Deducted ${count} lesson charge${count === 1 ? "" : "s"}.`;
        setStatus(els.appsScriptMsg, message, "success");
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

    document.getElementById("teacherCalendarPrevBtn")?.addEventListener("click", () => {
        state.teacherCalendarWeekOffset = Number(state.teacherCalendarWeekOffset || 0) - 1;
        renderTeacherWeekCalendar();
    });

    document.getElementById("teacherCalendarTodayBtn")?.addEventListener("click", () => {
        state.teacherCalendarWeekOffset = 0;
        renderTeacherWeekCalendar();
    });

    document.getElementById("teacherCalendarNextBtn")?.addEventListener("click", () => {
        state.teacherCalendarWeekOffset = Number(state.teacherCalendarWeekOffset || 0) + 1;
        renderTeacherWeekCalendar();
    });

    document.querySelectorAll("[data-teacher-calendar-view]").forEach((button) => {
        button.addEventListener("click", () => {
            state.teacherCalendarView = button.dataset.teacherCalendarView || "week";
            state.teacherCalendarWeekOffset = 0;
            document.querySelectorAll("[data-teacher-calendar-view]").forEach((item) => {
                item.classList.toggle("is-active", item === button);
            });
            renderTeacherWeekCalendar();
        });
    });

    const teacherCalendarGrid = document.getElementById("teacherCalendarGrid");

    teacherCalendarGrid?.addEventListener("pointerdown", (event) => {
        const handle = event.target.closest("[data-calendar-resize]");
        if (!handle) return;
        const calendarEvent = handle.closest("[data-calendar-booking-id]");
        const bookingId = calendarEvent?.dataset.calendarBookingId || "";
        const booking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (!calendarEvent || !booking) return;
        event.preventDefault();
        event.stopPropagation();
        calendarEvent.draggable = false;
        state.teacherCalendarResize = {
            bookingId,
            booking,
            calendarEvent,
            pointerId: event.pointerId,
            startY: event.clientY,
            initialDuration: Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50),
            durationMinutes: Number(booking.durationMinutes || booking.slotMinutes || state.bookingSettings?.slotMinutes || 50),
        };
        handle.setPointerCapture?.(event.pointerId);
        calendarEvent.classList.add("is-resizing");
    });

    window.addEventListener("pointermove", (event) => {
        const resizeState = state.teacherCalendarResize;
        if (!resizeState || resizeState.pointerId !== event.pointerId) return;
        event.preventDefault();
        const deltaMinutes = Math.round((event.clientY - resizeState.startY) / 5) * 5;
        const durationMinutes = Math.max(30, Math.min(180, resizeState.initialDuration + deltaMinutes));
        resizeState.durationMinutes = durationMinutes;
        resizeState.calendarEvent.style.height = `${durationMinutes}px`;
        resizeState.calendarEvent.dataset.resizeLabel = `${durationMinutes} min`;
    }, { passive: false });

    window.addEventListener("pointerup", async (event) => {
        const resizeState = state.teacherCalendarResize;
        if (!resizeState || resizeState.pointerId !== event.pointerId) return;
        state.teacherCalendarResize = null;
        resizeState.calendarEvent.classList.remove("is-resizing");
        resizeState.calendarEvent.draggable = true;
        if (resizeState.durationMinutes === resizeState.initialDuration) {
            renderTeacherWeekCalendar();
            return;
        }
        try {
            setAppLoading(true, "Updating lesson duration...");
            await resizeTeacherBooking(
                resizeState.bookingId,
                resizeState.booking,
                resizeState.durationMinutes
            );
            await refreshRuntimeBusyBlocks({ force: true });
            await refreshTeacherBookings();
            await renderBookingCalendar();
            setStatus(els.teacherBookingMsg, `Lesson duration updated to ${resizeState.durationMinutes} minutes.`, "success");
        } catch (error) {
            renderTeacherWeekCalendar();
            setStatus(els.teacherBookingMsg, error.message || "Could not update lesson duration.", "error");
        } finally {
            setAppLoading(false);
        }
    });

    teacherCalendarGrid?.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch" || event.target.closest("[data-calendar-resize]")) return;
        const calendarEvent = event.target.closest("[data-calendar-booking-id]");
        const bookingId = calendarEvent?.dataset.calendarBookingId || "";
        const booking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (!calendarEvent || !booking) return;
        const touchState = {
            bookingId,
            booking,
            calendarEvent,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            clientX: event.clientX,
            clientY: event.clientY,
            active: false,
            timer: 0,
        };
        touchState.timer = window.setTimeout(() => {
            touchState.active = true;
            state.teacherCalendarDrag = { bookingId, booking, endedAt: 0 };
            calendarEvent.classList.add("is-dragging");
            navigator.vibrate?.(35);
        }, 450);
        state.teacherCalendarTouch = touchState;
    });

    teacherCalendarGrid?.addEventListener("pointermove", (event) => {
        const touchState = state.teacherCalendarTouch;
        if (!touchState || touchState.pointerId !== event.pointerId) return;
        touchState.clientX = event.clientX;
        touchState.clientY = event.clientY;
        if (!touchState.active) {
            const distance = Math.hypot(event.clientX - touchState.startX, event.clientY - touchState.startY);
            if (distance > 10) {
                window.clearTimeout(touchState.timer);
                state.teacherCalendarTouch = null;
            }
            return;
        }
        event.preventDefault();
        const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
        const column = pointedElement?.closest?.("[data-calendar-date]");
        if (!column) return;
        showTeacherCalendarDropPreview(
            column,
            getTeacherCalendarDropDetails(column, event.clientY, touchState.booking)
        );
    }, { passive: false });

    window.addEventListener("pointerup", async (event) => {
        const touchState = state.teacherCalendarTouch;
        if (!touchState || touchState.pointerId !== event.pointerId) return;
        window.clearTimeout(touchState.timer);
        state.teacherCalendarTouch = null;
        touchState.calendarEvent.classList.remove("is-dragging");
        if (!touchState.active) return;
        event.preventDefault();
        const pointedElement = document.elementFromPoint(touchState.clientX, touchState.clientY);
        const column = pointedElement?.closest?.("[data-calendar-date]");
        const details = column
            ? getTeacherCalendarDropDetails(column, touchState.clientY, touchState.booking)
            : null;
        clearTeacherCalendarDropPreview();
        if (details) {
            await commitTeacherCalendarMove(
                { bookingId: touchState.bookingId, booking: touchState.booking, endedAt: 0 },
                details.slot
            );
        }
    }, { passive: false });

    teacherCalendarGrid?.addEventListener("dragstart", (event) => {
        const calendarEvent = event.target.closest("[data-calendar-booking-id]");
        if (!calendarEvent) {
            event.preventDefault();
            return;
        }
        const bookingId = calendarEvent.dataset.calendarBookingId;
        const booking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (!booking) {
            event.preventDefault();
            return;
        }
        state.teacherCalendarDrag = { bookingId, booking, endedAt: 0 };
        calendarEvent.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", bookingId);
    });

    teacherCalendarGrid?.addEventListener("dragover", (event) => {
        const column = event.target.closest("[data-calendar-date]");
        const dragState = state.teacherCalendarDrag;
        if (!column || !dragState?.booking) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        showTeacherCalendarDropPreview(
            column,
            getTeacherCalendarDropDetails(column, event.clientY, dragState.booking)
        );
    });

    teacherCalendarGrid?.addEventListener("drop", async (event) => {
        const column = event.target.closest("[data-calendar-date]");
        const dragState = state.teacherCalendarDrag;
        if (!column || !dragState?.bookingId || !dragState.booking) return;
        event.preventDefault();
        const details = getTeacherCalendarDropDetails(column, event.clientY, dragState.booking);
        clearTeacherCalendarDropPreview();
        if (details) await commitTeacherCalendarMove(dragState, details.slot);
    });

    teacherCalendarGrid?.addEventListener("dragend", (event) => {
        event.target.closest("[data-calendar-booking-id]")?.classList.remove("is-dragging");
        clearTeacherCalendarDropPreview();
        if (state.teacherCalendarDrag) {
            state.teacherCalendarDrag.endedAt = Date.now();
        }
    });

    let teacherCalendarClickTimer = null;
    teacherCalendarGrid?.addEventListener("click", (event) => {
        const calendarEvent = event.target.closest("[data-calendar-booking-id]");
        if (!calendarEvent) {
            const column = event.target.closest("[data-calendar-date]");
            if (!column || event.target.closest(".teacher-calendar-drop-preview")) return;
            const details = getTeacherCalendarDropDetails(
                column,
                event.clientY,
                { durationMinutes: state.bookingSettings?.slotMinutes || 50 }
            );
            if (details?.slot > Date.now()) {
                openTeacherCalendarCreateModal(details.slot, { column, details });
            } else {
                setStatus(els.teacherBookingMsg, "Choose a future time.", "error");
            }
            return;
        }
        if (Date.now() - Number(state.teacherCalendarDrag?.endedAt || 0) < 400) return;
        const bookingId = calendarEvent.dataset.calendarBookingId;
        const booking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (!booking) return;
        window.clearTimeout(teacherCalendarClickTimer);
        teacherCalendarClickTimer = window.setTimeout(() => {
            openRescheduleModal({
                role: "teacher",
                bookingId,
                booking: { ...booking, id: bookingId },
                allowCustom: true,
            }).catch(console.error);
        }, 220);
    });

    teacherCalendarGrid?.addEventListener("dblclick", (event) => {
        const calendarEvent = event.target.closest("[data-calendar-booking-id]");
        if (!calendarEvent) return;
        window.clearTimeout(teacherCalendarClickTimer);
        const bookingId = calendarEvent.dataset.calendarBookingId;
        const booking = state.bookingCache instanceof Map ? state.bookingCache.get(bookingId) : null;
        if (booking) showTeacherBookingDetails(bookingId, booking);
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

    document.querySelectorAll("[data-close-student-lessons]").forEach((button) => {
        button.addEventListener("click", closeStudentLessonsModal);
    });

    els.teacherStudentsList?.addEventListener("click", (event) => {
        const viewLessonsBtn = event.target.closest("[data-student-action='view-lessons']");
        if (viewLessonsBtn) {
            const studentId = viewLessonsBtn.dataset.studentId;
            openStudentLessonsModal(state.studentCache.get(studentId) || { id: studentId }).catch(console.error);
            return;
        }
        const balanceActionBtn = event.target.closest("[data-student-action='add-payment'], [data-student-action='add-refund']");
        if (balanceActionBtn) {
            const form = balanceActionBtn.closest("[data-student-editor]");
            const studentId = balanceActionBtn.dataset.studentId || "";
            const isPayment = balanceActionBtn.dataset.studentAction === "add-payment";
            const amount = toMoneyValue(form?.querySelector(isPayment ? "[data-student-add-payment]" : "[data-student-add-refund]")?.value);
            const student = state.studentCache.get(studentId) || {};
            if (!studentId || amount <= 0) { setStatus(els.teacherStudentsMsg, "Enter an amount greater than zero.", "error"); return; }
            const effectiveLessonPrice = toMoneyValue(form?.querySelector("[data-student-price]")?.value) || getConfiguredLessonPrice();
            const restoredLessons = isPayment || effectiveLessonPrice <= 0 ? 0 : Math.max(0, Math.floor((amount + 0.0001) / effectiveLessonPrice));
            if (!isPayment && restoredLessons < 1) {
                setStatus(els.teacherStudentsMsg, `Refund must be at least one lesson price (${formatMoney(effectiveLessonPrice)}) to restore a lesson.`, "error");
                return;
            }
            withButtonLoading(balanceActionBtn, isPayment ? "Adding..." : "Returning...", async () => {
                await saveStudentFinance(studentId, toMoneyValue(student.balance) + amount, form?.querySelector("[data-student-price]")?.value, {
                    courseAccess: student.courseAccess === true,
                    accessType: student.accessType || "none",
                    paymentStatus: isPayment ? "approved" : (student.paymentStatus || "none"),
                    paymentNote: form?.querySelector("[data-student-payment-note]")?.value || (isPayment ? "Manual payment" : "Teacher credit return"),
                    courseAccessRequested: student.courseAccessRequested === true,
                    allowOverdraft: student.allowOverdraft === true,
                    reviewRequested: student.reviewRequested === true,
                    lessonCredits: isPayment ? Number(student.lessonCredits || 0) : Number(student.lessonCredits || 0) + restoredLessons,
                    lessonCreditAdjustment: isPayment ? 0 : restoredLessons,
                    adjustmentType: isPayment ? "payment" : "refund",
                });
                await refreshTeacherStudents();
                setStatus(els.teacherStudentsMsg, `${isPayment ? "Payment added" : `Credit returned and ${restoredLessons} lesson${restoredLessons === 1 ? "" : "s"} restored`}. New balance: ${formatMoney(toMoneyValue(student.balance) + amount)}.`, "success");
            }).catch((error) => setStatus(els.teacherStudentsMsg, error.message || "Could not update balance.", "error"));
            return;
        }
        const toggle = event.target.closest("[data-student-action='toggle']");
        if (toggle) {
            const item = toggle.closest("[data-student-id]");
            const editor = item?.querySelector("[data-student-editor]");
            if (editor) editor.hidden = !editor.hidden;
            return;
        }

        const quickCreditBtn = event.target.closest("[data-quick-credit]");
        if (quickCreditBtn) {
            const studentId = quickCreditBtn.dataset.studentId;
            const creditAmount = Number(quickCreditBtn.dataset.quickCredit || 0);
            const packageLessons = Number(quickCreditBtn.dataset.packageLessons || 0);
            const isPackageApproval = quickCreditBtn.dataset.approvePackage === "true";
            if (!studentId || creditAmount <= 0) return;
            const student = state.studentCache.get(studentId) || {};
            const currentBalance = Number(student.balance || 0);
            const newBalance = currentBalance + creditAmount;
            const lessonPrice = getConfiguredLessonPrice();

            withButtonLoading(quickCreditBtn, "Adding...", async () => {
                if (isPackageApproval) {
                    await approveStudentPackage(studentId, student, packageLessons, creditAmount);
                } else {
                    await saveStudentFinance(studentId, newBalance, lessonPrice, {
                        courseAccess: student.courseAccess === true,
                        accessType: student.accessType || "manual",
                        paymentStatus: "approved",
                        paymentNote: `Added +$${creditAmount} credit (Previous: $${currentBalance})`,
                        courseAccessRequested: false,
                        lessonCredits: Number(student.lessonCredits || 0),
                        totalPaid: Number(student.totalPaid || 0),
                        adjustmentType: "payment",
                    });
                }
                await refreshTeacherStudents();
                setStatus(els.teacherStudentsMsg, isPackageApproval
                    ? `Confirmed ${packageLessons} lessons and ${formatMoney(creditAmount)} paid for ${student.name || "student"}.`
                    : `Added +$${creditAmount} to ${student.name || "student"}'s balance (New balance: $${newBalance.toFixed(2)}).`, "success");
            }).catch((error) => {
                setStatus(els.teacherStudentsMsg, error.message || "Could not update balance.", "error");
            });
            return;
        }

        const requestReviewBtn = event.target.closest("[data-student-action='request-review']");
        if (requestReviewBtn) {
            const studentId = requestReviewBtn.dataset.studentId;
            if (!studentId) return;
            const student = state.studentCache.get(studentId) || {};
            const lessonPrice = getConfiguredLessonPrice();
            withButtonLoading(requestReviewBtn, "Requesting...", async () => {
                await saveStudentFinance(studentId, student.balance || 0, lessonPrice, {
                    courseAccess: student.courseAccess === true,
                    accessType: student.accessType || "none",
                    paymentStatus: student.paymentStatus || "none",
                    paymentNote: student.paymentNote || "",
                    courseAccessRequested: student.courseAccessRequested === true,
                    allowOverdraft: student.allowOverdraft === true,
                    reviewRequested: true,
                });
                const emailResult = await window.sendReviewRequestViaAppsScript?.({
                    studentId,
                    siteUrl: `${window.location.origin}${window.location.pathname}`,
                });
                await refreshTeacherStudents();
                setStatus(
                    els.teacherStudentsMsg,
                    emailResult?.success
                        ? `Review request and email sent to ${student.name || student.email || "student"}.`
                        : `Review request activated for ${student.name || student.email || "student"}, but the email was not sent.`,
                    emailResult?.success ? "success" : "error"
                );
            }).catch((error) => {
                setStatus(els.teacherStudentsMsg, error.message || "Could not request review.", "error");
            });
            return;
        }

        const invitationBtn = event.target.closest("[data-student-action='send-booking-invitation']");
        if (invitationBtn) {
            const studentId = invitationBtn.dataset.studentId;
            if (!studentId) return;
            const student = state.studentCache.get(studentId) || {};
            const label = student.name || student.email || "student";
            withButtonLoading(invitationBtn, "Sending...", async () => {
                const result = await window.sendStudentBookingInvitationViaAppsScript?.({ studentId });
                if (!result?.success) throw new Error(result?.message || "The invitation email was not sent.");
                setStatus(els.teacherStudentsMsg, `Lesson invitation sent to ${label}.`, "success");
            }).catch((error) => {
                setStatus(els.teacherStudentsMsg, error.message || "Could not send the lesson invitation.", "error");
            });
            return;
        }

        const resetTrialBtn = event.target.closest("[data-student-action='reset-trial']");
        if (resetTrialBtn) {
            const studentId = resetTrialBtn.dataset.studentId;
            if (!studentId) return;
            const student = state.studentCache.get(studentId) || {};
            const label = student.name || student.email || "this student";
            if (!window.confirm(`Reset the free trial for ${label}?`)) return;
            withButtonLoading(resetTrialBtn, "Resetting...", async () => {
                await resetStudentFreeTrial(studentId);
                await refreshTeacherStudents();
                setStatus(els.teacherStudentsMsg, `Free trial is available again for ${label}.`, "success");
            }).catch((error) => {
                setStatus(els.teacherStudentsMsg, error.message || "Could not reset the free trial.", "error");
            });
            return;
        }

        const markTrialUsedBtn = event.target.closest("[data-student-action='mark-trial-used']");
        if (markTrialUsedBtn) {
            const studentId = markTrialUsedBtn.dataset.studentId;
            if (!studentId) return;
            const student = state.studentCache.get(studentId) || {};
            const label = student.name || student.email || "this student";
            if (!window.confirm(`Mark the free trial as used for ${label}?`)) return;
            withButtonLoading(markTrialUsedBtn, "Saving...", async () => {
                await markStudentTrialUsed(studentId);
                await refreshTeacherStudents();
                setStatus(els.teacherStudentsMsg, `Free trial marked as used for ${label}.`, "success");
            }).catch((error) => {
                setStatus(els.teacherStudentsMsg, error.message || "Could not update free-trial status.", "error");
            });
            return;
        }

        const deleteButton = event.target.closest("[data-student-action='delete']");
        if (!deleteButton) return;
        const item = deleteButton.closest("[data-student-id]");
        const studentId = item?.dataset.studentId || "";
        if (!studentId) return;
        const student = state.studentCache.get(studentId) || {};
        const label = student.name || student.email || "this student";
        const confirmed = window.confirm(`Delete ${label} from Students & Balances? This removes the student profile, but existing bookings stay in the booking history.`);
        if (!confirmed) return;
        withButtonLoading(deleteButton, "Deleting...", async () => {
            await deleteStudentProfile(studentId);
            await refreshTeacherStudents();
            setStatus(els.teacherStudentsMsg, "Student deleted.", "success");
        }).catch((error) => {
            setStatus(els.teacherStudentsMsg, error.message || "Could not delete student.", "error");
        });
    });

    els.teacherStudentsList?.addEventListener("submit", async (event) => {
        const form = event.target.closest("[data-student-editor]");
        if (!form) return;
        event.preventDefault();
        const item = form.closest("[data-student-id]");
        const studentId = item?.dataset.studentId || "";
        if (!studentId) return;
        const submitter = event.submitter;
        const existingStudent = state.studentCache.get(studentId) || {};
        const courseAccessChecked = !!form.querySelector("[data-student-course-access]")?.checked;
        const allowOverdraftChecked = !!form.querySelector("[data-student-allow-overdraft]")?.checked;
        const lessonCredits = Math.max(0, Math.floor(Number(form.querySelector("[data-student-lesson-credits]")?.value || 0)));
        const reservedLessons = Math.max(0, Math.floor(Number(existingStudent.reservedLessons || 0)));
        if (!allowOverdraftChecked && lessonCredits < reservedLessons) {
            setStatus(els.teacherStudentsMsg, `Lesson credits cannot be lower than ${reservedLessons}, because this student has ${reservedLessons} reserved lesson${reservedLessons === 1 ? "" : "s"}.`, "error");
            return;
        }
        try {
            await withButtonLoading(submitter, "Saving...", async () => {
                await saveStudentFinance(
                    studentId,
                    form.querySelector("[data-student-balance]")?.value,
                    form.querySelector("[data-student-price]")?.value,
                    {
                        courseAccess: courseAccessChecked,
                        accessType: form.querySelector("[data-student-access-type]")?.value || "none",
                        paymentStatus: form.querySelector("[data-student-payment-status]")?.value || "none",
                        paymentNote: form.querySelector("[data-student-payment-note]")?.value || "",
                        courseAccessRequested: !courseAccessChecked && existingStudent.courseAccessRequested === true,
                        allowOverdraft: allowOverdraftChecked,
                        reviewRequested: existingStudent.reviewRequested === true,
                        lessonCredits,
                        lessonCreditAdjustment: lessonCredits - Math.max(0, Math.floor(Number(existingStudent.lessonCredits || 0))),
                    }
                );
                await refreshTeacherStudents();
            });
            setStatus(els.teacherStudentsMsg, "Student settings saved.", "success");
        } catch (error) {
            setStatus(els.teacherStudentsMsg, error.message || "Could not save student settings.", "error");
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
            "delete-canceled": "Deleting...",
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
            if (action === "classroom") {
                openClassroomDirectly({ ...booking, id: bookingId });
                return;
            }

            if (action === "whatsapp-reminder") {
                sendWhatsAppReminder({ ...booking, id: bookingId });
                return;
            }

            if (action === "complete") {
                await markBookingCompleted(bookingId, booking);
                setStatus(els.teacherBookingMsg, "Lesson marked as completed! Hours taught incremented (+1).", "success");
                await refreshTeacherBookings();
                return;
            }

            if (action === "cancel") {
                await cancelBooking({
                    db: window.db,
                    firebase: window.firebase,
                    bookingId,
                    teacherEmail: state.contactSettings?.email || "",
                });
                const deleteResult = await deleteCalendarEventForBooking(bookingId, booking);
                const calendarDeletePending = deleteResult?.success === false && !isAlreadyDeletedCalendarEvent(deleteResult);
                if (!calendarDeletePending) {
                    await window.db.collection("bookings").doc(bookingId).set({
                        calendarDeletePending: false,
                        calendarSyncState: CALENDAR_SYNC_STATES.EXTERNALLY_DELETED,
                        calendarLastSyncedAt: Date.now(),
                        calendarLastCheckedAt: Date.now(),
                        calendarNextRetryAt: 0,
                        calendarSyncLastError: "",
                        updatedAt: Date.now(),
                    }, { merge: true });
                }
                setStatus(
                    els.teacherBookingMsg,
                    calendarDeletePending
                        ? "Booking canceled. Calendar removal will be retried."
                        : "Booking canceled.",
                    "success"
                );
                await refreshTeacherBookings();
                await renderBookingCalendar();
                return;
            }

            if (action === "delete-canceled") {
                if (booking.status !== "canceled") {
                    throw new Error("Only canceled bookings can be deleted.");
                }
                const confirmed = window.confirm("Permanently delete this canceled booking? This cannot be undone.");
                if (!confirmed) return;
                await deleteCanceledBooking({ db: window.db, bookingId });
                state.bookingCache.delete(bookingId);
                setStatus(els.teacherBookingMsg, "Canceled booking deleted permanently.", "success");
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
                await rescheduleTeacherBooking(bookingId, booking, newSlot);
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
        let removedCount = 0;
        await withButtonLoading(event.currentTarget, "Importing...", async () => {
            await refreshRuntimeBusyBlocks({ force: true, minDays: 31 });
            if (!state.busySyncReady) {
                throw new Error(state.busySyncMessage || "Could not load Google Calendar busy times.");
            }
            removedCount = await removeImportedCalendarExceptions();
            await renderBookingCalendar();
        }).then(async () => {
            const count = state.runtimeBusyBlocks.length;
            state.googleCalendarMessage = `Busy times refreshed through Apps Script (${count} event${count === 1 ? "" : "s"})${removedCount ? `; removed ${removedCount} stale imported block${removedCount === 1 ? "" : "s"}` : ""}.`;
            await refreshGoogleCalendarStatus();
        }).catch((error) => {
            setStatus(els.googleCalendarStatus, error?.message || "Import failed.", "error");
        });
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

    const teacherDashboardEl = document.getElementById("teacherDashboard");
    if (teacherDashboardEl) {
        teacherDashboardEl.addEventListener("click", (event) => {
            const tabBtn = event.target.closest("[data-teacher-tab]");
            if (tabBtn && tabBtn.dataset.teacherTab) {
                switchTeacherTab(tabBtn.dataset.teacherTab);
                return;
            }
            const gotoBtn = event.target.closest("[data-goto-tab]");
            if (gotoBtn && gotoBtn.dataset.gotoTab) {
                switchTeacherTab(gotoBtn.dataset.gotoTab);
                return;
            }
        });
    }
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
        stopTeacherCalendarAutoRefresh();
    } else if (screenId === "teacher-screen") {
        stopGoogleBusyAutoRefresh();
        startTeacherCalendarAutoRefresh();
    } else {
        stopGoogleBusyAutoRefresh();
        stopTeacherCalendarAutoRefresh();
    }
}

async function handleAuthState(user) {
    stopStudentProfileListener();
    stopStudentBookingsListener();
    stopBalanceReconcileAutoRefresh();
    stopTeacherLessonFeedbackListener();
    stopPreplyStatisticsAutoSync();
    stopTeacherCalendarAutoRefresh();
    state.currentUser = user || null;
    state.currentRole = "";
    state.studentProfile = null;
    state.teacherUser = null;
    state.teacherRole = "";
    state.googleCalendarConnected = false;
    state.publicSettingsLoaded = false;
    state.bookingCalendarLoaded = false;
    state.publicSettingsInFlight = null;
    state.bookingCalendarInFlight = null;
    state.busyBlocksRangeDays = 0;
    state.teacherLessonFeedbackLoaded = false;

    if (!user) {
        if (upcomingBannerInterval) {
            clearInterval(upcomingBannerInterval);
            upcomingBannerInterval = null;
        }
        if (teacherUpcomingBannerInterval) {
            clearInterval(teacherUpcomingBannerInterval);
            teacherUpcomingBannerInterval = null;
        }
        const bannerEl = document.getElementById("upcomingLessonBanner");
        if (bannerEl) {
            bannerEl.style.display = "none";
            bannerEl.innerHTML = "";
        }
        const teacherBannerEl = document.getElementById("teacherUpcomingLessonBanner");
        if (teacherBannerEl) {
            teacherBannerEl.style.display = "none";
            teacherBannerEl.innerHTML = "";
        }
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
        syncStudentReviewUi();
        showScreen("student-screen");
        startStudentProfileListener();
        startStudentBookingsListener();
        await Promise.all([
            loadStudentBookings(),
            ensureBookingCalendarLoaded(),
        ]);
        return;
    }

    state.teacherUser = user;
    state.teacherRole = "teacher";
    if (upcomingBannerInterval) {
        clearInterval(upcomingBannerInterval);
        upcomingBannerInterval = null;
    }
    const bannerEl = document.getElementById("upcomingLessonBanner");
    if (bannerEl) {
        bannerEl.style.display = "none";
        bannerEl.innerHTML = "";
    }
    updateStudentAuthUi();

    bootstrapTeacherAccess({
        db: window.db,
        firebase: window.firebase,
        uid: user.uid,
        email: user.email,
    }).catch((error) => console.warn("Could not refresh teacher access documents.", error));

    if (!els.teacherDashboard) {
        console.warn("Teacher dashboard markup is missing; skipping teacher UI render.");
        return;
    }
    els.teacherDashboard.hidden = false;
    switchTeacherTab(state.activeTeacherTab || "tab-home");
    if (els.teacherAuthBadge) els.teacherAuthBadge.textContent = user.email || "Teacher";
    setStatus(els.teacherAuthMsg, "Teacher access active.", "success");
    setStatus(els.teacherLoginMsg, "");
    els.teacherLoginModal?.classList.remove("modal--open");

    showScreen("teacher-screen");
    refreshGoogleCalendarStatus().catch((error) => {
        console.warn("Could not refresh Google Calendar connection status.", error);
    });
    if (els.teacherLessonFeedbackCount) {
        els.teacherLessonFeedbackCount.textContent = `${LESSON_FEEDBACK_BASELINE.studentCount} students · 0 new lesson ratings`;
    }
    renderLessonFeedbackMetricCards(els.teacherLessonFeedbackMetrics, {
        count: LESSON_FEEDBACK_BASELINE.studentCount,
        studentCount: LESSON_FEEDBACK_BASELINE.studentCount,
        lessonCount: 0,
        averages: LESSON_FEEDBACK_BASELINE.averages,
    });
    startTeacherLessonFeedbackListener();

    window.db.collection("teachers").doc(user.uid).get().then((teacherDoc) => {
        const teacherData = teacherDoc.exists ? (teacherDoc.data() || {}) : {};
        state.teacherCalendarStatistics = teacherData.calendarStatistics || {};
        renderPreplyStatisticsSummary(state.teacherCalendarStatistics);
        if (els.teacherAppsScriptUrl) els.teacherAppsScriptUrl.value = teacherData.appsScript?.webAppUrl || "";
        if (els.teacherPreplyCalendarId) {
            els.teacherPreplyCalendarId.value = teacherData.preplyCalendarId || teacherData.googleCalendar?.preplyCalendarId || "";
        }
        if (teacherData.calendarStatistics?.initialized === true) {
            const lastStatisticsSync = Number(teacherData.calendarStatistics?.lastSyncedAt || 0);
            if (Date.now() - lastStatisticsSync >= 24 * 60 * 60 * 1000) {
                syncPreplyStatistics()
                    .then(() => syncPlatformStatistics())
                    .catch((error) => {
                    console.warn("Initial completed-lesson statistics refresh failed.", error);
                });
            }
            startPreplyStatisticsAutoSync();
        }
    }).catch((error) => console.warn("Could not load teacher integration settings.", error));

    refreshTeacherDashboard().then(() => {
        startBalanceReconcileAutoRefresh();
    }).catch((error) => {
        console.error("Could not refresh teacher dashboard.", error);
        setStatus(els.teacherAuthMsg, "Teacher access active; some dashboard data could not refresh.", "error");
    });
    refreshAppsScriptEmailQuota().catch(console.error);
}

async function syncReviewsToCloud() {
    if (!window.db) return;
    try {
        const cloudRevs = await loadCloudReviews(window.db);
        const initialRevs = createInitialReviews();

        const cleanedInitialRevs = initialRevs.map(r => {
            return {
                id: r.id,
                name: (r.name || "Student").trim(),
                country: (r.country || "🌐 Student").trim(),
                date: (r.date || "Recent").trim(),
                rating: Number(r.rating || 5),
                text: (r.text || "").trim(),
                tag: (r.tag || "Arabic Lesson").trim(),
                avatar: (r.avatar || (r.name ? r.name.substring(0, 2).toUpperCase() : "ST")).trim(),
                source: r.source || "",
                createdAt: r.createdAt || Date.now()
            };
        });

        const cloudIds = new Set((cloudRevs || []).map(r => r.id));
        for (const r of cleanedInitialRevs) {
            if (!cloudIds.has(r.id)) {
                try {
                    await addReviewToCloud(window.db, r);
                    console.log(`[Sync] Successfully synced review ${r.id} to cloud.`);
                } catch (err) {
                    console.warn(`[Sync] Could not sync review ${r.id} to cloud:`, err);
                }
            }
        }
    } catch (e) {
        console.error("[Sync] Error in automated reviews sync:", e);
    }
}

function buildTeacherScheduleUi() {
    renderTeacherDays();
}

async function init() {
    cacheDom();
    syncResponsiveWelcomeLayout();
    window.addEventListener("resize", syncResponsiveWelcomeLayout);
    initializeStudentTimezoneSelector();
    buildTeacherScheduleUi();
    renderProfileUi();
    renderReviewsUi();
    updateStudentOfferUi();
    loadPublicLessonFeedbackSummary().catch(console.error);
    syncStudentReviewUi();
    setStudentAuthMode("login");
    updateStudentAuthUi();
    wireStudentActions();
    wireTeacherActions();
    showScreen("welcome-screen");

    if (!window.db || !window.auth) {
        setStatus(els.bookingMsg, "Firebase config is missing. Check js/config.js.", "error");
        return;
    }

    loadPublicSettings({ force: true }).catch((error) => {
        console.warn("Could not load public lesson packages.", error);
        updateStudentOfferUi();
    });

    if (new URLSearchParams(window.location.search).get("teacher") === "1") {
        els.teacherLoginModal?.classList.add("modal--open");
    }

    loadCloudProfileSettings(window.db, createInitialProfileSettings()).then((cloudProf) => {
        if (cloudProf) {
            // Refresh an empty or obsolete generic profile bio without importing another teacher's identity.
            if (!cloudProf.bioText ||
                cloudProf.bioText.includes("Modern Standard Arabic (MSA)") ||
                cloudProf.bioText.includes("I’m a Palestinian Arabic tutor specializing")) {
                const updatedDefault = createInitialProfileSettings();
                cloudProf = {
                    ...cloudProf,
                    bioText: updatedDefault.bioText,
                    quoteArabic: updatedDefault.quoteArabic,
                    headline: updatedDefault.headline
                };
                saveCloudProfileSettings(window.db, cloudProf).catch(console.error);
            }
            state.profileSettings = cloudProf;
            saveLocalProfileSettings("teacher_profile_v1", cloudProf);
            renderProfileUi();
        }
    }).catch(console.error);

    loadCloudReviews(window.db, undefined, { limit: 6 }).then(async (cloudRevs) => {
        const initialRevs = createInitialReviews();

        // Clean and validate reviews
        const cleanedInitialRevs = initialRevs.map(r => {
            return {
                id: r.id,
                name: (r.name || "Student").trim(),
                country: (r.country || "🌐 Student").trim(),
                date: (r.date || "Recent").trim(),
                rating: Number(r.rating || 5),
                text: (r.text || "").trim(),
                tag: (r.tag || "Arabic Lesson").trim(),
                avatar: (r.avatar || (r.name ? r.name.substring(0, 2).toUpperCase() : "ST")).trim(),
                source: r.source || "",
                createdAt: r.createdAt || Date.now()
            };
        });

        // Filter out old Preply reviews
        let filteredRevs = (cloudRevs && cloudRevs.length ? cloudRevs : cleanedInitialRevs)
            .filter(r => !["rev-preply-1", "rev-preply-2", "rev-preply-3"].includes(r.id));

        const cloudIds = new Set(filteredRevs.map(r => r.id));
        if (!cloudRevs || !cloudRevs.length) cleanedInitialRevs.forEach((r) => { if (!cloudIds.has(r.id)) filteredRevs.push(r); });

        filteredRevs.sort((a, b) => {
            const indexA = cleanedInitialRevs.findIndex(ir => ir.id === a.id);
            const indexB = cleanedInitialRevs.findIndex(ir => ir.id === b.id);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        state.reviews = filteredRevs;
        state.reviewsLoadedAll = !cloudRevs || cloudRevs.length < 6;
        state.reviewsMayHaveMore = Array.isArray(cloudRevs) && cloudRevs.length === 6;
        saveLocalReviews("teacher_reviews_v1", filteredRevs);
        renderReviewsUi();
    }).catch(console.error);

    window.auth.onAuthStateChanged((user) => {
        withAppLoading("Loading account...", () => handleAuthState(user)).catch(console.error);
    });
}

init().catch(console.error);
