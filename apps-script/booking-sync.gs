function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const preplyRaw = props.getProperty('PREPLY_CALENDAR_ID') || '';
  const additionalRaw = props.getProperty('ADDITIONAL_CALENDAR_IDS') || '';
  return {
    primaryCalendarId: props.getProperty('PRIMARY_CALENDAR_ID') || 'primary',
    preplyCalendarId: normalizeCalendarId_(preplyRaw),
    additionalCalendarIds: parseCalendarIds_(additionalRaw),
    defaultTimeZone: props.getProperty('DEFAULT_TIMEZONE') || Session.getScriptTimeZone() || 'Africa/Cairo',
    notificationEmail: props.getProperty('NOTIFICATION_EMAIL') || '',
  };
}

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

    return jsonOut({ success: false, message: 'Unknown action.' });
  } catch (err) {
    return jsonOut({ success: false, message: err.message || String(err) });
  }
}
