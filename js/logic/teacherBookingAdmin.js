export async function renderTeacherBookings({
    db,
    teacherBookingList,
    bookingCache,
    escapeHtml,
    formatSlotTime,
}) {
    if (!teacherBookingList) return bookingCache;
    teacherBookingList.innerHTML = "<div class=\"small-note\">Loading bookings...</div>";
    bookingCache.clear();
    try {
        const managementStart = Date.now() - 3600000;
        const calendarHistoryStart = Date.now() - 60 * 24 * 60 * 60 * 1000;
        let upcomingSnap;
        let historySnap;
        try {
            // Query upcoming lessons separately. A limited ascending history query
            // can fill with old lessons and omit a newly-created lesson everywhere
            // that consumes bookingCache (management, calendar and teacher banner).
            upcomingSnap = await db
                .collection("bookings")
                .where("slot", ">=", managementStart)
                .orderBy("slot")
                .limit(100)
                .get();
            historySnap = await db
                .collection("bookings")
                .where("slot", ">=", calendarHistoryStart)
                .where("slot", "<", managementStart)
                .orderBy("slot", "desc")
                .limit(50)
                .get();
        } catch (queryError) {
            const code = queryError?.code || "";
            const message = String(queryError?.message || "");
            const needsIndex = code === "failed-precondition" || message.toLowerCase().includes("index");
            if (!needsIndex) {
                throw queryError;
            }
            const fallbackSnap = await db
                .collection("bookings")
                .orderBy("slot", "desc")
                .limit(150)
                .get();
            upcomingSnap = fallbackSnap;
            historySnap = null;
        }
        const itemsById = new Map();
        const collectBooking = (doc) => {
            const data = doc.data();
            if (!data || !data.slot) return;
            if (data.slot < calendarHistoryStart) return;
            itemsById.set(doc.id, { id: doc.id, ...data });
        };
        upcomingSnap?.forEach(collectBooking);
        historySnap?.forEach(collectBooking);
        const items = Array.from(itemsById.values()).sort((a, b) => Number(a.slot) - Number(b.slot));
        items.forEach((booking) => {
            bookingCache.set(booking.id, booking);
        });
        const managementItems = items.filter((booking) => Number(booking.slot || 0) >= managementStart);
        if (!managementItems.length) {
            teacherBookingList.innerHTML = "<div class=\"small-note\">No upcoming bookings.</div>";
            return bookingCache;
        }
        teacherBookingList.innerHTML = managementItems
            .map((b) => {
                b = {
                    ...b,
                    name: escapeHtml(b.name || "Student"),
                    email: escapeHtml(b.email || ""),
                    phone: escapeHtml(b.phone || ""),
                };
                const status = b.status || "booked";
                const statusClass =
                    status === "canceled"
                        ? "booking-item__status booking-item__status--canceled"
                        : status === "rescheduled"
                            ? "booking-item__status booking-item__status--rescheduled"
                            : "booking-item__status";
                const statusLabel = status === "canceled"
                    ? "canceled"
                    : status === "rescheduled"
                        ? "rescheduled"
                        : "booked";
                const lessonTypeLabel = b.source === "teacher"
                    ? `<div class="booking-item__type booking-item__type--private">Private lesson</div>`
                    : "";
                const rescheduledFrom = b.rescheduledFrom
                    ? `<div class="booking-item__meta">From: ${escapeHtml(formatSlotTime(b.rescheduledFrom))}</div>`
                    : "";
                const cutoffMs = 12 * 60 * 60 * 1000;
                const isLateCancel = (status !== "canceled" && status !== "completed") && (Number(b.slot || 0) - Date.now() < cutoffMs);
                const deadlineMs = Number(b.slot || 0) - cutoffMs;
                const formattedDeadline = formatSlotTime(deadlineMs);
                const lateLabel = isLateCancel
                    ? `<div style="font-size: 0.72rem; color: #991b1b; background: #fef2f2; border: 1px solid #fee2e2; padding: 4px 8px; border-radius: 4px; margin-top: 6px; line-height: 1.3; font-weight: 500;">⚠️ Within 12h Late-Cancellation Window<br><span style="font-size: 0.68rem; opacity: 0.85;">Deadline passed on ${escapeHtml(formattedDeadline)}</span></div>`
                    : (status !== "canceled" && status !== "completed")
                        ? `<div style="font-size: 0.72rem; color: #166534; background: #f0fdf4; border: 1px solid #dcfce7; padding: 4px 8px; border-radius: 4px; margin-top: 6px; line-height: 1.3;">🕒 Reschedule Deadline: <strong>${escapeHtml(formattedDeadline)}</strong></div>`
                        : "";
                return `
                    <div class="booking-item" data-booking-id="${b.id}">
                        <div class="booking-item__main">
                            <div class="booking-item__title">${escapeHtml(b.name || "Student")}</div>
                            <div class="booking-item__meta">${b.email || ""} ${b.phone ? " | " + b.phone : ""}</div>
                            <div class="booking-item__time">${escapeHtml(formatSlotTime(b.slot))}</div>
                            ${rescheduledFrom}
                            <div class="${statusClass}">${escapeHtml(statusLabel)}</div>
                            ${lessonTypeLabel}
                            ${lateLabel}
                        </div>
                        <div class="booking-item__actions" style="display: flex; flex-wrap: wrap; gap: 6px;">
                            <button class="btn btn--primary btn--small" data-action="classroom" data-booking-id="${b.id}">🎓 Enter Classroom / Video Call</button>
                            <button class="btn btn--ghost btn--small" data-action="complete" data-booking-id="${b.id}" ${status === "completed" || status === "canceled" ? "disabled" : ""}>✅ Completed</button>
                            <button class="btn btn--ghost btn--small" data-action="cancel" ${status === "canceled" ? "disabled" : ""}>Cancel</button>
                            <button class="btn btn--outline btn--small" data-action="reschedule" ${status === "canceled" ? "disabled" : ""}>Reschedule</button>
                            ${status === "canceled" ? `<button class="btn btn--ghost btn--small" data-action="delete-canceled">Delete canceled booking</button>` : ""}
                        </div>
                        <div class="booking-item__resched"></div>
                    </div>
                `;
            })
            .join("");
        return bookingCache;
    } catch (error) {
        console.error("Could not load teacher bookings.", error);
        teacherBookingList.innerHTML = "<div class=\"small-note\">Unable to load bookings.</div>";
        return bookingCache;
    }
}

export async function openReschedulePanel({
    itemEl,
    booking,
    getAvailableSlots,
    escapeHtml,
}) {
    const resched = itemEl.querySelector(".booking-item__resched");
    if (!resched) return;
    if (resched.classList.contains("is-open")) {
        resched.classList.remove("is-open");
        resched.innerHTML = "";
        return;
    }
    resched.classList.add("is-open");
    resched.innerHTML = "<div class=\"small-note\">Loading slots...</div>";
    const slots = await getAvailableSlots(30, { excludeBookingId: booking.id });
    const options = slots.slice(0, 80).map((s) => {
        const ts = s.getTime();
        return `<option value="${ts}">${escapeHtml(s.toLocaleString())}</option>`;
    });
    if (!options.length) {
        resched.innerHTML = "<div class=\"small-note\">No available slots.</div>";
        return;
    }
    resched.innerHTML = `
        <select class="booking-resched-select">${options.join("")}</select>
        <button class="btn btn--primary btn--small" data-action="confirm-reschedule">Confirm</button>
        <button class="btn btn--ghost btn--small" data-action="close-reschedule">Close</button>
    `;
}

export async function cancelBooking({ db, firebase, bookingId }) {
    const bookingSnap = await db.collection("bookings").doc(bookingId).get();
    if (!bookingSnap.exists) throw new Error("Booking was not found.");
    const booking = bookingSnap.data() || {};
    const canceledAt = Date.now();
    const batch = db.batch();
    batch.set(
        db.collection("bookings").doc(bookingId),
        {
            status: "canceled",
            calendarSynced: false,
            calendarDeletePending: true,
            updatedAt: canceledAt,
            canceledAt,
            canceledBy: "teacher",
            history: firebase.firestore.FieldValue.arrayUnion({
                at: canceledAt,
                action: "canceled",
                by: "teacher",
            }),
        },
        { merge: true }
    );
    batch.set(
        db.collection("publicBookings").doc(bookingId),
        {
            status: "canceled",
            updatedAt: canceledAt,
            calendarSynced: false,
        },
        { merge: true }
    );
    if (booking.isFreeTrial === true && booking.studentUid) {
        batch.set(db.collection("users").doc(booking.studentUid), {
            trialUsed: false,
            trialUsedAt: firebase.firestore.FieldValue.delete(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.delete(db.collection("trialClaims").doc(booking.studentUid));
    }
    await batch.commit();
}

export async function deleteCanceledBooking({ db, bookingId }) {
    if (!bookingId) throw new Error("Booking ID is missing.");
    const privateRef = db.collection("bookings").doc(bookingId);
    const privateSnap = await privateRef.get();
    if (!privateSnap.exists) throw new Error("Booking was not found.");
    if (privateSnap.data()?.status !== "canceled") {
        throw new Error("Only canceled bookings can be deleted.");
    }
    const batch = db.batch();
    batch.delete(privateRef);
    batch.delete(db.collection("publicBookings").doc(bookingId));
    await batch.commit();
}

export async function rescheduleBooking({
    db,
    firebase,
    bookingId,
    booking,
    newSlot,
    calendarSynced = false,
    googleCalendarEventId = null,
    meetingUrl = "",
}) {
    const batch = db.batch();
    batch.set(
        db.collection("bookings").doc(bookingId),
        {
            slot: newSlot,
            status: "rescheduled",
            rescheduledFrom: booking.slot,
            rescheduledAt: Date.now(),
            calendarSynced,
            googleCalendarEventId,
            meetingUrl,
            studentNotice: "Your teacher changed the lesson time. Please review the updated schedule.",
            studentNoticeAt: Date.now(),
            history: firebase.firestore.FieldValue.arrayUnion({
                at: Date.now(),
                action: "rescheduled",
                by: "teacher",
                from: booking.slot,
                to: newSlot,
            }),
        },
        { merge: true }
    );
    batch.set(
        db.collection("publicBookings").doc(bookingId),
        {
            slot: newSlot,
            status: "rescheduled",
            updatedAt: Date.now(),
            calendarSynced,
        },
        { merge: true }
    );
    await batch.commit();
}

export async function resizeBookingDuration({
    db,
    firebase,
    bookingId,
    booking,
    durationMinutes,
}) {
    const updatedAt = Date.now();
    const batch = db.batch();
    batch.set(
        db.collection("bookings").doc(bookingId),
        {
            durationMinutes,
            updatedAt,
            studentNotice: `Your teacher changed the lesson duration to ${durationMinutes} minutes.`,
            studentNoticeAt: updatedAt,
            history: firebase.firestore.FieldValue.arrayUnion({
                at: updatedAt,
                action: "duration_changed",
                by: "teacher",
                from: Number(booking.durationMinutes || booking.slotMinutes || 50),
                to: durationMinutes,
            }),
        },
        { merge: true }
    );
    batch.set(
        db.collection("publicBookings").doc(bookingId),
        {
            durationMinutes,
            updatedAt,
        },
        { merge: true }
    );
    await batch.commit();
}

export async function clearAllBookings({ db }) {
    let bookingSnap;
    do {
        bookingSnap = await db.collection("bookings").limit(300).get();
        if (!bookingSnap.empty) {
            const batch = db.batch();
            for (const doc of bookingSnap.docs) {
                batch.delete(db.collection("bookings").doc(doc.id));
            }
            await batch.commit();
        }
    } while (!bookingSnap.empty);

    let publicSnap;
    do {
        publicSnap = await db.collection("publicBookings").limit(300).get();
        if (!publicSnap.empty) {
            const batch = db.batch();
            for (const doc of publicSnap.docs) {
                batch.delete(db.collection("publicBookings").doc(doc.id));
            }
            await batch.commit();
        }
    } while (!publicSnap.empty);
}
