export const LESSON_EARLY_ENTRY_MINUTES = 15;
export const DEFAULT_LESSON_MINUTES = 50;
export const LESSON_REENTRY_GRACE_MINUTES = 30;

export function getLessonAccessState(
    slotStart,
    now = Date.now(),
    {
        earlyEntryMinutes = LESSON_EARLY_ENTRY_MINUTES,
        lessonMinutes = DEFAULT_LESSON_MINUTES,
        reentryGraceMinutes = LESSON_REENTRY_GRACE_MINUTES,
    } = {}
) {
    const start = Number(slotStart || 0);
    const current = Number(now || 0);
    if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(current)) {
        return {
            canEnter: false,
            reason: "invalid",
            opensAt: 0,
            closesAt: 0,
            msUntilOpen: 0,
        };
    }
    const opensAt = start - earlyEntryMinutes * 60 * 1000;
    const closesAt = start + (lessonMinutes + reentryGraceMinutes) * 60 * 1000;
    const canEnter = current >= opensAt && current < closesAt;
    return {
        canEnter,
        reason: current < opensAt ? "too-early" : current >= closesAt ? "ended" : "open",
        opensAt,
        closesAt,
        msUntilOpen: Math.max(0, opensAt - current),
    };
}
