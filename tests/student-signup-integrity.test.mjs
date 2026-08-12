import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../js/booking-app.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("failed new signup removes the orphaned Firebase Auth user", () => {
    assert.match(app, /let newlyCreatedUser = null/);
    assert.match(app, /await newlyCreatedUser\.delete\(\)\.catch/);
});

test("an incomplete Auth account can recover its missing student profile", () => {
    assert.match(app, /auth\/email-already-in-use/);
    assert.match(app, /signInWithEmailAndPassword\(email, password\)/);
    assert.match(app, /if \(existingProfile\.exists\)/);
    assert.match(app, /createdBy: "student-signup"/);
});

test("mobile student signup uses a keyboard-safe bottom sheet", () => {
    assert.match(css, /#studentAuthModal \{[\s\S]*?align-items: flex-end/);
    assert.match(css, /max-height: 94dvh/);
    assert.match(css, /env\(safe-area-inset-bottom\)/);
    assert.match(css, /#studentAuthModal input,[\s\S]*?font-size: 16px/);
});

test("active students combines registered and uniquely taught students", () => {
    const start = app.indexOf("function updateTeacherOverviewStats");
    const end = app.indexOf("function parseProfileCounter", start);
    const overview = app.slice(start, end);
    assert.match(overview, /activeStudentsEl\.textContent = getActiveStudentCount\(\)\.toLocaleString\(\)/);
    assert.doesNotMatch(overview, /Math\.max\(registeredCount, baseStudents/);
    assert.match(app, /knownStudentKeys/);
    assert.match(app, /knownPlatformStudentKeys/);
    assert.match(app, /async function syncPublicStudentCounts/);
    assert.match(app, /currentRegistered === registeredCount && currentActive === activeCount/);
});

test("review header uses stored total while only six review bodies are loaded", () => {
    assert.match(app, /const storedTotal = Math\.max\(0, Number\(state\.profileSettings\?\.reviewsTotalCount/);
    assert.match(app, /state\.reviewsLoadedAll \? loadedCount : Math\.max\(loadedCount, storedTotal\)/);
    assert.match(app, /loadCloudReviews\(window\.db, undefined, \{ limit: 6 \}\)/);
    assert.match(app, /async function syncPublicReviewSummary/);
});
