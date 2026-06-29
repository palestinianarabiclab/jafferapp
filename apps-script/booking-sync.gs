function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isTransientGoogleError_(err) {
  const message = String(err && err.message ? err.message : err || '').toLowerCase();
  return message.indexOf('service is currently unavailable') !== -1 ||
    message.indexOf('server error occurred') !== -1 ||
    message.indexOf('error code internal') !== -1 ||
    message.indexOf('internal error') !== -1 ||
    message.indexOf('backend error') !== -1 ||
    message.indexOf('timed out') !== -1 ||
    message.indexOf('rate limit') !== -1 ||
    message.indexOf('too many requests') !== -1;
}

function isRetryableHttpStatus_(status) {
  return status === 429 || status >= 500;
}

function withGoogleRetry_(label, fn) {
  const delays = [500, 1500, 3500];
  let lastErr = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientGoogleError_(err) || attempt === delays.length) {
        break;
      }
      Utilities.sleep(delays[attempt]);
    }
  }
  throw new Error(label + ' failed after retry: ' + (lastErr && lastErr.message ? lastErr.message : lastErr));
}

function getScriptProperty_(props, name, fallback) {
  const value = withGoogleRetry_('Read script property ' + name, function () {
    return props.getProperty(name);
  });
  return value || fallback || '';
}

function getDefaultNotificationEmail_() {
  try {
    return normalizeEmail_(Session.getEffectiveUser().getEmail());
  } catch (err) {
    return '';
  }
}

function getConfig_() {
  const props = withGoogleRetry_('Read script properties', function () {
    return PropertiesService.getScriptProperties();
  });
  const preplyRaw = getScriptProperty_(props, 'PREPLY_CALENDAR_ID', '');
  const additionalRaw = getScriptProperty_(props, 'ADDITIONAL_CALENDAR_IDS', '');
  return {
    firebaseApiKey: getScriptProperty_(props, 'FIREBASE_API_KEY', 'AIzaSyCfhVE4hdR5P7YW6JOAnSC5az7s-J8zEsc'),
    firebaseProjectId: getScriptProperty_(props, 'FIREBASE_PROJECT_ID', 'jafferapp'),
    firebaseTeacherEmail: getScriptProperty_(props, 'FIREBASE_TEACHER_EMAIL', ''),
    firebaseTeacherPassword: getScriptProperty_(props, 'FIREBASE_TEACHER_PASSWORD', ''),
    primaryCalendarId: getScriptProperty_(props, 'PRIMARY_CALENDAR_ID', 'primary'),
    preplyCalendarId: normalizeCalendarId_(preplyRaw),
    additionalCalendarIds: parseCalendarIds_(additionalRaw),
    defaultTimeZone: getScriptProperty_(props, 'DEFAULT_TIMEZONE', '') || Session.getScriptTimeZone() || 'Africa/Cairo',
    notificationEmail: getScriptProperty_(props, 'NOTIFICATION_EMAIL', '') || getDefaultNotificationEmail_(),
  };
}

const STUDENT_CHANGE_CUTOFF_MS_ = 12 * 60 * 60 * 1000;

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail_(value));
}

function sendPlainEmail_(recipient, subject, body) {
  const email = normalizeEmail_(recipient);
  if (!email) return false;
  MailApp.sendEmail(email, subject, body);
  return true;
}

function getEmailQuotaPayload_() {
  const remaining = MailApp.getRemainingDailyQuota();
  return {
    success: true,
    message: 'Email quota loaded.',
    emailQuotaRemaining: remaining,
    quotaType: 'remaining_daily_recipients',
    resetWindow: 'Google resets quotas about 24 hours after the first send.',
  };
}

function sendBookingNotificationEmail_(recipient, details) {
  const subject = 'New lesson booking: ' + (details.name || 'Student');
  const body = [
    'A new lesson booking was created.',
    '',
    'Student: ' + (details.name || ''),
    'Email: ' + (details.email || ''),
    'Phone: ' + (details.phone || ''),
    'Slot: ' + (details.slotLabel || ''),
    'Timezone: ' + (details.timeZone || ''),
    'Booking ID: ' + (details.bookingId || ''),
    '',
    'Notes:',
    details.notes || 'None'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function sendBookingCancellationEmail_(recipient, details) {
  const subject = 'Lesson booking canceled: ' + (details.name || 'Student');
  const body = [
    'A lesson booking was canceled.',
    '',
    'Canceled by: ' + (details.canceledBy || 'Student'),
    'Student: ' + (details.name || ''),
    'Email: ' + (details.email || ''),
    'Phone: ' + (details.phone || ''),
    'Slot: ' + (details.slotLabel || ''),
    'Timezone: ' + (details.timeZone || ''),
    'Booking ID: ' + (details.bookingId || ''),
    '',
    'Notes:',
    details.notes || 'None'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function sendStudentConfirmationEmail_(recipient, details) {
  const subject = 'Your lesson booking is confirmed';
  const body = [
    'Hello ' + (details.name || 'Student') + ',',
    '',
    'Your lesson has been booked successfully.',
    '',
    'Date & time: ' + (details.slotLabel || ''),
    'Teacher timezone: ' + (details.timeZone || ''),
    'Booking ID: ' + (details.bookingId || ''),
    '',
    'If you need to change the booking, please reply to this email or contact us on WhatsApp.',
    '',
    'Thank you.'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function sendLessonReminderEmail_(recipient, details) {
  const subject = 'Reminder: your lesson starts in 15 minutes';
  const body = [
    'Hello ' + (details.name || 'Student') + ',',
    '',
    'This is a quick reminder that your lesson starts in about 15 minutes.',
    '',
    'Date & time: ' + (details.slotLabel || ''),
    'Teacher timezone: ' + (details.timeZone || ''),
    'Booking ID: ' + (details.bookingId || ''),
    '',
    'Please be ready a few minutes early.',
    '',
    'See you soon.'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function normalizeCalendarId_(value) {
  const raw = (value || '').trim();
  if (!raw) return '';
  if (raw.indexOf('calendar.google.com') === -1) return raw;
  const srcMatch = raw.match(/[?&]src=([^&]+)/i);
  return srcMatch && srcMatch[1] ? decodeURIComponent(srcMatch[1]) : raw;
}

function parseEventDetails_(event, config) {
  const description = event.getDescription() || '';
  function pick(label) {
    const match = description.match(new RegExp('^' + label + ':\\s*(.*)$', 'mi'));
    return match && match[1] ? match[1].trim() : '';
  }
  return {
    bookingId: pick('Booking ID'),
    name: pick('Student') || event.getTitle().replace(/^Lesson with\s+/i, ''),
    email: pick('Email'),
    phone: pick('Phone'),
    timeZone: pick('Timezone') || config.defaultTimeZone,
    slotLabel: Utilities.formatDate(event.getStartTime(), pick('Timezone') || config.defaultTimeZone, 'yyyy-MM-dd HH:mm'),
  };
}

function getReminderKey_(event, details) {
  return 'lesson_reminder_15_' + (details.bookingId || event.getId());
}

function sendUpcomingLessonReminders() {
  const config = getConfig_();
  const cal = CalendarApp.getCalendarById(config.primaryCalendarId);
  if (!cal) {
    return { success: false, message: 'Primary calendar not found.', sentCount: 0 };
  }

  const now = new Date();
  const start = new Date(now.getTime() + 5 * 60 * 1000);
  const end = new Date(now.getTime() + 20 * 60 * 1000);
  const events = cal.getEvents(start, end).filter(function (event) {
    return (event.getDescription() || '').indexOf('Booking ID:') !== -1;
  });
  const props = PropertiesService.getScriptProperties();
  let sentCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  events.forEach(function (event) {
    const details = parseEventDetails_(event, config);
    const key = getReminderKey_(event, details);
    if (props.getProperty(key)) {
      skippedCount += 1;
      return;
    }
    if (!isValidEmail_(details.email)) {
      failedCount += 1;
      return;
    }
    try {
      const sent = sendLessonReminderEmail_(details.email, details);
      if (sent) {
        props.setProperty(key, String(Date.now()));
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    } catch (err) {
      failedCount += 1;
    }
  });

  return {
    success: failedCount === 0,
    message: 'Reminder check finished.',
    sentCount: sentCount,
    skippedCount: skippedCount,
    failedCount: failedCount,
    checkedCount: events.length,
    windowStart: start.getTime(),
    windowEnd: end.getTime(),
  };
}

function installLessonReminderTrigger() {
  return {
    success: false,
    manualSetupRequired: true,
    message: 'Create the reminder trigger manually in Apps Script: Triggers > Add Trigger > sendUpcomingLessonReminders > Time-driven > Minutes timer > Every 5 minutes.',
  };
}

function getLessonReminderTriggerStatus_() {
  return {
    success: true,
    message: 'Reminder trigger status must be checked from the Apps Script Triggers page.',
    triggerInstalled: null,
    triggerCount: null,
  };
}

function firebaseSignIn_(config) {
  if (!config.firebaseApiKey || !config.firebaseTeacherEmail || !config.firebaseTeacherPassword) {
    throw new Error('Missing FIREBASE_API_KEY, FIREBASE_TEACHER_EMAIL, or FIREBASE_TEACHER_PASSWORD in Script Properties.');
  }
  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(config.firebaseApiKey);
  const res = withGoogleRetry_('Firebase teacher sign-in', function () {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        email: config.firebaseTeacherEmail,
        password: config.firebaseTeacherPassword,
        returnSecureToken: true,
      }),
    });
    if (isRetryableHttpStatus_(response.getResponseCode())) {
      throw new Error('Firebase teacher sign-in returned HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
    }
    return response;
  });
  const text = res.getContentText();
  const data = text ? JSON.parse(text) : {};
  if (res.getResponseCode() >= 300 || !data.idToken) {
    throw new Error(data.error && data.error.message ? data.error.message : 'Firebase teacher sign-in failed.');
  }
  return data.idToken;
}

function firestoreBaseUrl_(projectId) {
  return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/databases/(default)/documents';
}

function firestoreFetch_(config, token, path, options) {
  const res = withGoogleRetry_('Firestore request ' + path, function () {
    const response = UrlFetchApp.fetch(firestoreBaseUrl_(config.firebaseProjectId) + path, Object.assign({
      muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
    }, options || {}));
    if (isRetryableHttpStatus_(response.getResponseCode())) {
      throw new Error('Firestore request returned HTTP ' + response.getResponseCode() + ': ' + response.getContentText());
    }
    return response;
  });
  const text = res.getContentText();
  const data = text ? JSON.parse(text) : {};
  if (res.getResponseCode() >= 300) {
    throw new Error(data.error && data.error.message ? data.error.message : 'Firestore request failed.');
  }
  return data;
}

function firestoreRunQuery_(config, token, structuredQuery) {
  const payload = JSON.stringify({ structuredQuery: structuredQuery });
  const data = firestoreFetch_(config, token, ':runQuery', {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
  });
  return data
    .map(function (row) { return row.document || null; })
    .filter(function (doc) { return !!doc; });
}

function fsField_(doc, name) {
  return doc && doc.fields ? doc.fields[name] : null;
}

function fsString_(doc, name) {
  const value = fsField_(doc, name);
  return value ? String(value.stringValue || '') : '';
}

function fsNumber_(doc, name) {
  const value = fsField_(doc, name);
  if (!value) return 0;
  if (value.integerValue !== undefined) return Number(value.integerValue || 0);
  if (value.doubleValue !== undefined) return Number(value.doubleValue || 0);
  return 0;
}

function fsBool_(doc, name) {
  const value = fsField_(doc, name);
  return !!(value && value.booleanValue);
}

function firestoreQueryBalanceCandidates_(config, token, now) {
  const docsByName = {};
  function addDocs(docs) {
    docs.forEach(function (doc) {
      docsByName[doc.name] = doc;
    });
  }

  addDocs(firestoreRunQuery_(config, token, {
    from: [{ collectionId: 'bookings' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'slot' },
        op: 'LESS_THAN_OR_EQUAL',
        value: { integerValue: String(now) },
      },
    },
    orderBy: [{ field: { fieldPath: 'slot' }, direction: 'DESCENDING' }],
    limit: 300,
  }));

  addDocs(firestoreRunQuery_(config, token, {
    from: [{ collectionId: 'bookings' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'EQUAL',
        value: { stringValue: 'canceled' },
      },
    },
    limit: 300,
  }));

  return Object.keys(docsByName).map(function (name) {
    return docsByName[name];
  });
}

function firestoreGetUser_(config, token, uid) {
  return firestoreFetch_(config, token, '/users/' + encodeURIComponent(uid), { method: 'get' });
}

function firestoreCommitBalanceCharge_(config, token, bookingDoc, studentUid, newBalance, lessonPrice, reason, now) {
  const userName = firestoreBaseUrl_(config.firebaseProjectId) + '/users/' + studentUid;
  const bookingName = bookingDoc.name;
  return firestoreFetch_(config, token, ':commit', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      writes: [
        {
          update: {
            name: userName,
            fields: {
              balance: { doubleValue: Number(newBalance) },
              financeUpdatedAt: { integerValue: String(now) },
              updatedAt: { timestampValue: new Date(now).toISOString() },
            },
          },
          updateMask: { fieldPaths: ['balance', 'financeUpdatedAt', 'updatedAt'] },
        },
        {
          update: {
            name: bookingName,
            fields: {
              balanceChargedAt: { integerValue: String(now) },
              chargedAmount: { doubleValue: Number(lessonPrice) },
              chargeReason: { stringValue: reason },
              updatedAt: { integerValue: String(now) },
            },
          },
          updateMask: { fieldPaths: ['balanceChargedAt', 'chargedAmount', 'chargeReason', 'updatedAt'] },
        },
      ],
    }),
  });
}

function reconcileStudentBalancesFromFirestoreUnsafe_() {
  const config = getConfig_();
  const token = firebaseSignIn_(config);
  const now = Date.now();
  const bookings = firestoreQueryBalanceCandidates_(config, token, now);
  const users = {};
  let chargedCount = 0;
  let skippedCount = 0;
  let missingPriceCount = 0;
  let failedCount = 0;

  bookings.forEach(function (bookingDoc) {
    try {
      const studentUid = fsString_(bookingDoc, 'studentUid');
      const status = (fsString_(bookingDoc, 'status') || 'booked').toLowerCase();
      const slot = fsNumber_(bookingDoc, 'slot');
      const canceledAt = fsNumber_(bookingDoc, 'canceledAt');
      const canceledBy = (fsString_(bookingDoc, 'canceledBy') || 'student').toLowerCase();
      if (!studentUid || fsBool_(bookingDoc, 'balanceChargedAt') || fsNumber_(bookingDoc, 'balanceChargedAt')) {
        skippedCount += 1;
        return;
      }

      const shouldChargeAttended = slot <= now && (status === 'booked' || status === 'rescheduled');
      const lateCanceled = status === 'canceled' &&
        canceledBy === 'student' &&
        canceledAt &&
        slot - canceledAt < STUDENT_CHANGE_CUTOFF_MS_;
      if (!shouldChargeAttended && !lateCanceled) {
        skippedCount += 1;
        return;
      }

      if (!users[studentUid]) {
        users[studentUid] = firestoreGetUser_(config, token, studentUid);
      }
      const userDoc = users[studentUid];
      const lessonPrice = fsNumber_(bookingDoc, 'lessonPrice') || fsNumber_(userDoc, 'lessonPrice');
      if (!lessonPrice) {
        missingPriceCount += 1;
        return;
      }
      const currentBalance = fsNumber_(userDoc, 'balance');
      const newBalance = currentBalance - lessonPrice;
      const reason = lateCanceled ? 'late-cancel' : 'lesson';
      firestoreCommitBalanceCharge_(config, token, bookingDoc, studentUid, newBalance, lessonPrice, reason, now);
      users[studentUid].fields.balance = { doubleValue: Number(newBalance) };
      chargedCount += 1;
    } catch (err) {
      failedCount += 1;
    }
  });

  return {
    success: failedCount === 0,
    message: 'Balance reconciliation finished.',
    checkedCount: bookings.length,
    chargedCount: chargedCount,
    skippedCount: skippedCount,
    missingPriceCount: missingPriceCount,
    failedCount: failedCount,
  };
}

function reconcileStudentBalancesFromFirestore() {
  try {
    return reconcileStudentBalancesFromFirestoreUnsafe_();
  } catch (err) {
    return {
      success: false,
      message: 'Balance reconciliation skipped: ' + (err && err.message ? err.message : String(err)),
      checkedCount: 0,
      chargedCount: 0,
      skippedCount: 0,
      missingPriceCount: 0,
      failedCount: 1,
    };
  }
}

function parseCalendarIds_(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(function (item) {
      return normalizeCalendarId_(item);
    })
    .filter(function (item, index, list) {
      return item && list.indexOf(item) === index;
    });
}

function getBusyCalendarIds_(config) {
  const ids = [config.primaryCalendarId || 'primary'];
  if (config.preplyCalendarId) ids.push(config.preplyCalendarId);
  (config.additionalCalendarIds || []).forEach(function (id) {
    if (ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

function parseRequest_(e) {
  let body = {};
  try {
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
  } catch (err) {}
  const params = (e && e.parameter) || {};
  return Object.assign({}, params, body);
}

function listEvents_(calendarId, start, end) {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return [];
  return cal.getEvents(start, end).map(function (event) {
    return {
      id: event.getId(),
      title: event.getTitle(),
      start: event.getStartTime().getTime(),
      end: event.getEndTime().getTime(),
      calendarId: calendarId,
    };
  });
}

function hasConflictingEvent_(calendarIds, start, end) {
  for (var i = 0; i < calendarIds.length; i += 1) {
    const events = listEvents_(calendarIds[i], start, end);
    for (var j = 0; j < events.length; j += 1) {
      const event = events[j];
      if (start.getTime() < Number(event.end || 0) && end.getTime() > Number(event.start || 0)) {
        return true;
      }
    }
  }
  return false;
}

function findBookingEvent_(cal, eventId, bookingId, slot) {
  if (eventId) {
    try {
      const event = cal.getEventById(eventId);
      if (event) return event;
    } catch (err) {}
  }
  if (!bookingId) return null;

  const center = slot ? new Date(Number(slot)) : new Date();
  const start = new Date(center.getTime() - 14 * 24 * 60 * 60 * 1000);
  const end = new Date(center.getTime() + 180 * 24 * 60 * 60 * 1000);
  const needle = 'Booking ID: ' + bookingId;
  let events = [];
  try {
    events = cal.getEvents(start, end, { search: needle });
  } catch (err) {
    events = cal.getEvents(start, end);
  }

  for (var i = 0; i < events.length; i += 1) {
    const description = events[i].getDescription() || '';
    if (description.indexOf(needle) !== -1) {
      return events[i];
    }
  }
  return null;
}

function buildBusyBlocks_(events, timeZone) {
  return events
    .slice()
    .sort(function (a, b) {
      return Number(a.start || 0) - Number(b.start || 0);
    })
    .map(function (event) {
      const start = new Date(event.start);
      const end = new Date(event.end);
      return {
        startMs: start.getTime(),
        endMs: end.getTime(),
        date: Utilities.formatDate(start, timeZone, 'yyyy-MM-dd'),
        start: Utilities.formatDate(start, timeZone, 'HH:mm'),
        end: Utilities.formatDate(end, timeZone, 'HH:mm'),
        note: event.title || 'Busy',
        sourceEventId: event.id || '',
      };
    });
}

function getBusyCacheKey_(calendarIds, days, timeZone) {
  return [
    'busy',
    String(days || 0),
    String(timeZone || ''),
    calendarIds.join('|')
  ].join('::');
}

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    const req = parseRequest_(e);
    const action = req.action || 'test';
    const config = getConfig_();

    if (action === 'test') {
      const primary = CalendarApp.getCalendarById(config.primaryCalendarId);
      return jsonOut({
        success: !!primary,
        message: primary ? 'Apps Script backend is reachable.' : 'Primary calendar not found.',
        timeZone: config.defaultTimeZone,
        preplyCalendarId: config.preplyCalendarId || '',
        additionalCalendarCount: (config.additionalCalendarIds || []).length,
        emailQuotaRemaining: getEmailQuotaPayload_().emailQuotaRemaining,
      });
    }

    if (action === 'getEmailQuota') {
      return jsonOut(getEmailQuotaPayload_());
    }

    if (action === 'getBusy') {
      const days = Math.max(1, Math.min(90, Number(req.days || 30)));
      const timeZone = req.timeZone || config.defaultTimeZone;
      const calendarIds = getBusyCalendarIds_(config);
      const cache = CacheService.getScriptCache();
      const cacheKey = getBusyCacheKey_(calendarIds, days, timeZone);
      const cached = cache.get(cacheKey);
      if (cached) {
        return ContentService
          .createTextOutput(cached)
          .setMimeType(ContentService.MimeType.JSON);
      }
      const start = new Date();
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
      let events = [];
      calendarIds.forEach(function (calendarId) {
        events = events.concat(listEvents_(calendarId, start, end));
      });
      const payload = {
        success: true,
        message: 'Busy times loaded.',
        busyBlocks: buildBusyBlocks_(events, timeZone),
        counts: {
          total: events.length,
          preplyEnabled: !!config.preplyCalendarId,
          calendarsChecked: calendarIds.length,
          additionalCalendars: (config.additionalCalendarIds || []).length,
        }
      };
      cache.put(cacheKey, JSON.stringify(payload), 120);
      return jsonOut(payload);
    }

    if (action === 'createBooking') {
      const slot = Number(req.slot || 0);
      const durationMinutes = Math.max(15, Math.min(240, Number(req.durationMinutes || 50)));
      const timeZone = req.timeZone || config.defaultTimeZone;
      const name = req.name || 'Student';
      const email = req.email || '';
      const phone = req.phone || '';
      const notes = req.notes || '';
      const bookingId = req.bookingId || '';
      const teacherEmail = normalizeEmail_(req.teacherEmail || config.notificationEmail);
      if (!slot) {
        return jsonOut({ success: false, message: 'Missing slot timestamp.' });
      }
      const start = new Date(slot);
      const end = new Date(slot + durationMinutes * 60 * 1000);
      if (hasConflictingEvent_(getBusyCalendarIds_(config), start, end)) {
        return jsonOut({
          success: false,
          message: 'That slot is no longer available. Please choose another time.'
        });
      }
      const cal = CalendarApp.getCalendarById(config.primaryCalendarId);
      if (!cal) {
        return jsonOut({ success: false, message: 'Primary calendar not found.' });
      }
      const description = [
        'Booked from Jaffer Booking',
        'Booking ID: ' + bookingId,
        'Student: ' + name,
        'Email: ' + email,
        'Phone: ' + phone,
        'Notes: ' + notes,
        'Timezone: ' + timeZone
      ].join('\n');
      const event = cal.createEvent('Lesson with ' + name, start, end, { description: description });
      try {
        event.addPopupReminder(15);
        event.addEmailReminder(15);
      } catch (reminderErr) {}
      var calendarInviteSent = false;
      var calendarInviteError = '';
      try {
        if (isValidEmail_(email)) {
          event.addGuest(normalizeEmail_(email));
          calendarInviteSent = true;
        } else {
          calendarInviteError = 'Student email is invalid for calendar invite.';
        }
      } catch (guestErr) {
        calendarInviteError = guestErr && guestErr.message ? guestErr.message : String(guestErr);
      }
      var notificationSent = false;
      var studentConfirmationSent = false;
      var notificationError = '';
      var studentConfirmationError = '';
      var slotLabel = Utilities.formatDate(start, timeZone, 'yyyy-MM-dd HH:mm');
      try {
        notificationSent = sendBookingNotificationEmail_(teacherEmail, {
          name: name,
          email: email,
          phone: phone,
          notes: notes,
          bookingId: bookingId,
          timeZone: timeZone,
          slotLabel: slotLabel
        });
        if (!notificationSent) {
          notificationError = teacherEmail ? 'Teacher notification email was not accepted.' : 'Teacher email is missing.';
        }
      } catch (mailErr) {
        notificationError = mailErr && mailErr.message ? mailErr.message : String(mailErr);
      }
      try {
        studentConfirmationSent = sendStudentConfirmationEmail_(email, {
          name: name,
          bookingId: bookingId,
          timeZone: timeZone,
          slotLabel: slotLabel
        });
        if (!studentConfirmationSent) {
          studentConfirmationError = email ? 'Student confirmation email was not accepted.' : 'Student email is missing.';
        }
      } catch (mailErr) {
        studentConfirmationError = mailErr && mailErr.message ? mailErr.message : String(mailErr);
      }
      return jsonOut({
        success: true,
        message: 'Booking added to Google Calendar.',
        eventId: event.getId(),
        calendarInviteSent: calendarInviteSent,
        calendarInviteError: calendarInviteError,
        notificationSent: notificationSent,
        studentConfirmationSent: studentConfirmationSent,
        notificationError: notificationError,
        studentConfirmationError: studentConfirmationError,
      });
    }

    if (action === 'deleteBooking') {
      const eventId = req.eventId || '';
      const bookingId = req.bookingId || '';
      const slot = Number(req.slot || 0);
      const timeZone = req.timeZone || config.defaultTimeZone;
      const teacherEmail = normalizeEmail_(req.teacherEmail || config.notificationEmail);
      const name = req.name || 'Student';
      const email = req.email || '';
      const phone = req.phone || '';
      const notes = req.notes || '';
      const canceledBy = req.canceledBy || 'Student';
      if (!eventId && !bookingId) {
        return jsonOut({ success: false, message: 'Missing Google Calendar event ID or booking ID.' });
      }
      const cal = CalendarApp.getCalendarById(config.primaryCalendarId);
      if (!cal) {
        return jsonOut({ success: false, message: 'Primary calendar not found.' });
      }
      var event = null;
      var alreadyDeleted = false;
      var ignoredError = '';
      try {
        event = findBookingEvent_(cal, eventId, bookingId, slot);
      } catch (eventLookupErr) {
        alreadyDeleted = true;
        ignoredError = eventLookupErr && eventLookupErr.message ? eventLookupErr.message : String(eventLookupErr);
      }
      if (!event) {
        alreadyDeleted = true;
      } else {
        try {
          event.deleteEvent();
        } catch (deleteErr) {
          alreadyDeleted = true;
          ignoredError = deleteErr && deleteErr.message ? deleteErr.message : String(deleteErr);
        }
      }
      var cancellationNotificationSent = false;
      var cancellationNotificationError = '';
      try {
        cancellationNotificationSent = sendBookingCancellationEmail_(teacherEmail, {
          name: name,
          email: email,
          phone: phone,
          notes: notes,
          bookingId: bookingId,
          timeZone: timeZone,
          slotLabel: slot ? Utilities.formatDate(new Date(slot), timeZone, 'yyyy-MM-dd HH:mm') : '',
          canceledBy: canceledBy
        });
        if (!cancellationNotificationSent) {
          cancellationNotificationError = teacherEmail ? 'Cancellation notification email was not accepted.' : 'Teacher email is missing.';
        }
      } catch (mailErr) {
        cancellationNotificationError = mailErr && mailErr.message ? mailErr.message : String(mailErr);
      }
      return jsonOut({
        success: true,
        message: alreadyDeleted ? 'Calendar event was already removed.' : 'Calendar event deleted.',
        alreadyDeleted: alreadyDeleted,
        ignoredError: ignoredError,
        cancellationNotificationSent: cancellationNotificationSent,
        cancellationNotificationError: cancellationNotificationError
      });
    }

    if (action === 'installReminderTrigger') {
      return jsonOut(installLessonReminderTrigger());
    }

    if (action === 'getReminderTriggerStatus') {
      return jsonOut(getLessonReminderTriggerStatus_());
    }

    if (action === 'sendReminderCheck') {
      return jsonOut(sendUpcomingLessonReminders());
    }

    if (action === 'reconcileBalances') {
      return jsonOut(reconcileStudentBalancesFromFirestore());
    }

    return jsonOut({ success: false, message: 'Unknown action.' });
  } catch (err) {
    return jsonOut({ success: false, message: err.message || String(err) });
  }
}
