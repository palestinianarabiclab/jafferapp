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
6. Click `Install Lesson Reminders` to send student reminder emails about 15 minutes before each lesson

After changing `apps-script/booking-sync.gs`, create a new Apps Script deployment version, then keep the same Web App URL in the dashboard unless Google gives you a new one.

## 5. Lesson Reminders

The script supports two reminder paths:

- New Google Calendar events get a 15-minute popup/email reminder.
- A time trigger checks every 5 minutes for lessons starting in about 15 minutes and sends one reminder email to the student.

To enable the automatic email reminders:

1. Deploy the latest `apps-script/booking-sync.gs`.
2. Open the teacher dashboard.
3. Click `Test Apps Script`.
4. Click `Install Lesson Reminders`.
5. Optional: click `Check Reminders Now` to run one manual check.

The script stores sent reminder markers in Apps Script properties so the same booking does not receive duplicate reminder emails.

## 6. Optional

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
