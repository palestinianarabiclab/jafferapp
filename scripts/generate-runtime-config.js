const fs = require("fs");
const path = require("path");

function env(...names) {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }
    return "";
}

function splitList(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

const googleDiscoveryDocs = splitList(env("GOOGLE_CALENDAR_DISCOVERY_DOCS"));

const config = {
    firebase: {
        apiKey: env("FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_API_KEY", "VITE_FIREBASE_API_KEY"),
        authDomain: env("FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_AUTH_DOMAIN"),
        projectId: env("FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID"),
        storageBucket: env("FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_STORAGE_BUCKET"),
        messagingSenderId: env("FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_MESSAGING_SENDER_ID"),
        appId: env("FIREBASE_APP_ID", "NEXT_PUBLIC_FIREBASE_APP_ID", "VITE_FIREBASE_APP_ID"),
        measurementId: env("FIREBASE_MEASUREMENT_ID", "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID", "VITE_FIREBASE_MEASUREMENT_ID"),
    },
    googleCalendar: {
        clientId: env("GOOGLE_CALENDAR_CLIENT_ID", "NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID", "VITE_GOOGLE_CALENDAR_CLIENT_ID"),
        apiKey: env("GOOGLE_CALENDAR_API_KEY", "NEXT_PUBLIC_GOOGLE_CALENDAR_API_KEY", "VITE_GOOGLE_CALENDAR_API_KEY"),
        discoveryDocs: googleDiscoveryDocs.length ? googleDiscoveryDocs : [
            "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
        ],
        scopes: env("GOOGLE_CALENDAR_SCOPES") || "https://www.googleapis.com/auth/calendar.events",
        redirectUri: env("GOOGLE_CALENDAR_REDIRECT_URI", "NEXT_PUBLIC_GOOGLE_CALENDAR_REDIRECT_URI", "VITE_GOOGLE_CALENDAR_REDIRECT_URI"),
    },
    emailjs: {
        publicKey: env("EMAILJS_PUBLIC_KEY", "NEXT_PUBLIC_EMAILJS_PUBLIC_KEY", "VITE_EMAILJS_PUBLIC_KEY"),
        serviceId: env("EMAILJS_SERVICE_ID", "NEXT_PUBLIC_EMAILJS_SERVICE_ID", "VITE_EMAILJS_SERVICE_ID"),
        templateId: env("EMAILJS_TEMPLATE_ID", "NEXT_PUBLIC_EMAILJS_TEMPLATE_ID", "VITE_EMAILJS_TEMPLATE_ID"),
    },
};

if (!config.googleCalendar.redirectUri) {
    config.googleCalendar.redirectUri = "window.location.origin + \"/\"";
}

const serialized = JSON.stringify(config, null, 4)
    .replace('"window.location.origin + \\"/\\""', 'window.location.origin + "/"');
const output = `window.__APP_CONFIG__ = ${serialized};\n`;
const outputPath = path.join(__dirname, "..", "js", "config.runtime.js");
const isVercel = Boolean(process.env.VERCEL);
const force = process.argv.includes("--force");
const hasFirebaseConfig = Boolean(
    config.firebase.apiKey &&
    config.firebase.authDomain &&
    config.firebase.projectId &&
    config.firebase.appId
);

if (!isVercel && !force && fs.existsSync(outputPath) && !hasFirebaseConfig) {
    console.log(
        "Skipped local config generation because Firebase env vars are missing. Use --force to overwrite."
    );
    process.exit(0);
}

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Generated ${path.relative(process.cwd(), outputPath)} for deployment.`);
