const DEFAULT_ECCD_QUARTER_COUNT = 3;

export function ordinal(number) {
    const value = Math.max(1, Number(number) || 1);
    const mod10 = value % 10;
    const mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return `${value}st`;
    if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
    return `${value}th`;
}

export function normalizeSchoolYearContext(context, fallbackCount = DEFAULT_ECCD_QUARTER_COUNT) {
    const source = context && typeof context === 'object' ? context : {};
    let quarters = Array.isArray(source.quarters) ? source.quarters : [];

    quarters = quarters
        .filter(Boolean)
        .map((quarter, index) => ({
            number: index + 1,
            label: String(quarter.label || `${ordinal(index + 1)} Quarter`),
            start_date: quarter.start_date || null,
            end_date: quarter.end_date || null
        }));

    if (!quarters.length) {
        const count = Math.max(1, Number(source.quarter_count) || Number(fallbackCount) || DEFAULT_ECCD_QUARTER_COUNT);
        quarters = Array.from({ length: count }, (_, index) => ({
            number: index + 1,
            label: `${ordinal(index + 1)} Quarter`,
            start_date: null,
            end_date: null
        }));
    }

    return {
        school_year_id: Number(source.school_year_id) || null,
        school_year: String(source.school_year || ''),
        start_date: source.start_date || null,
        end_date: source.end_date || null,
        sy_status: source.sy_status || null,
        quarter_count: quarters.length,
        quarters
    };
}

export function getQuarterPeriods(context, fallbackCount = DEFAULT_ECCD_QUARTER_COUNT) {
    return normalizeSchoolYearContext(context, fallbackCount).quarters;
}

export function getQuarterNumbers(context, fallbackCount = DEFAULT_ECCD_QUARTER_COUNT) {
    return getQuarterPeriods(context, fallbackCount).map(quarter => quarter.number);
}

export function getQuarterLabel(context, quarterNumber, short = false, fallbackCount = DEFAULT_ECCD_QUARTER_COUNT) {
    const period = getQuarterPeriods(context, fallbackCount).find(quarter => quarter.number === Number(quarterNumber));
    if (!period) return `${ordinal(quarterNumber)}${short ? ' Qtr.' : ' Quarter'}`;
    if (!short) return period.label;
    return period.label.replace(/\bQuarter\b/i, 'Qtr.');
}

export function getFinalSummaryQuarter(context, fallbackCount = DEFAULT_ECCD_QUARTER_COUNT) {
    return getQuarterPeriods(context, fallbackCount).length + 1;
}

