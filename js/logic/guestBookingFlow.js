import {
    isSlotBeyondMinimumLead,
} from "./bookingAvailability.js";

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
    bookingSuccessWhatsAppBtn,
    bookingSuccessTrialIntro,
    bookingStatusEmail,
    findBookingConflict,
    refreshCalendarAvailability,
    buildBookingSelects,
    createBookingViaAppsScript,
    buildWhatsAppUrl,
    getStudentBillingForBooking,
    commitBookingWithBilling,
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
        isFreeTrial,
        lessonPrice,
    } = formValues;
    const normalizedPhone = String(phone || "").trim().startsWith("+")
        ? `+${String(phone || "").replace(/\D/g, "")}`
        : String(phone || "").replace(/\D/g, "");

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
    if (!isSlotBeyondMinimumLead(selectedSlot)) {
        if (bookingMsg) bookingMsg.textContent = "Please choose a time at least 6 hours from now.";
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

        const studentBilling = await getStudentBillingForBooking?.(studentUid);

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
        let meetingUrl = "";
        let teacherEmailSent = false;
        let studentEmailSent = false;
        let studentCalendarInviteSent = false;
        let appsScriptMessage = "";
        let appsScriptSucceeded = false;
        let teacherEmailError = "";
        let studentEmailError = "";
        let studentCalendarInviteError = "";

        const bookingData = {
            name,
            email,
            phone: normalizedPhone,
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
            durationMinutes: bookingSettings.slotMinutes || 50,
            status: "booked",
            calendarSynced,
            googleCalendarEventId,
            meetingUrl,
            timezone: bookingSettings.timezone || getLocalTimezone(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isFreeTrial: isFreeTrial === true,
            lessonPrice: isFreeTrial === true ? 0 : (Number(lessonPrice) || 15),
            history: [
                {
                    at: Date.now(),
                    action: "created",
                    by: "student",
                },
            ],
        };

        const publicBookingData = {
            slot: selectedSlot,
            durationMinutes: bookingSettings.slotMinutes || 50,
            status: "booked",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            calendarSynced,
            source: "student",
        };

        if (commitBookingWithBilling) {
            await commitBookingWithBilling({
                bookingRef,
                bookingData,
                publicBookingData,
                billing: studentBilling,
            });
        } else {
            const batch = db.batch();
            batch.set(bookingRef, bookingData);
            batch.set(db.collection("publicBookings").doc(bookingRef.id), publicBookingData);
            if (isFreeTrial === true && studentUid) {
                batch.set(db.collection("trialClaims").doc(studentUid), {
                    studentUid,
                    bookingId: bookingRef.id,
                    createdAt: Date.now(),
                });
            }
            await batch.commit();
        }

        const appsScriptSync = await createBookingViaAppsScript?.({
            bookingId: bookingRef.id,
            slot: selectedSlot,
            durationMinutes: bookingSettings.slotMinutes || 50,
            timeZone: bookingSettings.timezone || getLocalTimezone() || "Africa/Cairo",
            teacherEmail: (contactSettings?.email || "").trim(),
            name,
            email,
            phone: normalizedPhone,
            notes: combinedNotes,
            studentTimeZone,
            studentLocale,
        });
        if (appsScriptSync?.success) {
            appsScriptSucceeded = true;
            calendarSynced = true;
            googleCalendarEventId = appsScriptSync.eventId || null;
            meetingUrl = appsScriptSync.meetingUrl || "";
            teacherEmailSent = !!appsScriptSync.notificationSent;
            studentEmailSent = !!appsScriptSync.studentConfirmationSent;
            studentCalendarInviteSent = !!appsScriptSync.calendarInviteSent;
            teacherEmailError = appsScriptSync.notificationError || "";
            studentEmailError = appsScriptSync.studentConfirmationError || "";
            studentCalendarInviteError = appsScriptSync.calendarInviteError || "";
            appsScriptMessage = appsScriptSync.message || "";
            const syncBatch = db.batch();
            syncBatch.set(bookingRef, {
                calendarSynced: true,
                googleCalendarEventId,
                meetingUrl,
                updatedAt: Date.now(),
                history: window.firebase.firestore.FieldValue.arrayUnion({
                    at: Date.now(),
                    action: "calendar-synced",
                    by: "system",
                }),
            }, { merge: true });
            syncBatch.set(db.collection("publicBookings").doc(bookingRef.id), {
                calendarSynced: true,
                updatedAt: Date.now(),
            }, { merge: true });
            if (isFreeTrial === true && studentUid) {
                syncBatch.set(db.collection("users").doc(studentUid), {
                    trialUsed: true,
                    trialUsedAt: Date.now(),
                }, { merge: true });
            }
            try {
                await syncBatch.commit();
            } catch (syncError) {
                console.warn(
                    "Booking and calendar event were created, but Firestore sync metadata could not be updated.",
                    syncError
                );
                if (isFreeTrial === true && studentUid) {
                    try {
                        await db.collection("users").doc(studentUid).set({
                            trialUsed: true,
                            trialUsedAt: Date.now(),
                            updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                        }, { merge: true });
                    } catch (trialUpdateError) {
                        console.warn("Could not record free-trial usage after calendar sync.", trialUpdateError);
                    }
                }
                appsScriptMessage = [
                    appsScriptMessage,
                    "The booking is saved and the calendar invite was sent; sync status will retry later.",
                ].filter(Boolean).join(" ");
            }
        } else {
            appsScriptMessage = appsScriptSync?.message || "";
            const slotWasTaken = /no longer available|already (taken|booked)|conflict/i.test(appsScriptMessage);
            if (slotWasTaken) {
                const canceledAt = Date.now();
                const cancelBatch = db.batch();
                cancelBatch.set(bookingRef, {
                    status: "canceled",
                    canceledAt,
                    canceledBy: "student",
                    updatedAt: canceledAt,
                    history: window.firebase.firestore.FieldValue.arrayUnion({
                        at: canceledAt,
                        action: "calendar-conflict",
                        by: "system",
                    }),
                }, { merge: true });
                cancelBatch.set(db.collection("publicBookings").doc(bookingRef.id), {
                    status: "canceled",
                    updatedAt: canceledAt,
                }, { merge: true });
                await cancelBatch.commit();
                if (bookingMsg) {
                    bookingMsg.textContent = "That time was just taken. Please choose another lesson time.";
                }
                await buildBookingSelects();
                return;
            }
            console.warn(
                "Google Calendar sync failed; booking is saved for a later retry.",
                appsScriptMessage || "Unknown Apps Script error."
            );
        }

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
            } else if (!calendarSynced) {
                bookingMsg.textContent = `Booked successfully. Calendar sync is pending${appsScriptMessage ? `: ${appsScriptMessage}` : " and will be retried"}.`;
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
                    : !calendarSynced
                        ? ` Calendar sync is pending${appsScriptMessage ? `: ${appsScriptMessage}` : " and will be retried"}.`
                        : appsScriptMessage
                            ? ` Email sending did not complete: ${[teacherEmailError, studentEmailError, studentCalendarInviteError, appsScriptMessage].filter(Boolean).join(" | ")}`
                            : " No email was sent.";
            bookingSuccessText.textContent = `Your lesson is confirmed for ${slot}. Timezone: ${tz}.${emailStatus}`;
            const showTrialWhatsApp = isFreeTrial === true && typeof buildWhatsAppUrl === "function";
            const introMessage = [
                "Hello Jaffer,",
                "",
                `I booked my free trial lesson for ${slot} (${tz}).`,
                `My name is ${name}. I wanted to introduce myself before our lesson.`,
                "",
                "My current Arabic level is: ",
                "My main learning goal is: ",
                "",
                "I am excited to start learning Palestinian Arabic with you!"
            ].join("\n");
            const whatsappUrl = showTrialWhatsApp
                ? buildWhatsAppUrl(contactSettings, introMessage)
                : null;
            if (bookingSuccessWhatsAppBtn) {
                bookingSuccessWhatsAppBtn.hidden = !whatsappUrl;
                bookingSuccessWhatsAppBtn.style.display = whatsappUrl ? "" : "none";
                if (whatsappUrl) {
                    bookingSuccessWhatsAppBtn.href = whatsappUrl;
                } else {
                    bookingSuccessWhatsAppBtn.removeAttribute("href");
                }
            }
            if (bookingSuccessTrialIntro) {
                bookingSuccessTrialIntro.hidden = !whatsappUrl;
            }
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
        const permissionDenied = ["permission-denied", "firestore/permission-denied"]
            .includes(err?.code);
        if (bookingMsg) {
            bookingMsg.textContent = permissionDenied
                ? "Firestore rejected the booking. No new booking was confirmed; please contact the teacher."
                : "Booking failed. Please try again.";
        }
    } finally {
        if (bookingSubmit) bookingSubmit.classList.remove("is-loading");
        if (bookingSubmitLabel) bookingSubmitLabel.textContent = "Confirm Selected Time";
        if (bookingSubmit && window.selectedDate && window.selectedTime) bookingSubmit.disabled = false;
    }
}
