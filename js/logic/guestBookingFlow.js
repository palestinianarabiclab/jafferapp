export async function loadBookingStatusByEmail({
    db,
    email,
    bookingStatusList,
    bookingStatusMsg,
    hashEmail,
    escapeHtml,
    formatSlotTime,
}) {
    if (!bookingStatusList) return;
    bookingStatusList.innerHTML = "";
    if (!email) {
        if (bookingStatusMsg) bookingStatusMsg.textContent = "Please enter your email.";
        return;
    }
    try {
        const emailHash = await hashEmail(email);
        const snap = await db.collection("publicBookings").where("emailHash", "==", emailHash).get();
        const rows = [];
        snap.forEach((doc) => {
            const data = doc.data();
            if (!data || !data.slot) return;
            rows.push({ id: doc.id, ...data });
        });
        rows.sort((a, b) => (b.slot || 0) - (a.slot || 0));
        if (!rows.length) {
            bookingStatusList.innerHTML = "<div class=\"small-note\">No bookings found for this email.</div>";
            return;
        }
        bookingStatusList.innerHTML = rows
            .slice(0, 10)
            .map((b) => {
                const status = (b.status || "pending").toLowerCase();
                const label = status === "canceled" ? "Canceled" : status === "rescheduled" ? "Rescheduled" : status === "pending" ? "Pending" : "Booked";
                return `
                    <div class="booking-status-item">
                        <div><strong>${escapeHtml(formatSlotTime(b.slot))}</strong></div>
                        <div>Status: ${escapeHtml(label)}</div>
                    </div>
                `;
            })
            .join("");
    } catch {
        if (bookingStatusMsg) bookingStatusMsg.textContent = "Unable to load booking status right now.";
    }
}

export async function submitGuestBooking({
    db,
    bookingSettings,
    contactSettings,
    getLocalTimezone,
    selectedSlotMs,
    selectedDate,
    selectedTime,
    formValues,
    bookingSubmit,
    bookingSubmitLabel,
    bookingMsg,
    bookingSuccessModal,
    bookingSuccessText,
    bookingStatusEmail,
    findBookingConflict,
    refreshCalendarAvailability,
    buildBookingSelects,
    hashEmail,
    createBookingViaAppsScript,
    loadBookingStatus,
    isLocalDevHost,
}) {
    const {
        name,
        email,
        phone,
        notes,
        reasonLabels,
        reason,
        level,
        lessonsPerMonth,
        honeypot,
        studentTimeZone,
        studentLocale,
        countryHint,
        recaptchaReady,
        studentUid,
    } = formValues;

    if (!selectedDate || !selectedTime) {
        if (bookingMsg) bookingMsg.textContent = "Please select a date and time.";
        return;
    }

    if (honeypot) {
        if (bookingMsg) bookingMsg.textContent = "Please clear the hidden field.";
        return;
    }

    const lastTs = Number(localStorage.getItem("pal_arabic_last_booking_ts") || "0");
    if (lastTs && Date.now() - lastTs < 30000) {
        if (bookingMsg) bookingMsg.textContent = "Please wait 30 seconds before booking again.";
        return;
    }

    if (!studentUid) {
        if (bookingMsg) bookingMsg.textContent = "Please sign in before booking.";
        return;
    }

    if (!name || !email) {
        if (bookingMsg) bookingMsg.textContent = "Your account is missing a name or email.";
        return;
    }

    if (name.length < 2) {
        if (bookingMsg) bookingMsg.textContent = "Please enter your full name.";
        return;
    }

    if (!recaptchaReady) {
        if (bookingMsg) bookingMsg.textContent = "Please complete the reCAPTCHA.";
        return;
    }

    const selectedSlot = Number(selectedSlotMs || 0);
    const slotDate = selectedSlot ? new Date(selectedSlot) : null;
    if (!Number.isFinite(selectedSlot) || selectedSlot <= Date.now() + (30 * 60 * 1000)) {
        if (bookingMsg) bookingMsg.textContent = "Please choose a future time at least 30 minutes from now.";
        return;
    }

    try {
        if (bookingSubmit) {
            bookingSubmit.disabled = true;
            bookingSubmit.classList.add("is-loading");
        }
        if (bookingSubmitLabel) bookingSubmitLabel.textContent = "Booking...";
        if (bookingMsg) bookingMsg.textContent = "Booking your lesson...";

        const slot = slotDate.toLocaleString([], {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: bookingSettings.timezone || getLocalTimezone() || "Africa/Cairo",
        });
        const refreshed = await refreshCalendarAvailability?.();
        if (refreshed === false) {
            if (bookingMsg) bookingMsg.textContent = "Calendar sync is unavailable. Please try again in a moment.";
            await buildBookingSelects();
            return;
        }
        const conflict = await findBookingConflict(selectedSlot);
        if (conflict) {
            if (bookingMsg) bookingMsg.textContent = "That time was just taken. Please choose another slot.";
            await buildBookingSelects();
            return;
        }

        const tzLabel = bookingSettings.timezone || getLocalTimezone() || "Local time";
        const combinedNotes = [
            notes,
            reason ? `Reasons: ${reason}` : "",
            level ? `Level: ${level}` : "",
            lessonsPerMonth ? `Lessons per month: ${lessonsPerMonth}` : "",
            `Timezone: ${tzLabel}`,
            studentTimeZone ? `Student timezone: ${studentTimeZone}` : "",
            studentLocale ? `Student locale: ${studentLocale}` : "",
        ].filter(Boolean).join("\n");

        const bookingRef = db.collection("bookings").doc();
        let calendarSynced = false;
        let googleCalendarEventId = null;
        let teacherEmailSent = false;
        let studentEmailSent = false;
        let studentCalendarInviteSent = false;
        let appsScriptMessage = "";
        let appsScriptSucceeded = false;
        let teacherEmailError = "";
        let studentEmailError = "";
        let studentCalendarInviteError = "";
        const appsScriptSync = await createBookingViaAppsScript?.({
            bookingId: bookingRef.id,
            slot: selectedSlot,
            durationMinutes: bookingSettings.slotMinutes || 50,
            timeZone: bookingSettings.timezone || getLocalTimezone() || "Africa/Cairo",
            teacherEmail: (contactSettings?.email || "").trim(),
            name,
            email,
            phone,
            notes: combinedNotes,
            studentTimeZone,
            studentLocale,
        });
        if (appsScriptSync?.success) {
            appsScriptSucceeded = true;
            calendarSynced = true;
            googleCalendarEventId = appsScriptSync.eventId || null;
            teacherEmailSent = !!appsScriptSync.notificationSent;
            studentEmailSent = !!appsScriptSync.studentConfirmationSent;
            studentCalendarInviteSent = !!appsScriptSync.calendarInviteSent;
            teacherEmailError = appsScriptSync.notificationError || "";
            studentEmailError = appsScriptSync.studentConfirmationError || "";
            studentCalendarInviteError = appsScriptSync.calendarInviteError || "";
            appsScriptMessage = appsScriptSync.message || "";
        } else {
            appsScriptMessage = appsScriptSync?.message || "";
            throw new Error(appsScriptMessage || "Could not create the booking in Google Calendar. Please try again.");
        }

        await bookingRef.set({
            name,
            email,
            phone,
            notes: combinedNotes,
            source: "student",
            studentUid,
            reason,
            reasonLabels,
            level,
            lessonsPerMonth,
            studentTimeZone,
            studentLocale,
            countryHint,
            slot: selectedSlot,
            status: "booked",
            calendarSynced,
            googleCalendarEventId,
            timezone: bookingSettings.timezone || getLocalTimezone(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            history: [
                {
                    at: Date.now(),
                    action: "created",
                    by: "student",
                },
            ],
        });

        const emailHash = await hashEmail(email);
        await db.collection("publicBookings").doc(bookingRef.id).set({
            slot: selectedSlot,
            status: "booked",
            emailHash,
            studentUid,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            calendarSynced,
            source: "student",
        });

        if (bookingMsg) {
            if (teacherEmailSent && (studentEmailSent || studentCalendarInviteSent)) {
                bookingMsg.textContent = studentEmailSent
                    ? "Booked! Teacher and student emails were sent."
                    : "Booked! The teacher email was sent and the student got a calendar invite.";
            } else if (teacherEmailSent) {
                bookingMsg.textContent = "Booked! The teacher email was sent.";
            } else if (studentEmailSent || studentCalendarInviteSent) {
                bookingMsg.textContent = studentEmailSent
                    ? "Booked! A confirmation email was sent."
                    : "Booked! A calendar invite was sent to the student.";
            } else if (appsScriptMessage) {
                const details = [teacherEmailError, studentEmailError, studentCalendarInviteError, appsScriptMessage].filter(Boolean).join(" | ");
                bookingMsg.textContent = `Booked successfully, but email sending did not complete: ${details}`;
            } else {
                bookingMsg.textContent = "Booked successfully, but no email confirmation was sent.";
            }
        }
        if (bookingSuccessModal && bookingSuccessText) {
            const tz = bookingSettings.timezone || getLocalTimezone() || "Local time";
            const emailStatus = teacherEmailSent && (studentEmailSent || studentCalendarInviteSent)
                ? studentEmailSent
                    ? " Teacher and student emails were sent."
                    : " The teacher email was sent and the student got a calendar invite."
                : teacherEmailSent
                    ? " The teacher email was sent."
                    : (studentEmailSent || studentCalendarInviteSent)
                        ? " A confirmation email was sent to your inbox."
                        : appsScriptMessage
                            ? ` Email sending did not complete: ${[teacherEmailError, studentEmailError, studentCalendarInviteError, appsScriptMessage].filter(Boolean).join(" | ")}`
                            : " No email was sent.";
            bookingSuccessText.textContent = `Your lesson is confirmed for ${slot}. Timezone: ${tz}.${emailStatus}`;
            bookingSuccessModal.classList.add("modal--open");
        }
        localStorage.setItem("pal_arabic_last_booking_ts", String(Date.now()));
        localStorage.setItem("pal_arabic_last_booking_email", email);
        if (bookingStatusEmail) bookingStatusEmail.value = email;
        await loadBookingStatus(email);
        if (!isLocalDevHost() && window.grecaptcha && typeof window.grecaptcha.reset === "function") {
            window.grecaptcha.reset();
        }
        await buildBookingSelects();
    } catch (err) {
        console.error("Booking failed with error:", err);
        if (bookingMsg) bookingMsg.textContent = "Booking failed. Please try again.";
    } finally {
        if (bookingSubmit) bookingSubmit.classList.remove("is-loading");
        if (bookingSubmitLabel) bookingSubmitLabel.textContent = "Confirm Selected Time";
        if (bookingSubmit && window.selectedDate && window.selectedTime) bookingSubmit.disabled = false;
    }
}
