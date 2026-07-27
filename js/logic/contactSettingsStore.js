export function createInitialContactSettings() {
    return {
        whatsapp: "",
        email: "",
        sitePrice: "",
        classroomMeetingUrl: "",
    };
}

function getCurrentTeacherUid() {
    try {
        return window.firebase?.auth?.()?.currentUser?.uid || "";
    } catch {
        return "";
    }
}

function getTeacherDocRef(db, uid) {
    return db.collection("teachers").doc(uid);
}

export function loadContactSettings(storageKey, currentSettings) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            return { ...currentSettings, ...JSON.parse(raw) };
        }
    } catch {}
    return currentSettings;
}

export function saveContactSettings(storageKey, settings) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(settings));
    } catch {}
}

export async function loadContactSettingsFromCloud(db, currentSettings) {
    try {
        const uid = getCurrentTeacherUid();
        if (uid) {
            const teacherSnap = await getTeacherDocRef(db, uid).get();
            if (teacherSnap.exists) {
                const teacherData = teacherSnap.data() || {};
                const data = teacherData.contactSettings || {};
                return {
                    ...currentSettings,
                    whatsapp: typeof data.whatsapp === "string" ? data.whatsapp : currentSettings.whatsapp,
                    email: typeof data.email === "string" ? data.email : currentSettings.email,
                    sitePrice: typeof data.sitePrice === "string" ? data.sitePrice : currentSettings.sitePrice,
                    classroomMeetingUrl: typeof data.classroomMeetingUrl === "string" ? data.classroomMeetingUrl : currentSettings.classroomMeetingUrl,
                };
            }
        }
        const ref = db.collection("bookingSettings").doc("primary");
        const snap = await ref.get();
        if (snap.exists) {
            const data = snap.data() || {};
            return {
                ...currentSettings,
                whatsapp: typeof data.whatsapp === "string" ? data.whatsapp : currentSettings.whatsapp,
                email: typeof data.contactEmail === "string" ? data.contactEmail : currentSettings.email,
                sitePrice: typeof data.sitePrice === "string" ? data.sitePrice : currentSettings.sitePrice,
                classroomMeetingUrl: typeof data.classroomMeetingUrl === "string" ? data.classroomMeetingUrl : currentSettings.classroomMeetingUrl,
            };
        }
    } catch {}
    return currentSettings;
}

export async function saveContactSettingsToCloud(db, firebase, settings) {
    try {
        const uid = getCurrentTeacherUid();
        if (uid) {
            const ref = getTeacherDocRef(db, uid);
            await ref.set(
                {
                    contactSettings: {
                        whatsapp: settings?.whatsapp || "",
                        email: settings?.email || "",
                        sitePrice: settings?.sitePrice || "",
                        classroomMeetingUrl: settings?.classroomMeetingUrl || "",
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    },
                },
                { merge: true }
            );
            return;
        }
        const ref = db.collection("bookingSettings").doc("primary");
        await ref.set(
            {
                whatsapp: settings?.whatsapp || "",
                contactEmail: settings?.email || "",
                sitePrice: settings?.sitePrice || "",
                classroomMeetingUrl: settings?.classroomMeetingUrl || "",
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
    } catch {}
}

export function extractWhatsAppNumber(settings) {
    const raw = (settings?.whatsapp || "").trim();
    if (!raw) return "";
    if (raw.startsWith("http")) {
        try {
            const url = new URL(raw);
            return (url.searchParams.get("phone") || "").replace(/[^0-9]/g, "");
        } catch {
            return "";
        }
    }
    return raw.replace(/[^0-9]/g, "");
}

export function buildWhatsAppUrl(settings, message) {
    const raw = (settings?.whatsapp || "").trim();
    if (!raw) return null;
    if (raw.startsWith("http")) {
        try {
            const url = new URL(raw);
            const hostname = url.hostname.toLowerCase();
            const isWhatsAppHost = hostname === "wa.me"
                || hostname === "api.whatsapp.com"
                || hostname === "web.whatsapp.com";
            if (!isWhatsAppHost) return null;
            url.searchParams.set("text", message);
            return url.toString();
        } catch {
            return null;
        }
    }
    const number = extractWhatsAppNumber(settings);
    if (!number) return null;
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
