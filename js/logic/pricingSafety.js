export const PRICING_CURRENCY = "USD";

export function validLessonPrice(value) {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 && price <= 10000 ? Math.round(price * 100) / 100 : null;
}

export function buildPriceSnapshot({ defaultPrice, customPrice, currency = PRICING_CURRENCY, capturedAt = Date.now() } = {}) {
    const safeDefault = validLessonPrice(defaultPrice);
    const safeCustom = validLessonPrice(customPrice);
    const effectivePrice = safeCustom ?? safeDefault;
    if (effectivePrice === null) return null;
    return {
        effectivePrice,
        currency,
        pricingSource: safeCustom !== null ? "custom" : "default",
        defaultPriceAtBooking: safeDefault,
        customPriceAtBooking: safeCustom,
        capturedAt: Number(capturedAt),
    };
}

export function priceDifference(snapshot = {}) {
    const base = validLessonPrice(snapshot.defaultPriceAtBooking);
    const effective = validLessonPrice(snapshot.effectivePrice);
    if (base === null || effective === null) return null;
    return Math.round((base - effective) * 100) / 100;
}

export function preservePriceSnapshot(existing, replacement) {
    return existing?.effectivePrice != null ? { ...existing } : replacement;
}

export function stripStudentFinancialFields(profile = {}) {
    const financial = new Set(["balance", "lessonPrice", "totalPaid", "transactions", "financeUpdatedAt"]);
    return Object.fromEntries(Object.entries(profile).filter(([key]) => !financial.has(key)));
}
