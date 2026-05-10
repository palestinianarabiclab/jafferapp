const appConfig = window.__APP_CONFIG__ || {};
const firebaseConfig = appConfig.firebase || {};
const hasFirebaseConfig = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

window.firebaseConfig = hasFirebaseConfig ? firebaseConfig : null;
window.googleCalendarConfig = {
    clientId: appConfig.googleCalendar?.clientId || "",
    apiKey: appConfig.googleCalendar?.apiKey || "",
    discoveryDocs: appConfig.googleCalendar?.discoveryDocs || [
        "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    ],
    scopes:
        appConfig.googleCalendar?.scopes ||
        "https://www.googleapis.com/auth/calendar.events",
    redirectUri:
        appConfig.googleCalendar?.redirectUri || window.location.origin + "/",
};

window.emailJsConfig = {
    publicKey: appConfig.emailjs?.publicKey || "",
    serviceId: appConfig.emailjs?.serviceId || "",
    templateId: appConfig.emailjs?.templateId || "",
};

if (!window.__APP_CONFIG__) {
    console.warn(
        "Runtime app config is missing. Create js/config.runtime.js locally or inject it during deployment."
    );
}
