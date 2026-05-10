# Lesson Booking Studio

Booking app focused on two roles only:

- `Student`: views available lesson slots and books a session
- `Teacher`: manages availability, busy blocks, bookings, Apps Script sync, and Google Calendar

## What This Project Is

This repository is now a standalone booking product.

The previous lesson/LMS code was removed from the active app flow, and the repo was cleaned to keep only the booking-related parts.

## Main Features

- Student booking calendar
- Booking status lookup by email
- Teacher-only dashboard
- Protected teacher login modal
- Weekly availability management
- Manual busy blocks
- Google Apps Script integration
- Google Calendar integration
- Booking cancel and reschedule tools

## Project Structure

```text
/
├── index.html
├── styles.css
├── firestore.rules
├── apps-script/
│   └── booking-sync.gs
└── js/
    ├── app.js
    ├── booking-app.js
    ├── apps-script-sync.js
    ├── google-calendar.js
    ├── config.js
    ├── core/
    │   └── errorHandler.js
    └── logic/
        ├── authFlows.js
        ├── bookingAvailability.js
        ├── bookingSettingsStore.js
        ├── contactSettingsStore.js
        ├── guestBookingFlow.js
        ├── teacherAccess.js
        └── teacherBookingAdmin.js
```

## Local Setup

### 1. Runtime Config

Create `js/config.runtime.js` locally and provide:

- Firebase config
- Google Calendar client config

This file is ignored by git.

### 2. Firebase

Set up:

- Firebase Authentication
- Firestore
- teacher user documents
- teacher role in `users/{uid}`

### 3. Google Calendar

Set up:

- Google Calendar API
- OAuth client
- approved redirect URI matching your deployment

### 4. Apps Script

Deploy `apps-script/booking-sync.gs` as a Web App, then save the URL from the teacher dashboard.

## Run

Serve the project locally with any static server, for example:

```bash
npx serve
```

Then open the local URL in the browser.

## Deploy on Vercel

Vercel builds this as a static site. Add these Environment Variables in the Vercel project settings, then redeploy:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID` optional
- `GOOGLE_CALENDAR_CLIENT_ID` optional, for teacher Google Calendar sync
- `GOOGLE_CALENDAR_API_KEY` optional, for teacher Google Calendar sync
- `GOOGLE_CALENDAR_REDIRECT_URI` optional. Use your Vercel URL with a trailing slash, for example `https://your-site.vercel.app/`.
- `EMAILJS_PUBLIC_KEY` optional
- `EMAILJS_SERVICE_ID` optional
- `EMAILJS_TEMPLATE_ID` optional

During deployment, `vercel.json` runs `node scripts/generate-runtime-config.js`, which creates `js/config.runtime.js` from those variables.

Also add your Vercel domain to:

- Firebase Authentication > Settings > Authorized domains
- Google Cloud OAuth Client > Authorized JavaScript origins and redirect URIs, if Google Calendar sync is enabled

## Notes

- The app starts on the student booking screen.
- The teacher dashboard can only be opened by signing in with a teacher account.
- Public booking availability is mirrored from teacher settings.
