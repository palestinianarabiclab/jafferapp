# Google Apps Script Setup

This is the stable path for:
- importing busy times from Google / Preply
- sending guest bookings to Google Calendar
- working without keeping the teacher dashboard open

## 1. Create the Apps Script

1. Open `https://script.google.com`
2. Create a new project
3. Replace the default file with the contents of:
   - `apps-script/booking-sync.gs`
4. Open `Project Settings`
5. Enable `Show "appsscript.json" manifest file in editor`
6. Open `appsscript.json` and replace it with:
   - `apps-script/appsscript.json`

## 2. Set Script Properties

In Apps Script:
1. `Project Settings`
2. `Script properties`
3. Add:

`PRIMARY_CALENDAR_ID`
: usually `primary`

`PREPLY_CALENDAR_ID`
: your Preply Google calendar ID

`ADDITIONAL_CALENDAR_IDS`
: optional. Add any other Google Calendar IDs that should block student booking times. Separate multiple IDs with commas or new lines.

`DEFAULT_TIMEZONE`
: for example `Africa/Cairo`

`FIREBASE_API_KEY`
: your Firebase Web API key. For this app it is the `apiKey` from `js/config.js`.

`FIREBASE_PROJECT_ID`
: for this app, use `jafferapp`.

`FIREBASE_TEACHER_EMAIL`
: the teacher login email.

## 3. Deploy as Web App

1. Click `Deploy`
2. `New deployment`
3. Type: `Web app`
4. Execute as: `Me`
5. Who has access: `Anyone`
6. Deploy
7. Copy the `Web app URL`

## 4. Add it to the Teacher Dashboard

In your site:
1. Open Teacher Dashboard
2. Paste the Web App URL into `Apps Script Web App URL`
3. Click `Save Apps Script URL`
4. Click `Test Apps Script`
5. Click `Import Busy via Apps Script`
6. Do not create a reminder trigger. Each lesson’s Google Calendar event contains its own 15-minute reminder.

After changing `apps-script/booking-sync.gs`, create a new Apps Script deployment version, then keep the same Web App URL in the dashboard unless Google gives you a new one.

## 5. Lesson Reminders

Each new lesson event gets a 15-minute popup/email reminder and the student is added as an attendee. No time-driven reminder trigger is required. If an old `sendUpcomingLessonReminders` trigger exists, run that function once or remove it from the Apps Script Triggers page; the function now removes the legacy trigger without sending duplicate mail.

## 6. Balance Deductions

Balance reconciliation runs from the authenticated teacher dashboard. There is no Apps Script balance trigger, and no Firebase teacher password should be stored in Script Properties.

## 7. Optional

If you also want Preply busy times:
1. Save your Preply calendar ID in Apps Script properties
2. Also save it in the teacher dashboard for easier testing

If you also have busy events on another Google Calendar:
1. Open that calendar settings in Google Calendar
2. Copy its `Calendar ID`
3. Add it to `ADDITIONAL_CALENDAR_IDS`
4. Deploy a new Apps Script version

## Notes

- This removes the dependency on the teacher page staying open.
- It does not use the browser Google token for booking sync.
- If Apps Script cannot access the Preply calendar, the Google account that owns the script likely does not have permission to that calendar.
- Reminder email sending uses your Apps Script / Gmail daily quota.
