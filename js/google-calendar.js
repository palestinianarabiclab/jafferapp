// Google Calendar API Integration

let tokenClient;
let gapiInited = false;
let gisInited = false;
let accessToken = null;
let calendarId = 'primary';
const errorHandler = {
    withTimeout(asyncFn, timeoutMs = 10000, timeoutMessage = "Google Calendar initialization timed out.") {
        if (window.errorHandler?.withTimeout) {
            return window.errorHandler.withTimeout(asyncFn, timeoutMs, timeoutMessage);
        }
        const task = typeof asyncFn === "function" ? asyncFn() : asyncFn;
        return Promise.race([
            Promise.resolve(task),
            new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
        ]);
    },
    handleError(error, context) {
        window.errorHandler?.handleError?.(error, context);
    },
};
window.preplyCalendarId = null; // Will be set from Firebase or user input

function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing?.dataset.loaded === "true") {
            resolve();
            return;
        }
        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
            return;
        }
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.defer = true;
        script.addEventListener("load", () => {
            script.dataset.loaded = "true";
            resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error(`Could not load ${src}`)), { once: true });
        document.head.appendChild(script);
    });
}

function normalizeCalendarId(value) {
    const raw = (value || "").trim();
    if (!raw) return "";
    if (!raw.includes("calendar.google.com")) return raw;
    try {
        const url = new URL(raw);
        const src = url.searchParams.get("src") || "";
        return src ? decodeURIComponent(src) : raw;
    } catch {
        const match = raw.match(/[?&]src=([^&]+)/i);
        return match?.[1] ? decodeURIComponent(match[1]) : raw;
    }
}

function getPartsInTimeZone(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const data = {};
    parts.forEach((part) => {
        if (part.type !== "literal") data[part.type] = part.value;
    });
    return data;
}

async function getCurrentTeacherDoc() {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    const teacherDoc = await firebase.firestore().collection('teachers').doc(user.uid).get();
    if (!teacherDoc.exists) return null;
    const teacherData = teacherDoc.data() || {};
    window.preplyCalendarId = normalizeCalendarId(teacherData.preplyCalendarId || teacherData.googleCalendar?.preplyCalendarId || window.preplyCalendarId);
    return { user, teacherDoc, teacherData };
}

function isGoogleAuthError(error) {
    const status = error?.status || error?.result?.error?.code || error?.code;
    const message = String(error?.result?.error?.message || error?.message || "");
    return status === 401 || message.toLowerCase().includes("invalid credentials");
}

async function clearStoredGoogleCalendarConnection(reason = "Google Calendar session expired. Please reconnect.") {
    accessToken = null;

    try {
        const user = firebase.auth().currentUser;
        if (user) {
            await firebase.firestore().collection('teachers').doc(user.uid).set({
                googleCalendar: {
                    connected: false,
                    accessToken: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
        }
    } catch (err) {
        console.error('Error clearing expired Google Calendar connection:', err);
    }

    try {
        window.updateGoogleCalendarStatusMessage?.(reason);
        window.refreshGoogleCalendarStatus?.();
    } catch {}
}

async function testPreplyCalendarAccess() {
    try {
        const teacher = await getCurrentTeacherDoc();
        if (!teacher) {
            return { success: false, message: 'Teacher not found' };
        }
        if (!window.preplyCalendarId) {
            return { success: false, message: 'Preply Calendar ID is empty' };
        }
        const token = await ensureGoogleCalendarAccess({ interactive: false });
        if (!token) {
            return { success: false, message: 'Reconnect Google Calendar first' };
        }
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        const response = await googleCalendarApiRequest({
            calendarId: window.preplyCalendarId,
            query: {
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
            }
        });
        const count = response?.items?.length || 0;
        return { success: true, message: `Preply calendar is reachable. Found ${count} events in the next 30 days.`, count };
    } catch (error) {
        console.error('Error testing Preply calendar:', error);
        return { success: false, message: error?.message || 'Could not access Preply calendar' };
    }
}

async function googleCalendarApiRequest({
    method = 'GET',
    calendarId: targetCalendarId = calendarId,
    path = 'events',
    query = {},
    body,
}) {
    const token = accessToken;
    if (!token) {
        throw new Error('Missing Google Calendar access token');
    }

    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            params.set(key, String(value));
        }
    });

    const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/${path}`
    );
    if ([...params.keys()].length) {
        url.search = params.toString();
    }

    const response = await fetch(url.toString(), {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        let payload = null;
        try {
            payload = await response.json();
        } catch {}
        const error = new Error(payload?.error?.message || `Google Calendar API request failed (${response.status})`);
        error.status = response.status;
        error.result = payload;
        throw error;
    }

    if (response.status === 204) {
        return null;
    }
    return response.json();
}

function requestGoogleAccessToken(prompt = '') {
    return new Promise((resolve, reject) => {
        if (!tokenClient) {
            reject(new Error('Google token client not initialized'));
            return;
        }
        tokenClient.callback = async (resp) => {
            if (resp?.error) {
                reject(new Error(resp.error));
                return;
            }
            try {
                accessToken = resp.access_token || accessToken || null;
                resolve({ accessToken, response: resp });
            } catch (err) {
                reject(err);
            }
        };
        tokenClient.requestAccessToken({ prompt });
    });
}

async function ensureGoogleCalendarAccess({ interactive = false } = {}) {
    if (!gapiInited || !gisInited) {
        const ok = await initializeGoogleCalendar();
        if (!ok) return null;
    }
    const teacher = await getCurrentTeacherDoc();
    if (!teacher || !teacher.teacherData.googleCalendar?.connected) {
        return null;
    }

    accessToken = teacher.teacherData.googleCalendar.accessToken || accessToken;
    window.preplyCalendarId = normalizeCalendarId(teacher.teacherData.preplyCalendarId || teacher.teacherData.googleCalendar?.preplyCalendarId || window.preplyCalendarId);

    if (!interactive && accessToken) {
        return accessToken;
    }

    try {
        if (!interactive) {
            return null;
        }
        const tokenResult = await requestGoogleAccessToken('');
        if (tokenResult?.accessToken) {
            await firebase.firestore().collection('teachers').doc(teacher.user.uid).set({
                googleCalendar: {
                    ...(teacher.teacherData.googleCalendar || {}),
                    connected: true,
                    accessToken: tokenResult.accessToken,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
            return tokenResult.accessToken;
        }
    } catch (err) {
        console.error('Error ensuring Google Calendar access:', err);
        return null;
    }
    return null;
}

// Global initialization functions called from HTML
window.handleClientLoad = async function() {
    try {
        await gapiLoaded();
        console.log('Google API client loaded successfully');
    } catch (error) {
        console.error('Error loading Google API client:', error);
    }
};

window.handleGisLoad = async function() {
    try {
        await gisLoaded();
        console.log('Google Identity Services loaded successfully');
    } catch (error) {
        console.error('Error loading Google Identity Services:', error);
    }
};

// Initialize Google API
async function initializeGoogleCalendar() {
    try {
        // Load GAPI client
        await gapiLoaded();
        // Load GIS client
        await gisLoaded();
        console.log('Google Calendar API initialized successfully');
        return true;
    } catch (error) {
        gapiInited = false;
        console.error('Error initializing Google Calendar:', error);
        return false;
    }
}

// Load GAPI client
function gapiLoaded() {
    return new Promise((resolve, reject) => {
        const ready = () => window.gapi?.load;
        const start = () => gapi.load('client', () => {
            try {
                gapiInited = true;
                resolve();
            } catch (error) {
                reject(error);
            }
        });
        if (ready()) {
            start();
            return;
        }
        loadExternalScript("https://apis.google.com/js/api.js")
            .then(() => {
                if (!ready()) throw new Error('Google API client is not available');
                start();
            })
            .catch(reject);
    });
}

// Load GIS client
function gisLoaded() {
    return new Promise((resolve, reject) => {
        const ready = () => window.google?.accounts?.oauth2?.initTokenClient;
        const start = () => {
            tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: googleCalendarConfig.clientId,
            scope: googleCalendarConfig.scopes,
            callback: '', // defined later
            redirect_uri: googleCalendarConfig.redirectUri || (window.location.origin + window.location.pathname)
            });
            gisInited = true;
            resolve();
        };
        if (ready()) {
            start();
            return;
        }
        loadExternalScript("https://accounts.google.com/gsi/client")
            .then(() => {
                if (!ready()) throw new Error('Google Identity Services is not available');
                start();
            })
            .catch(reject);
    });
}

// Connect to Google Calendar
async function connectToGoogleCalendar(callback) {
    console.log("Connecting to Google Calendar...");
    console.log("gapiInited:", gapiInited, "gisInited:", gisInited);
    
    if (!gapiInited || !gisInited) {
        console.error('Google Calendar API not initialized');
        console.log("Attempting to initialize Google Calendar API...");
        try {
            const ok = await errorHandler.withTimeout(
                () => initializeGoogleCalendar(),
                10000,
                'Failed to initialize Google Calendar API - Timeout'
            );
            console.log("Google Calendar API initialized successfully");
        } catch (error) {
            console.error("Failed to initialize Google Calendar API:", error);
            errorHandler.handleError(error, 'Google Calendar Initialization');
            if (callback) callback(false, "Google Calendar API not initialized");
            return false;
        }
    }

    try {
        const tokenResult = await requestGoogleAccessToken('consent');
        const user = firebase.auth().currentUser;
        if (!user || !tokenResult?.accessToken) {
            callback(false, "Could not get Google access token");
            return false;
        }
        await firebase.firestore().collection('teachers').doc(user.uid).set({
            googleCalendar: {
                connected: true,
                accessToken: tokenResult.accessToken,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }
        }, { merge: true });
        console.log('Google Calendar connected successfully');
        callback(true, null);
        return true;
    } catch (error) {
        console.error('Error saving Google Calendar connection:', error);
        callback(false, error?.message || String(error));
        return false;
    }
}

// Disconnect from Google Calendar
async function disconnectFromGoogleCalendar() {
    try {
        const user = firebase.auth().currentUser;
        if (user) {
            await firebase.firestore().collection('teachers').doc(user.uid).set({
                googleCalendar: {
                    connected: false,
                    accessToken: null,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }
            }, { merge: true });
            console.log('Google Calendar disconnected');
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error disconnecting from Google Calendar:', error);
        return false;
    }
}

// Check if Google Calendar is connected
async function isGoogleCalendarConnected() {
    try {
        const teacher = await getCurrentTeacherDoc();
        if (teacher?.teacherData.googleCalendar) {
            return !!teacher.teacherData.googleCalendar.connected;
        }
        return false;
    } catch (error) {
        console.error('Error checking Google Calendar connection:', error);
        return false;
    }
}

// Get events from Google Calendar for a specific date range
async function getGoogleCalendarEvents(startDate, endDate) {
    try {
        console.log("Getting Google Calendar events from", startDate, "to", endDate);
        
        // Load booking settings from Firebase if not loaded
        if (!window.bookingSettings || !window.bookingSettings.timezone) {
            console.log("Booking settings not loaded, loading from Firebase...");
            try {
                const user = firebase.auth().currentUser;
                if (user) {
                    const teacherRef = window.db.collection("teachers").doc(user.uid);
                    const teacherSnap = await teacherRef.get();
                    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
                    if (teacherData.bookingSettings) {
                        window.bookingSettings = { ...window.bookingSettings, ...teacherData.bookingSettings };
                    } else {
                        const ref = window.db.collection("bookingSettings").doc("primary");
                        const snap = await ref.get();
                        if (snap.exists) {
                            window.bookingSettings = { ...window.bookingSettings, ...snap.data() };
                        }
                    }
                    console.log("Booking settings loaded from Firebase:", window.bookingSettings);
                }
            } catch (e) {
                console.error("Error loading booking settings from Firebase:", e);
            }
        }
        // Try to get teacher's Google Calendar connection
        const teacher = await getCurrentTeacherDoc();
        if (!teacher || !teacher.teacherData.googleCalendar?.connected) {
            console.log('Google Calendar not connected for teacher');
            return [];
        }

        const token = await ensureGoogleCalendarAccess({ interactive: false });
        if (!token) {
            console.log('Could not restore Google Calendar access token');
            return [];
        }
        
        console.log("Using access token for teacher:", teacher.teacherDoc.id);
        console.log("Access token:", accessToken ? "Found" : "Not found");

        // Get events from primary calendar
        const response = await googleCalendarApiRequest({
            calendarId,
            query: {
                timeMin: startDate.toISOString(),
                timeMax: endDate.toISOString(),
                singleEvents: 'true',
                orderBy: 'startTime',
            }
        });

        let allEvents = [...(response?.items || [])];
        console.log('Primary calendar events loaded:', response?.items?.length || 0, 'events');

        // Get events from Preply calendar if configured
        if (window.preplyCalendarId) {
            try {
                const preplyResponse = await googleCalendarApiRequest({
                    calendarId: window.preplyCalendarId,
                    query: {
                        timeMin: startDate.toISOString(),
                        timeMax: endDate.toISOString(),
                        singleEvents: 'true',
                        orderBy: 'startTime',
                    }
                });
                console.log('Preply calendar events loaded:', preplyResponse?.items?.length || 0, 'events');
                allEvents = [...allEvents, ...(preplyResponse?.items || [])];
            } catch (preplyErr) {
                console.error('Error getting Preply calendar events:', preplyErr);
                // Don't fail if Preply calendar fails
            }
        }

        console.log('Total Google Calendar events loaded:', allEvents.length, 'events');
        return allEvents;
    } catch (error) {
        if (isGoogleAuthError(error)) {
            await clearStoredGoogleCalendarConnection();
            throw new Error("Google Calendar authorization expired. Click Connect Google Calendar, then import again.");
        }
        console.error('Error getting Google Calendar events:', error);
        throw error;
    }
}

// Import Google Calendar events to teacher's busy blocks
window.importGoogleCalendarEventsToBusyBlocks = async function importGoogleCalendarEventsToBusyBlocks() {
    try {
        console.log("Importing Google Calendar events to busy blocks...");
        
        // Get teacher's Google Calendar connection
        const user = firebase.auth().currentUser;
        if (!user) {
            console.log("No user logged in");
            return { success: false, message: "No user logged in" };
        }
        
        const teacherDoc = await firebase.firestore().collection('teachers').doc(user.uid).get();
        if (!teacherDoc.exists) {
            console.log("Teacher not found");
            return { success: false, message: "Teacher not found" };
        }
        
        const teacherData = teacherDoc.data();
        if (!teacherData.googleCalendar || !teacherData.googleCalendar.connected) {
            console.log("Google Calendar not connected");
            return { success: false, message: "Google Calendar not connected" };
        }

        // Google Identity Services does not issue browser refresh tokens. Request
        // a current access token when the teacher explicitly starts an import.
        const token = await ensureGoogleCalendarAccess({ interactive: true });
        if (!token) {
            return { success: false, message: "Reconnect Google Calendar to import events." };
        }
        
        // Get events from Google Calendar for the next 30 days
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 30);
        
        const events = await getGoogleCalendarEvents(startDate, endDate);
        console.log(`Found ${events.length} events in Google Calendar`);
        
        const bookingRef = firebase.firestore().collection("teachers").doc(user.uid);
        const bookingSnap = await bookingRef.get();
        const bookingData = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
        const teacherBookingSettings = bookingData.bookingSettings || {};
        const existingExceptions = Array.isArray(teacherBookingSettings.exceptions) ? teacherBookingSettings.exceptions : [];
        // Imported calendar blocks are a mirror, not permanent manual exceptions.
        // Rebuild that part of the list so deleted/cancelled Google events become available again.
        const exceptions = existingExceptions.filter((block) => block?.source !== "googleCalendar");
        
        let addedCount = 0;
        let skippedCount = 0;
        
        const teacherTimezone = window.bookingSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

        // Add each event to busy blocks
        for (const event of events) {
            if (!event.start || !event.start.dateTime) continue;
            
            const eventStart = new Date(event.start.dateTime);
            const eventEnd = new Date(event.end?.dateTime || event.start.dateTime);
            const startParts = getPartsInTimeZone(eventStart, teacherTimezone);
            const endParts = getPartsInTimeZone(eventEnd, teacherTimezone);
            const dateStr = `${startParts.year}-${startParts.month}-${startParts.day}`;
            const startStr = `${startParts.hour}:${startParts.minute}`;
            const endStr = `${endParts.hour}:${endParts.minute}`;
            
            // Check if this slot is already in busy blocks
            const alreadyExists = exceptions.some(block => 
                block.date === dateStr && block.start === startStr && block.end === endStr
            );
            
            if (!alreadyExists) {
                exceptions.push({
                    date: dateStr,
                    start: startStr,
                    end: endStr,
                    note: event.summary || 'Google Calendar Event',
                    source: 'googleCalendar',
                    sourceEventId: event.id || ''
                });
                addedCount++;
            } else {
                skippedCount++;
            }
        }
        
        const syncTime = Date.now();
        const nextBookingSettings = { ...teacherBookingSettings, exceptions, lastGoogleSync: syncTime };
        await Promise.all([
            bookingRef.set({ bookingSettings: nextBookingSettings }, { merge: true }),
            firebase.firestore().collection("bookingSettings").doc("primary").set({
                exceptions,
                updatedAt: syncTime,
                lastGoogleSync: syncTime
            }, { merge: true })
        ]);
        window.bookingSettings = { ...window.bookingSettings, exceptions, lastGoogleSync: syncTime };
        
        console.log(`Imported ${addedCount} events, skipped ${skippedCount} existing events`);
        return { 
            success: true, 
            message: events.length
                ? `Synced ${addedCount} current calendar events${window.preplyCalendarId ? " (including Preply calendar)" : ""}.`
                : "Calendar sync is current; removed old imported busy blocks.",
            addedCount,
            skippedCount
        };
    } catch (error) {
        console.error("Error importing Google Calendar events:", error);
        return { success: false, message: error.message };
    }
}

// Create event in Google Calendar
async function createGoogleCalendarEvent(eventData) {
    try {
        console.log("Creating Google Calendar event...");
        
        // Load booking settings from Firebase if not loaded
        if (!window.bookingSettings || !window.bookingSettings.timezone) {
            console.log("Booking settings not loaded, loading from Firebase...");
            try {
                const user = firebase.auth().currentUser;
                if (user) {
                    const teacherRef = window.db.collection("teachers").doc(user.uid);
                    const teacherSnap = await teacherRef.get();
                    const teacherData = teacherSnap.exists ? (teacherSnap.data() || {}) : {};
                    if (teacherData.bookingSettings) {
                        window.bookingSettings = { ...window.bookingSettings, ...teacherData.bookingSettings };
                    } else {
                        const ref = window.db.collection("bookingSettings").doc("primary");
                        const snap = await ref.get();
                        if (snap.exists) {
                            window.bookingSettings = { ...window.bookingSettings, ...snap.data() };
                        }
                    }
                    console.log("Booking settings loaded from Firebase:", window.bookingSettings);
                }
            } catch (e) {
                console.error("Error loading booking settings from Firebase:", e);
            }
        }
        
        // Try to get teacher's Google Calendar connection
        const teacher = await getCurrentTeacherDoc();
        if (!teacher || !teacher.teacherData.googleCalendar?.connected) {
            console.log('Google Calendar not connected for teacher');
            return null;
        }
        const token = await ensureGoogleCalendarAccess({ interactive: false });
        if (!token) {
            console.log('Could not restore Google Calendar access token');
            return null;
        }

        console.log("Creating event in Google Calendar...");
        console.log("Event data:", eventData);
        const response = await googleCalendarApiRequest({
            method: 'POST',
            calendarId,
            body: eventData
        });

        console.log('Google Calendar event created:', response.id);
        console.log('Full response:', response);
        return response;
    } catch (error) {
        console.error('Error creating Google Calendar event:', error);
        return null;
    }
}

// Delete event from Google Calendar
async function deleteGoogleCalendarEvent(eventId) {
    try {
        const teacher = await getCurrentTeacherDoc();
        if (!teacher || !teacher.teacherData.googleCalendar?.connected) {
            return false;
        }
        const token = await ensureGoogleCalendarAccess({ interactive: false });
        if (!token) return false;

        await googleCalendarApiRequest({
            method: 'DELETE',
            calendarId,
            path: `events/${encodeURIComponent(eventId)}`
        });

        return true;
    } catch (error) {
        console.error('Error deleting Google Calendar event:', error);
        return false;
    }
}

// Check if a time slot is available in Google Calendar
async function isSlotAvailableInGoogleCalendar(date, time) {
    try {
        console.log("Checking Google Calendar availability for", date, "at", time);
        
        const startDateTime = new Date(date);
        const [hours, minutes] = time.split(':');
        startDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        // Use bookingSettings from Firebase if available
        const slotMinutes = window.bookingSettings ? window.bookingSettings.slotMinutes : 50;
        console.log("Using slot minutes:", slotMinutes);
        
        const endDateTime = new Date(startDateTime);
        endDateTime.setMinutes(endDateTime.getMinutes() + slotMinutes);

        console.log("Fetching Google Calendar events from", startDateTime, "to", endDateTime);
        const events = await getGoogleCalendarEvents(startDateTime, endDateTime);
        console.log("Found", events.length, "events in Google Calendar");

        // Check if any event overlaps with the requested time slot
        for (const event of events) {
            const eventStart = new Date(event.start.dateTime || event.start.date);
            const eventEnd = new Date(event.end.dateTime || event.end.date);
            console.log("Checking event:", event.summary, "from", eventStart, "to", eventEnd);

            if (eventStart < endDateTime && eventEnd > startDateTime) {
                console.log("Slot is NOT available due to event:", event.summary);
                return false; // Slot is not available
            }
        }

        console.log("Slot is available in Google Calendar");
        return true; // Slot is available
    } catch (error) {
        console.error('Error checking slot availability in Google Calendar:', error);
        return true; // Assume available if there's an error
    }
}

window.createGoogleCalendarEvent = createGoogleCalendarEvent;
window.deleteGoogleCalendarEvent = deleteGoogleCalendarEvent;
window.getGoogleCalendarEvents = getGoogleCalendarEvents;
window.connectToGoogleCalendar = connectToGoogleCalendar;
window.disconnectFromGoogleCalendar = disconnectFromGoogleCalendar;
window.isGoogleCalendarConnected = isGoogleCalendarConnected;
window.ensureGoogleCalendarAccess = ensureGoogleCalendarAccess;
window.testPreplyCalendarAccess = testPreplyCalendarAccess;
window.normalizeCalendarId = normalizeCalendarId;
