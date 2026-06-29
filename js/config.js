const defaultAppConfig = {
    firebase: {
        apiKey: "AIzaSyCfhVE4hdR5P7YW6JOAnSC5az7s-J8zEsc",
        authDomain: "jafferapp.firebaseapp.com",
        projectId: "jafferapp",
        storageBucket: "jafferapp.firebasestorage.app",
        messagingSenderId: "961546340485",
        appId: "1:961546340485:web:4fe14b35ab8237a2b341ec",
        measurementId: "G-CVBP7PJQ4S",
    },
    googleCalendar: {
        clientId: "94644871563-i0vjdvo90lpkmr4h5lam6kr5b7e1bs32.apps.googleusercontent.com",
        apiKey: "AIzaSyAZjBy_dpnzXDfzKIpU3UUCQ_tSmmitE-o",
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
        scopes: "https://www.googleapis.com/auth/calendar.events",
        redirectUri: window.location.origin + "/",
    },
};

const appConfig = window.__APP_CONFIG__ || defaultAppConfig;
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
