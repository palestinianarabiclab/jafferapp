const defaultAppConfig = {
    firebase: {
        apiKey: "AIzaSyC0haaF1Y9I-cbDfaHhSYD38COP_sMLnNI",
        authDomain: "palestinian-arabic-lab.firebaseapp.com",
        projectId: "palestinian-arabic-lab",
        storageBucket: "palestinian-arabic-lab.firebasestorage.app",
        messagingSenderId: "867160813546",
        appId: "1:867160813546:web:fe81642287dff700ab4c93",
        measurementId: "G-Q2GHE6545F",
    },
    googleCalendar: {
        clientId: "728875114917-im3ui9lcb471mc43h11bgoq5fbr9kvu2.apps.googleusercontent.com",
        apiKey: "AIzaSyB6yy0l267FTMVc2tp8t_97L7PSin7Wx7A",
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest"],
        scopes: "https://www.googleapis.com/auth/calendar.events",
        redirectUri: window.location.origin + "/",
    },
    emailjs: {
        publicKey: "",
        serviceId: "",
        templateId: "",
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

window.emailJsConfig = {
    publicKey: appConfig.emailjs?.publicKey || "",
    serviceId: appConfig.emailjs?.serviceId || "",
    templateId: appConfig.emailjs?.templateId || "",
};
