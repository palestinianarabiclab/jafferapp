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
        const now = Date.now() - 3600000;
        let snap;
        try {
            snap = await db
                .collection("bookings")
                .where("slot", ">=", now)
                .orderBy("slot")
                .limit(200)
                .get();
        } catch (queryError) {
            const code = queryError?.code || "";
            const message = String(queryError?.message || "");
            const needsIndex = code === "failed-precondition" || message.toLowerCase().includes("index");
            if (!needsIndex) {
                throw queryError;
            }
            snap = await db
                .collection("bookings")
                .orderBy("slot")
                .limit(400)
                .get();
        }
        const items = [];
        snap.forEach((doc) => {
            const data = doc.data();
            if (!data || !data.slot) return;
            if (data.slot < now) return;
            if (String(data.status || "").toLowerCase() === "canceled") return;
            items.push({ id: doc.id, ...data });
        });
        if (!items.length) {
            teacherBookingList.innerHTML = "<div class=\"small-note\">No upcoming bookings.</div>";
            return bookingCache;
        }
        teacherBookingList.innerHTML = items
            .map((b) => {
                bookingCache.set(b.id, b);
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
                const rescheduledFrom = b.rescheduledFrom
                    ? `<div class="booking-item__meta">From: ${escapeHtml(formatSlotTime(b.rescheduledFrom))}</div>`
                    : "";
                return `
                    <div class="booking-item" data-booking-id="${b.id}">
                        <div class="booking-item__main">
                            <div class="booking-item__title">${escapeHtml(b.name || "Student")}</div>
                            <div class="booking-item__meta">${b.email || ""} ${b.phone ? " | " + b.phone : ""}</div>
                            <div class="booking-item__time">${escapeHtml(formatSlotTime(b.slot))}</div>
                            ${rescheduledFrom}
                            <div class="${statusClass}">${escapeHtml(statusLabel)}</div>
                        </div>
                        <div class="booking-item__actions">
                            <button class="btn btn--ghost btn--small" data-action="cancel" ${status === "canceled" ? "disabled" : ""}>Cancel</button>
                            <button class="btn btn--outline btn--small" data-action="reschedule" ${status === "canceled" ? "disabled" : ""}>Reschedule</button>
                        </div>
                        <div class="booking-item__resched"></div>
                    </div>
                `;
            })
            .join("");
        return bookingCache;
    } catch {
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
    resched.innerHTML = `
        <div class="form-grid">
            <label class="field">
                <span>Available Slot</span>
                <select class="booking-resched-select">
                    <option value="">Choose an available slot</option>
                    ${options.join("")}
                </select>
            </label>
            <label class="field">
                <span>Custom Date</span>
                <input class="booking-resched-date" type="date" />
            </label>
            <label class="field">
                <span>Custom Time</span>
                <input class="booking-resched-time" type="time" />
            </label>
        </div>
        ${options.length ? "" : "<div class=\"small-note\">No suggested available slots. Choose a custom date and time.</div>"}
        <button class="btn btn--primary btn--small" data-action="confirm-reschedule">Confirm</button>
        <button class="btn btn--ghost btn--small" data-action="close-reschedule">Close</button>
    `;
}

export async function cancelBooking({ db, firebase, bookingId }) {
    await db.collection("bookings").doc(bookingId).set(
        {
            status: "canceled",
            calendarSynced: false,
            canceledAt: Date.now(),
            canceledBy: "teacher",
            history: firebase.firestore.FieldValue.arrayUnion({
                at: Date.now(),
                action: "canceled",
                by: "teacher",
            }),
        },
        { merge: true }
    );
    await db.collection("publicBookings").doc(bookingId).set(
        {
            status: "canceled",
            updatedAt: Date.now(),
            calendarSynced: false,
        },
        { merge: true }
    );
}

export async function rescheduleBooking({
    db,
    firebase,
    bookingId,
    booking,
    newSlot,
    calendarSynced = false,
    googleCalendarEventId = null,
}) {
    await db.collection("bookings").doc(bookingId).set(
        {
            slot: newSlot,
            status: "rescheduled",
            rescheduledFrom: booking.slot,
            rescheduledAt: Date.now(),
            calendarSynced,
            googleCalendarEventId,
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
    await db.collection("publicBookings").doc(bookingId).set(
        {
            slot: newSlot,
            status: "rescheduled",
            updatedAt: Date.now(),
            calendarSynced,
        },
        { merge: true }
    );
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
