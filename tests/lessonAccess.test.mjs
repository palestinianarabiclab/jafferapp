import test from "node:test";
import assert from "node:assert/strict";

import {
    getLessonAccessState,
} from "../js/logic/lessonAccess.js";

const minute = 60 * 1000;
const lessonStart = Date.UTC(2026, 6, 24, 10, 0);

test("lesson access is closed before the 15-minute entry window", () => {
    const state = getLessonAccessState(lessonStart, lessonStart - 16 * minute);
    assert.equal(state.canEnter, false);
    assert.equal(state.reason, "too-early");
    assert.equal(state.msUntilOpen, minute);
});

test("lesson access opens exactly 15 minutes before start", () => {
    const state = getLessonAccessState(lessonStart, lessonStart - 15 * minute);
    assert.equal(state.canEnter, true);
    assert.equal(state.reason, "open");
});

test("lesson access remains open during the lesson", () => {
    const state = getLessonAccessState(lessonStart, lessonStart + 49 * minute);
    assert.equal(state.canEnter, true);
});

test("lesson access remains available during the re-entry grace period", () => {
    const state = getLessonAccessState(lessonStart, lessonStart + 50 * minute);
    assert.equal(state.canEnter, true);
});

test("lesson access closes after the 30-minute re-entry grace period", () => {
    const state = getLessonAccessState(lessonStart, lessonStart + 80 * minute);
    assert.equal(state.canEnter, false);
    assert.equal(state.reason, "ended");
});

test("lesson access rejects an invalid slot", () => {
    const state = getLessonAccessState(0, lessonStart);
    assert.equal(state.canEnter, false);
    assert.equal(state.reason, "invalid");
});
