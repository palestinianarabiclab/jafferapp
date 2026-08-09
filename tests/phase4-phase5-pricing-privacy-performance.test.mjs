import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildPriceSnapshot, getPackageLessonChargeCents, preservePriceSnapshot, priceDifference, stripStudentFinancialFields } from "../js/logic/pricingSafety.js";

const app = fs.readFileSync(new URL("../js/booking-app.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../apps-script/booking-sync.gs", import.meta.url), "utf8");

test("1 default and custom effective pricing", () => { assert.equal(buildPriceSnapshot({ defaultPrice: 20 }).effectivePrice, 20); assert.equal(buildPriceSnapshot({ defaultPrice: 20, customPrice: 15 }).effectivePrice, 15); });
test("2 historical price remains unchanged", () => { const old = buildPriceSnapshot({ defaultPrice: 20, customPrice: 15, capturedAt: 1 }); assert.deepEqual(preservePriceSnapshot(old, buildPriceSnapshot({ defaultPrice: 30 })), old); });
test("3 reschedule keeps booking accounting identity", () => assert.match(app, /bookingAccountingRef = window\.db\.collection\("bookingAccounting"\)\.doc\(doc\.id\)/));
test("4 consumption ledger preserves snapshot", () => { assert.match(app, /defaultPriceAtBooking: priceSnapshot\.defaultPriceAtBooking/); assert.match(app, /pricingSource: packageEntitlement \? "package" : \(priceSnapshot\.pricingSource/); });
test("5 student finance is separated by rules", () => { assert.match(rules, /match \/studentAccounting/); assert.match(rules, /allow read, create, update, delete: if isTeacher/); });
test("6 teacher View Lessons renders historical accounting", () => assert.match(app, /Lesson deducted:.*Price:.*Pricing:/s));
test("7 legacy price is not invented", () => assert.equal(buildPriceSnapshot({ defaultPrice: 0, customPrice: 0 }), null));
test("8 teacher refresh is single-flight", () => assert.match(app, /teacherCalendarRefreshInFlight/));
test("9 hidden tabs skip calendar work", () => assert.match(app, /if \(document\.hidden/));
test("10 Calendar worker remains installed", () => assert.match(worker, /runCalendarSyncWorker/));
test("11 notification worker remains integrated", () => assert.match(worker, /processPendingNotificationJobs_\(config\)/));
test("12 overlapping claims remain present", () => assert.match(app, /getBookingIntervalClaimIds/));
test("13 consumption ledger remains deterministic", () => assert.match(app, /doc\(`consume_\$\{doc\.id\}`\)/));
test("14 Calendar mirrors remain deduplicated", () => assert.match(app, /dedupeCalendarMirrors/));
test("15 canceled bookings do not consume", () => assert.match(app, /initialStatus === "canceled"/));
test("16 student financial fields are stripped", () => assert.deepEqual(stripStudentFinancialFields({ name: "A", balance: 10, lessonPrice: 5, totalPaid: 20, transactions: [] }), { name: "A" }));
test("custom discount and upward adjustment are distinguishable", () => { assert.equal(priceDifference(buildPriceSnapshot({ defaultPrice: 20, customPrice: 15 })), 5); assert.equal(priceDifference(buildPriceSnapshot({ defaultPrice: 20, customPrice: 25 })), -5); });
test("invalid custom price falls back to default", () => assert.equal(buildPriceSnapshot({ defaultPrice: 20, customPrice: -1 }).pricingSource, "default"));
test("teacher can set the student's exact lesson-credit count", () => {
    assert.match(app, /data-student-lesson-credits/);
    assert.match(app, /Lesson credits cannot be lower than/);
});
test("a refund restores whole lessons using the student's effective lesson price", () => {
    assert.match(app, /Math\.floor\(\(amount \+ 0\.0001\) \/ effectiveLessonPrice\)/);
    assert.match(app, /lessonCreditAdjustment:\s*isPayment \? 0 : restoredLessons/);
    assert.match(app, /lessonCreditsAfter/);
});
test("Regular Rate Display remains public and is not replaced by a fixed private-pricing message", () => {
    assert.doesNotMatch(app, /Private lesson pricing is managed by the teacher/);
    assert.match(app, /lessonRateDisplay\.textContent = rateText/);
    assert.match(app, /els\.preplyRateDisplay\.textContent = rateText/);
    assert.doesNotMatch(app, /rateText:\s*window\.firebase\.firestore\.FieldValue\.delete/);
});
test("student credit card does not expose the private-accounting explanation", () => {
    assert.doesNotMatch(app, /Prices and accounting are managed privately by the teacher/);
});
test("package lesson charges consume the exact package amount without a negative remainder", () => {
    const charges = Array.from({ length: 12 }, (_, index) => getPackageLessonChargeCents(23000, 12, index));
    assert.deepEqual(charges, [1917, 1917, 1917, 1917, 1917, 1917, 1917, 1917, 1916, 1916, 1916, 1916]);
    assert.equal(charges.reduce((sum, value) => sum + value, 0), 23000);
});
test("package approval is idempotent and consumption uses package entitlement", () => {
    assert.match(app, /lessonPackageEntitlements/);
    assert.match(app, /if \(entitlementSnap\.exists\)/);
    assert.match(app, /pricingSource: "package"/);
    assert.match(rules, /match \/lessonPackageEntitlements\/\{packageId\}/);
});
test("teacher busy calendar starts at today midnight so elapsed times remain visible today", () => {
    assert.match(worker, /action === 'getTeacherBusy'[\s\S]*?start\.setHours\(0, 0, 0, 0\)/);
});
