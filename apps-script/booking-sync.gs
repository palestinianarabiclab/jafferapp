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
  const firebaseTeacherEmail = normalizeEmail_(getScriptProperty_(props, 'FIREBASE_TEACHER_EMAIL', 'jaffer.murtaja@gmail.com'));
  const notificationEmail = normalizeEmail_(
    getScriptProperty_(props, 'NOTIFICATION_EMAIL', '') ||
    getDefaultNotificationEmail_() ||
    firebaseTeacherEmail
  );
  return {
    firebaseApiKey: getScriptProperty_(props, 'FIREBASE_API_KEY', 'AIzaSyCfhVE4hdR5P7YW6JOAnSC5az7s-J8zEsc'),
    firebaseProjectId: getScriptProperty_(props, 'FIREBASE_PROJECT_ID', 'jafferapp'),
    firebaseTeacherEmail: firebaseTeacherEmail,
    primaryCalendarId: getScriptProperty_(props, 'PRIMARY_CALENDAR_ID', 'primary'),
    preplyCalendarId: normalizeCalendarId_(preplyRaw),
    additionalCalendarIds: parseCalendarIds_(additionalRaw),
    defaultTimeZone: getScriptProperty_(props, 'DEFAULT_TIMEZONE', '') || Session.getScriptTimeZone() || 'Africa/Cairo',
    notificationEmail: notificationEmail,
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
    details.meetingUrl ? 'Google Meet: ' + details.meetingUrl : '',
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
    details.meetingUrl ? 'Join lesson: ' + details.meetingUrl : '',
    '',
    'If you need to change the booking, please reply to this email or contact us on WhatsApp.',
    '',
    'Thank you.'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function sendStudentScheduleUpdateEmail_(recipient, details) {
  const subject = 'Your lesson schedule was updated';
  const body = [
    'Hello ' + (details.name || 'Student') + ',',
    '',
    'Your teacher updated your lesson schedule.',
    '',
    'New date & time: ' + (details.slotLabel || ''),
    'Duration: ' + (details.durationMinutes || 50) + ' minutes',
    'Teacher timezone: ' + (details.timeZone || ''),
    details.meetingUrl ? 'Join lesson: ' + details.meetingUrl : '',
    '',
    'The updated lesson is also visible in your student account.',
    '',
    'Thank you.'
  ].join('\n');
  return sendPlainEmail_(recipient, subject, body);
}

function sendReviewRequestEmail_(recipient, details) {
  const subject = 'Jaffer would appreciate your lesson review';
  const body = [
    'Hello ' + (details.name || 'Student') + ',',
    '',
    'Jaffer has invited you to share feedback about your Arabic lessons.',
    '',
    'Please open the student website, sign in, and complete the teacher review form:',
    details.siteUrl || '',
    '',
    'Your honest feedback helps future students understand the learning experience.',
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
  return String(details.bookingId || event.getId());
}

function getReminderHistory_(props) {
  try {
    const parsed = JSON.parse(props.getProperty('LESSON_REMINDER_HISTORY') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveReminderHistory_(props, history) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = Object.keys(history || {})
    .map(function (key) { return [key, Number(history[key] || 0)]; })
    .filter(function (entry) { return entry[1] >= cutoff; })
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 250);
  const compact = {};
  recent.forEach(function (entry) { compact[entry[0]] = entry[1]; });
  props.setProperty('LESSON_REMINDER_HISTORY', JSON.stringify(compact));
}

function cleanupLegacyScriptProperties() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removedReminderKeys = 0;
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('lesson_reminder_15_') === 0) {
      props.deleteProperty(key);
      removedReminderKeys += 1;
    }
  });
  // Firebase ID tokens are used for authentication. A teacher password must
  // never be stored in Apps Script properties.
  props.deleteProperty('FIREBASE_TEACHER_PASSWORD');
  saveReminderHistory_(props, getReminderHistory_(props));
  return {
    success: true,
    removedReminderKeys: removedReminderKeys,
    message: 'Legacy reminder properties and the obsolete stored teacher password were removed.'
  };
}

function sendUpcomingLessonReminders() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'sendUpcomingLessonReminders') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  return {
    success: true,
    message: 'Legacy email reminder trigger removed. Google Calendar sends the built-in 15-minute reminder.',
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    checkedCount: 0,
  };
}

function installLessonReminderTrigger() {
  return {
    success: true,
    manualSetupRequired: false,
    message: 'No reminder trigger is required. Google Calendar sends the built-in 15-minute reminder.',
  };
}

function reconcileStudentBalancesFromFirestore() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'reconcileStudentBalancesFromFirestore') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  return {
    success: true,
    skipped: true,
    message: 'Legacy balance reconciliation trigger removed. Balances are managed by authenticated booking transactions.'
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

function verifyFirebaseCaller_(config, authToken) {
  const token = String(authToken || '').trim();
  if (!token) {
    throw new Error('Authentication required.');
  }
  const response = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + encodeURIComponent(config.firebaseApiKey),
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ idToken: token }),
    }
  );
  const data = JSON.parse(response.getContentText() || '{}');
  const account = data.users && data.users[0];
  if (response.getResponseCode() >= 300 || !account || !account.localId) {
    throw new Error('Invalid or expired authentication.');
  }
  return {
    token: token,
    uid: String(account.localId),
    email: normalizeEmail_(account.email || ''),
  };
}

function getCallerRole_(config, caller) {
  try {
    const userDoc = firestoreFetch_(config, caller.token, '/users/' + encodeURIComponent(caller.uid), { method: 'get' });
    return fsString_(userDoc, 'role') || 'student';
  } catch (err) {
    return 'student';
  }
}

function getCallerRoleCheck_(config, caller) {
  try {
    const userDoc = firestoreFetch_(config, caller.token, '/users/' + encodeURIComponent(caller.uid), { method: 'get' });
    return { role: fsString_(userDoc, 'role') || 'student', error: '' };
  } catch (err) {
    return { role: 'student', error: err && err.message ? err.message : String(err) };
  }
}

function requireTeacherCaller_(config, authToken) {
  const caller = verifyFirebaseCaller_(config, authToken);
  const roleCheck = getCallerRoleCheck_(config, caller);
  const hasTeacherRole = roleCheck.role === 'teacher';
  const matchesConfiguredTeacher = !!config.firebaseTeacherEmail &&
    caller.email === config.firebaseTeacherEmail;
  if (!hasTeacherRole && !matchesConfiguredTeacher) {
    throw new Error(
      'Teacher access required. Signed in as "' + caller.email +
      '", configured teacher is "' + (config.firebaseTeacherEmail || 'not configured') +
      '", Firestore role is "' + roleCheck.role + '"' +
      (roleCheck.error ? ', role lookup failed: ' + roleCheck.error : '') + '.'
    );
  }
  return caller;
}

function requireBookingCaller_(config, authToken, bookingId, slot) {
  if (!bookingId) {
    throw new Error('Missing booking ID.');
  }
  const caller = verifyFirebaseCaller_(config, authToken);
  const bookingDoc = firestoreFetch_(
    config,
    caller.token,
    '/bookings/' + encodeURIComponent(bookingId),
    { method: 'get' }
  );
  const bookingSlot = fsNumber_(bookingDoc, 'slot');
  if (slot && bookingSlot && Number(slot) !== bookingSlot) {
    throw new Error('Booking slot does not match.');
  }
  const callerRole = getCallerRole_(config, caller);
  const studentUid = fsString_(bookingDoc, 'studentUid');
  if (callerRole !== 'teacher' && studentUid !== caller.uid) {
    throw new Error('Booking access denied.');
  }
  return { caller: caller, role: callerRole, booking: bookingDoc };
}

function enforceCallerRateLimit_(caller, action, maxRequests, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = ['rate', action, caller.uid].join(':');
  const current = Number(cache.get(key) || 0);
  if (current >= maxRequests) {
    throw new Error('Too many requests. Please wait and try again.');
  }
  cache.put(key, String(current + 1), windowSeconds);
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

function hashCalendarStudent_(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    normalized,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (item) {
    const valueByte = item < 0 ? item + 256 : item;
    return ('0' + valueByte.toString(16)).slice(-2);
  }).join('');
}

function extractPreplyStudentKey_(title) {
  let value = String(title || '').trim();
  if (!value) return '';
  if (/^(busy|time off|available|availability|google calendar|holiday|vacation)$/i.test(value)) {
    return '';
  }
  value = value
    .replace(/^(trial\s+)?lesson\s+with\s+/i, '')
    .replace(/^(trial\s+)?lesson\s*[-:]\s*/i, '')
    .replace(/^preply\s*[-:]\s*/i, '')
    .replace(/\s+\|\s+.*$/, '')
    .replace(/\s+\([^)]*\)\s*$/, '')
    .trim();
  if (!value || /^(lesson|trial lesson|busy)$/i.test(value)) return '';
  return hashCalendarStudent_(value);
}

function getPreplyStatistics_(config, days) {
  if (!config.preplyCalendarId) {
    return {
      success: false,
      message: 'PREPLY_CALENDAR_ID is not configured in Apps Script properties.',
    };
  }
  const calendar = CalendarApp.getCalendarById(config.preplyCalendarId);
  if (!calendar) {
    return {
      success: false,
      message: 'The configured Preply calendar could not be opened.',
    };
  }
  const safeDays = Math.max(30, Math.min(1825, Number(days || 730)));
  const end = new Date();
  const start = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const completedEvents = calendar.getEvents(start, end)
    .filter(function (event) {
      return event.getEndTime().getTime() <= now &&
        !event.isAllDayEvent() &&
        extractPreplyStudentKey_(event.getTitle());
    })
    .map(function (event) {
      return {
        eventId: String(event.getId() || event.getEventSeriesId() || ''),
        studentKey: extractPreplyStudentKey_(event.getTitle()),
        start: event.getStartTime().getTime(),
        end: event.getEndTime().getTime(),
      };
    })
    .filter(function (event) {
      return event.eventId && event.studentKey;
    });
  const uniqueEvents = {};
  completedEvents.forEach(function (event) {
    uniqueEvents[event.eventId] = event;
  });
  const events = Object.keys(uniqueEvents)
    .map(function (eventId) { return uniqueEvents[eventId]; })
    .sort(function (a, b) { return a.start - b.start; })
    .slice(-5000);
  const studentKeys = events.map(function (event) {
    return event.studentKey;
  }).filter(function (studentKey, index, list) {
    return list.indexOf(studentKey) === index;
  });
  return {
    success: true,
    message: 'Preply statistics loaded.',
    eventIds: events.map(function (event) { return event.eventId; }),
    studentKeys: studentKeys,
    completedLessons: events.length,
    uniqueStudents: studentKeys.length,
    rangeDays: safeDays,
    syncedAt: Date.now(),
  };
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

function hasConflictingEventExcept_(calendarIds, start, end, excludedEventId) {
  for (var i = 0; i < calendarIds.length; i += 1) {
    const events = listEvents_(calendarIds[i], start, end);
    for (var j = 0; j < events.length; j += 1) {
      const event = events[j];
      if (excludedEventId && event.id === excludedEventId) continue;
      if (start.getTime() < Number(event.end || 0) && end.getTime() > Number(event.start || 0)) {
        return true;
      }
    }
  }
  return false;
}

function isSameCalendarEventId_(left, right) {
  if (!left || !right) return false;
  return left === right || String(left).split('@')[0] === String(right).split('@')[0];
}

function hasConflictingStudentLesson_(calendar, start, end, excludedEventId) {
  const events = calendar.getEvents(start, end);
  for (var i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (isSameCalendarEventId_(event.getId(), excludedEventId)) continue;
    if ((event.getDescription() || '').indexOf('Booking ID:') === -1) continue;
    if (start.getTime() < event.getEndTime().getTime() && end.getTime() > event.getStartTime().getTime()) {
      return true;
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

function ensureBookingMeetingLink_(config, bookingId, slot) {
  if (!bookingId || !slot) return { eventId: '', meetingUrl: '' };
  const center = new Date(Number(slot));
  const options = {
    timeMin: new Date(center.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(center.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    q: 'Booking ID: ' + bookingId,
    singleEvents: true,
    maxResults: 20,
  };
  const response = Calendar.Events.list(config.primaryCalendarId, options);
  const items = (response && response.items) || [];
  const needle = 'Booking ID: ' + bookingId;
  const apiEvent = items.filter(function (item) {
    return String(item.description || '').indexOf(needle) !== -1;
  })[0];
  if (!apiEvent) return { eventId: '', meetingUrl: '' };
  if (apiEvent.hangoutLink) {
    return { eventId: apiEvent.id || apiEvent.iCalUID || '', meetingUrl: apiEvent.hangoutLink };
  }
  const patched = Calendar.Events.patch({
    conferenceData: {
      createRequest: {
        requestId: 'jaffer-recover-' + bookingId + '-' + Date.now(),
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    }
  }, config.primaryCalendarId, apiEvent.id, {
    conferenceDataVersion: 1,
    sendUpdates: 'all'
  });
  const meetingUrl = patched.hangoutLink ||
    ((((patched.conferenceData || {}).entryPoints || []).filter(function (entry) {
      return entry.entryPointType === 'video';
    })[0] || {}).uri || '');
  return { eventId: patched.id || patched.iCalUID || apiEvent.id || '', meetingUrl: meetingUrl };
}

function buildBusyBlocks_(events, timeZone, includeTitles) {
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
        note: includeTitles ? (event.title || 'Busy') : 'Busy',
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
        firebaseProjectId: config.firebaseProjectId,
      });
    }

    if (action === 'getEmailQuota') {
      requireTeacherCaller_(config, req.authToken);
      return jsonOut(getEmailQuotaPayload_());
    }

    if (action === 'getBusy') {
      const days = Math.max(1, Math.min(90, Number(req.days || 30)));
      const timeZone = req.timeZone || config.defaultTimeZone;
      const calendarIds = getBusyCalendarIds_(config);
      const cache = CacheService.getScriptCache();
      const cacheKey = getBusyCacheKey_(calendarIds, days, timeZone);
      const cached = String(req.fresh || '').toLowerCase() === 'true' ? null : cache.get(cacheKey);
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
      // Keep cancellations responsive; the client refreshes availability every minute.
      cache.put(cacheKey, JSON.stringify(payload), 30);
      return jsonOut(payload);
    }

    if (action === 'getTeacherBusy') {
      requireTeacherCaller_(config, req.authToken);
      const days = Math.max(1, Math.min(90, Number(req.days || 30)));
      const timeZone = req.timeZone || config.defaultTimeZone;
      const calendarIds = getBusyCalendarIds_(config);
      const start = new Date();
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
      let events = [];
      calendarIds.forEach(function (calendarId) {
        events = events.concat(listEvents_(calendarId, start, end));
      });
      return jsonOut({
        success: true,
        message: 'Teacher calendar details loaded.',
        busyBlocks: buildBusyBlocks_(events, timeZone, true),
      });
    }

    if (action === 'getPreplyStatistics') {
      const caller = requireTeacherCaller_(config, req.authToken);
      enforceCallerRateLimit_(caller, 'getPreplyStatistics', 30, 3600);
      return jsonOut(getPreplyStatistics_(config, req.days));
    }

    if (action === 'createBusyBlock') {
      const caller = requireTeacherCaller_(config, req.authToken);
      enforceCallerRateLimit_(caller, 'createBusyBlock', 120, 3600);
      const slot = Number(req.slot || 0);
      const durationMinutes = Math.max(15, Math.min(720, Number(req.durationMinutes || 60)));
      const title = String(req.title || 'Busy').slice(0, 120);
      if (!slot || slot <= Date.now()) {
        return jsonOut({ success: false, message: 'Choose a future busy time.' });
      }
      const cal = CalendarApp.getCalendarById(config.primaryCalendarId);
      if (!cal) {
        return jsonOut({ success: false, message: 'Primary calendar not found.' });
      }
      const start = new Date(slot);
      const end = new Date(slot + durationMinutes * 60 * 1000);
      if (hasConflictingEvent_(getBusyCalendarIds_(config), start, end)) {
        return jsonOut({ success: false, message: 'That time is already occupied.' });
      }
      const event = cal.createEvent(title, start, end, {
        description: 'Teacher busy block created from the lesson dashboard.'
      });
      return jsonOut({
        success: true,
        message: 'Busy time added to Google Calendar.',
        eventId: event.getId(),
      });
    }

    if (action === 'sendReviewRequest') {
      const caller = requireTeacherCaller_(config, req.authToken);
      enforceCallerRateLimit_(caller, 'sendReviewRequest', 60, 3600);
      const studentId = String(req.studentId || '');
      if (!studentId) {
        return jsonOut({ success: false, message: 'Choose a student first.' });
      }
      const studentDoc = firestoreFetch_(
        config,
        caller.token,
        '/users/' + encodeURIComponent(studentId),
        { method: 'get' }
      );
      const email = fsString_(studentDoc, 'email');
      const name = fsString_(studentDoc, 'name') || 'Student';
      const requestedUrl = String(req.siteUrl || '');
      const siteUrl = /^https?:\/\//i.test(requestedUrl) ? requestedUrl.slice(0, 500) : '';
      if (!isValidEmail_(email)) {
        return jsonOut({ success: false, message: 'The student does not have a valid email.' });
      }
      const sent = sendReviewRequestEmail_(email, {
        name: name,
        siteUrl: siteUrl,
      });
      return jsonOut({
        success: sent,
        message: sent ? 'Review request email sent.' : 'Review request email was not sent.',
      });
    }

    if (action === 'createBooking') {
      const slot = Number(req.slot || 0);
      const durationMinutes = Math.max(15, Math.min(240, Number(req.durationMinutes || 50)));
      let timeZone = req.timeZone || config.defaultTimeZone;
      let name = req.name || 'Student';
      let email = req.email || '';
      let phone = req.phone || '';
      let notes = req.notes || '';
      const bookingId = req.bookingId || '';
      const teacherEmail = normalizeEmail_(config.notificationEmail);
      if (!slot) {
        return jsonOut({ success: false, message: 'Missing slot timestamp.' });
      }
      const bookingAccess = requireBookingCaller_(config, req.authToken, bookingId, slot);
      enforceCallerRateLimit_(
        bookingAccess.caller,
        'createBooking',
        bookingAccess.role === 'teacher' ? 60 : 6,
        3600
      );
      name = fsString_(bookingAccess.booking, 'name') || name;
      email = fsString_(bookingAccess.booking, 'email') || email;
      phone = fsString_(bookingAccess.booking, 'phone') || phone;
      notes = fsString_(bookingAccess.booking, 'notes') || notes;
      timeZone = fsString_(bookingAccess.booking, 'timezone') || timeZone;
      const start = new Date(slot);
      const end = new Date(slot + durationMinutes * 60 * 1000);
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
      var calendarInviteSent = isValidEmail_(email);
      var calendarInviteError = calendarInviteSent ? '' : 'Student email is invalid for calendar invite.';
      const eventResource = {
        summary: 'Lesson with ' + name,
        description: description,
        start: {
          dateTime: start.toISOString(),
          timeZone: timeZone
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: timeZone
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 15 },
            { method: 'email', minutes: 15 }
          ]
        },
        conferenceData: {
          createRequest: {
            requestId: 'jaffer-' + (bookingId || Utilities.getUuid()) + '-' + start.getTime(),
            conferenceSolutionKey: { type: 'hangoutsMeet' }
          }
        }
      };
      if (calendarInviteSent) {
        eventResource.attendees = [{ email: normalizeEmail_(email) }];
      }
      const bookingLock = LockService.getScriptLock();
      bookingLock.waitLock(20000);
      let event;
      try {
        const existingEvent = findBookingEvent_(cal, '', bookingId, slot);
        if (existingEvent) {
          let existingMeetingUrl = '';
          try {
            existingMeetingUrl = existingEvent.getHangoutLink() || '';
          } catch (hangoutErr) {}
          let recoveredMeeting = { eventId: existingEvent.getId(), meetingUrl: existingMeetingUrl };
          if (!existingMeetingUrl) {
            recoveredMeeting = ensureBookingMeetingLink_(config, bookingId, slot);
          }
          return jsonOut({
            success: true,
            message: recoveredMeeting.meetingUrl
              ? 'Booking exists in Google Calendar and its Meet link is ready.'
              : 'Booking exists in Google Calendar, but a Meet link could not be created.',
            eventId: recoveredMeeting.eventId || existingEvent.getId(),
            meetingUrl: recoveredMeeting.meetingUrl || '',
            calendarInviteSent: false,
            notificationSent: false,
            studentConfirmationSent: false,
          });
        }
        const hasConflict = bookingAccess.role === 'teacher'
          ? hasConflictingStudentLesson_(cal, start, end, '')
          : hasConflictingEvent_(getBusyCalendarIds_(config), start, end);
        if (hasConflict) {
          return jsonOut({
            success: false,
            message: 'That slot is no longer available. Please choose another time.'
          });
        }
        event = Calendar.Events.insert(
          eventResource,
          config.primaryCalendarId,
          {
            conferenceDataVersion: 1,
            sendUpdates: calendarInviteSent ? 'all' : 'none'
          }
        );
      } finally {
        bookingLock.releaseLock();
      }
      const meetingUrl = event.hangoutLink ||
        (((event.conferenceData || {}).entryPoints || []).filter(function (entry) {
          return entry.entryPointType === 'video';
        })[0] || {}).uri || '';
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
          slotLabel: slotLabel,
          meetingUrl: meetingUrl
        });
        if (!notificationSent) {
          notificationError = teacherEmail ? 'Teacher notification email was not accepted.' : 'Teacher email is missing.';
        }
      } catch (mailErr) {
        notificationError = mailErr && mailErr.message ? mailErr.message : String(mailErr);
      }
      if (!calendarInviteSent) {
        try {
          studentConfirmationSent = sendStudentConfirmationEmail_(email, {
            name: name,
            bookingId: bookingId,
            timeZone: timeZone,
            slotLabel: slotLabel,
            meetingUrl: meetingUrl
          });
          if (!studentConfirmationSent) {
            studentConfirmationError = email ? 'Student confirmation email was not accepted.' : 'Student email is missing.';
          }
        } catch (mailErr) {
          studentConfirmationError = mailErr && mailErr.message ? mailErr.message : String(mailErr);
        }
      }
      return jsonOut({
        success: true,
        message: 'Booking added to Google Calendar.',
        eventId: event.iCalUID || event.id,
        meetingUrl: meetingUrl,
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
      const teacherEmail = normalizeEmail_(config.notificationEmail);
      let name = req.name || 'Student';
      let email = req.email || '';
      let phone = req.phone || '';
      let notes = req.notes || '';
      const canceledBy = req.canceledBy || 'Student';
      if (!eventId && !bookingId) {
        return jsonOut({ success: false, message: 'Missing Google Calendar event ID or booking ID.' });
      }
      const bookingAccess = requireBookingCaller_(config, req.authToken, bookingId, slot);
      name = fsString_(bookingAccess.booking, 'name') || name;
      email = fsString_(bookingAccess.booking, 'email') || email;
      phone = fsString_(bookingAccess.booking, 'phone') || phone;
      notes = fsString_(bookingAccess.booking, 'notes') || notes;
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

    if (action === 'rescheduleBooking') {
      const bookingId = req.bookingId || '';
      const eventId = req.eventId || '';
      const oldSlot = Number(req.oldSlot || 0);
      const newSlot = Number(req.newSlot || 0);
      const requestedDurationMinutes = Number(req.durationMinutes || 0);
      if (!bookingId || !oldSlot || !newSlot || newSlot <= Date.now()) {
        return jsonOut({ success: false, message: 'Invalid reschedule request.' });
      }
      const bookingAccess = requireBookingCaller_(config, req.authToken, bookingId, 0);
      enforceCallerRateLimit_(
        bookingAccess.caller,
        'rescheduleBooking',
        bookingAccess.role === 'teacher' ? 120 : 12,
        3600
      );
      const cal = CalendarApp.getCalendarById(config.primaryCalendarId);
      if (!cal) {
        return jsonOut({ success: false, message: 'Primary calendar not found.' });
      }
      const event = findBookingEvent_(cal, eventId, bookingId, oldSlot);
      if (!event) {
        return jsonOut({ success: false, message: 'Calendar event was not found.' });
      }
      const durationMs = requestedDurationMinutes
        ? Math.max(15, Math.min(240, requestedDurationMinutes)) * 60 * 1000
        : Math.max(
            15 * 60 * 1000,
            event.getEndTime().getTime() - event.getStartTime().getTime()
          );
      const newStart = new Date(newSlot);
      const newEnd = new Date(newSlot + durationMs);
      const eventLock = LockService.getScriptLock();
      eventLock.waitLock(20000);
      try {
        const hasConflict = bookingAccess.role === 'teacher'
          ? hasConflictingStudentLesson_(cal, newStart, newEnd, event.getId())
          : hasConflictingEventExcept_(
            getBusyCalendarIds_(config),
            newStart,
            newEnd,
            event.getId()
          );
        if (hasConflict) {
          return jsonOut({
            success: false,
            message: 'That slot is no longer available. Please choose another time.'
          });
        }
        event.setTime(newStart, newEnd);
      } finally {
        eventLock.releaseLock();
      }
      let meetingUrl = '';
      try {
        meetingUrl = event.getHangoutLink() || '';
      } catch (hangoutErr) {}
      let studentNotificationSent = false;
      try {
        studentNotificationSent = sendStudentScheduleUpdateEmail_(
          fsString_(bookingAccess.booking, 'email'),
          {
            name: fsString_(bookingAccess.booking, 'name'),
            slotLabel: Utilities.formatDate(newStart, config.defaultTimeZone, 'yyyy-MM-dd HH:mm'),
            durationMinutes: Math.round(durationMs / 60000),
            timeZone: config.defaultTimeZone,
            meetingUrl: meetingUrl,
          }
        );
      } catch (notificationErr) {}
      return jsonOut({
        success: true,
        message: 'Google Calendar event rescheduled.',
        eventId: event.getId(),
        meetingUrl: meetingUrl,
        studentNotificationSent: studentNotificationSent,
      });
    }

    if (action === 'installReminderTrigger') {
      requireTeacherCaller_(config, req.authToken);
      return jsonOut(installLessonReminderTrigger());
    }

    if (action === 'getReminderTriggerStatus') {
      requireTeacherCaller_(config, req.authToken);
      return jsonOut(getLessonReminderTriggerStatus_());
    }

    if (action === 'sendReminderCheck') {
      requireTeacherCaller_(config, req.authToken);
      return jsonOut(sendUpcomingLessonReminders());
    }

    return jsonOut({ success: false, message: 'Unknown action.' });
  } catch (err) {
    return jsonOut({ success: false, message: err.message || String(err) });
  }
}
