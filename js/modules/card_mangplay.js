const PLAY_SCHOOL_TRANSMUTATION_COLUMNS = [
    { key: 'scaled_score', label: 'Scaled Score' },
    { key: 'gross_motor', label: 'Gross Motor raw score' },
    { key: 'fine_motor', label: 'Fine Motor raw score' },
    { key: 'self_help', label: 'Self-Help raw score' },
    { key: 'receptive_language', label: 'Receptive Language raw score' },
    { key: 'expressive_language', label: 'Expressive Language raw score' },
    { key: 'cognitive', label: 'Cognitive raw score' },
    { key: 'social_emotional', label: 'Social Emotional raw score' }
];
const PLAY_SCHOOL_TRANSMUTATION_META_KEYS = new Set([
    'play_transmutation_id',
    'transmutation_id',
    'temp_id',
    'age_key',
    'age_label',
    'age_order',
    'scaled_score',
    'order_index',
    'rows',
    'extra_ranges'
]);

export const PLAY_SCHOOL_DOMAIN_KEYS = [
    'gross_motor',
    'fine_motor',
    'self_help',
    'receptive_language',
    'expressive_language',
    'cognitive',
    'social_emotional'
];

export const PLAY_SCHOOL_DEFAULT_DOMAINS = PLAY_SCHOOL_TRANSMUTATION_COLUMNS
    .filter(column => column.key !== 'scaled_score')
    .map((column, index) => ({
        domain_key: column.key,
        domain_label: column.label.replace(/\s*raw score$/i, ''),
        order_index: index + 1,
        is_active: 1
    }));

export const PLAY_SCHOOL_AGE_GROUPS = [
    { age_key: '3_1_to_4_0', age_label: 'Ages 3.1 - 4.0 years', min_months: 37, max_months: 48 },
    { age_key: '4_1_to_5_0', age_label: 'Ages 4.1 - 5.0 years', min_months: 49, max_months: 60 },
    { age_key: '5_1_to_5_11', age_label: 'Ages 5.1 - 5.11 years', min_months: 61, max_months: 71 }
];

export const PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS = [
    {
        min: 1,
        max: 3,
        code: 'monitor_3_months',
        label: 'Development in the domain must be monitored after 3 months',
        level: 'below_expected',
        follow_up_months: 3
    },
    {
        min: 4,
        max: 6,
        code: 'monitor_6_months',
        label: 'Development in the domain must be monitored after 6 months',
        level: 'below_expected',
        follow_up_months: 6
    },
    {
        min: 7,
        max: 13,
        code: 'average',
        label: 'Average development',
        level: 'average',
        follow_up_months: null
    },
    {
        min: 14,
        max: 16,
        code: 'slightly_advanced',
        label: 'Suggests slightly advanced development in the domain',
        level: 'advanced',
        follow_up_months: null
    },
    {
        min: 17,
        max: 19,
        code: 'highly_advanced',
        label: 'Suggests highly advanced development in the domain',
        level: 'advanced',
        follow_up_months: null
    }
];

export const PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS = [
    {
        min: Number.NEGATIVE_INFINITY,
        max: 69,
        code: 'monitor_3_months',
        label: 'Overall development must be monitored after 3 months',
        level: 'below_expected',
        follow_up_months: 3
    },
    {
        min: 70,
        max: 79,
        code: 'monitor_6_months',
        label: 'Overall development must be monitored after 6 months',
        level: 'below_expected',
        follow_up_months: 6
    },
    {
        min: 80,
        max: 119,
        code: 'average',
        label: 'Average overall development',
        level: 'average',
        follow_up_months: null
    },
    {
        min: 120,
        max: 129,
        code: 'slightly_advanced',
        label: 'Slightly advanced overall development',
        level: 'advanced',
        follow_up_months: null
    },
    {
        min: 130,
        max: Number.POSITIVE_INFINITY,
        code: 'highly_advanced',
        label: 'Highly advanced overall development',
        level: 'advanced',
        follow_up_months: null
    }
];

export function normalizePlaySchoolInterpretations(data, defaults) {
    const source = Array.isArray(data) ? data : defaults;
    return source.map((rule, index) => ({
        interpretation_id: rule.interpretation_id || '',
        temp_id: rule.temp_id || '',
        min: rule.min === null || rule.min === '' || rule.min === undefined ? Number.NEGATIVE_INFINITY : Number(rule.min),
        max: rule.max === null || rule.max === '' || rule.max === undefined ? Number.POSITIVE_INFINITY : Number(rule.max),
        code: rule.code || defaults[index]?.code || `range_${index + 1}`,
        label: String(rule.label || ''),
        level: rule.level || defaults[index]?.level || 'average',
        follow_up_months: rule.follow_up_months === null || rule.follow_up_months === '' || rule.follow_up_months === undefined
            ? null
            : Number(rule.follow_up_months),
        order_index: Number(rule.order_index) || index + 1
    })).sort((a, b) => a.order_index - b.order_index);
}

export const PLAY_SCHOOL_TRANSMUTATION_TABLES = [
    {
        age_key: '3_1_to_4_0',
        age_label: 'Ages 3.1 - 4.0 years',
        rows: [
            { scaled_score: 1, gross_motor: '0-3', fine_motor: '-', self_help: '0-9', receptive_language: '-', expressive_language: '0-2', cognitive: '-', social_emotional: '0-9' },
            { scaled_score: 2, gross_motor: '4', fine_motor: '0-3', self_help: '10', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '10-11' },
            { scaled_score: 3, gross_motor: '5', fine_motor: '-', self_help: '11', receptive_language: '0-1', expressive_language: '3', cognitive: '0', social_emotional: '12' },
            { scaled_score: 4, gross_motor: '-', fine_motor: '4', self_help: '12', receptive_language: '-', expressive_language: '4', cognitive: '1', social_emotional: '13' },
            { scaled_score: 5, gross_motor: '6', fine_motor: '5', self_help: '13-14', receptive_language: '2', expressive_language: '-', cognitive: '2-3', social_emotional: '14' },
            { scaled_score: 6, gross_motor: '7', fine_motor: '-', self_help: '15', receptive_language: '-', expressive_language: '5', cognitive: '4', social_emotional: '15' },
            { scaled_score: 7, gross_motor: '8', fine_motor: '6', self_help: '16', receptive_language: '3', expressive_language: '-', cognitive: '5', social_emotional: '16' },
            { scaled_score: 8, gross_motor: '9', fine_motor: '-', self_help: '17', receptive_language: '-', expressive_language: '6', cognitive: '6', social_emotional: '17-18' },
            { scaled_score: 9, gross_motor: '-', fine_motor: '7', self_help: '18-19', receptive_language: '-', expressive_language: '-', cognitive: '7', social_emotional: '19' },
            { scaled_score: 10, gross_motor: '10', fine_motor: '8', self_help: '20', receptive_language: '4', expressive_language: '7', cognitive: '8-9', social_emotional: '20' },
            { scaled_score: 11, gross_motor: '11', fine_motor: '-', self_help: '21', receptive_language: '-', expressive_language: '-', cognitive: '10', social_emotional: '21' },
            { scaled_score: 12, gross_motor: '12', fine_motor: '9', self_help: '22', receptive_language: '5', expressive_language: '8', cognitive: '11', social_emotional: '22' },
            { scaled_score: 13, gross_motor: '-', fine_motor: '-', self_help: '23-24', receptive_language: '-', expressive_language: '-', cognitive: '12', social_emotional: '23' },
            { scaled_score: 14, gross_motor: '13', fine_motor: '10', self_help: '25', receptive_language: '-', expressive_language: '-', cognitive: '13-14', social_emotional: '24' },
            { scaled_score: 15, gross_motor: '-', fine_motor: '11', self_help: '26', receptive_language: '-', expressive_language: '-', cognitive: '15', social_emotional: '-' },
            { scaled_score: 16, gross_motor: '-', fine_motor: '-', self_help: '27', receptive_language: '-', expressive_language: '-', cognitive: '16', social_emotional: '-' },
            { scaled_score: 17, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '17', social_emotional: '-' },
            { scaled_score: 18, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '18', social_emotional: '-' },
            { scaled_score: 19, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '19-21', social_emotional: '-' }
        ]
    },
    {
        age_key: '4_1_to_5_0',
        age_label: 'Ages 4.1 - 5.0 years',
        rows: [
            { scaled_score: 1, gross_motor: '0-5', fine_motor: '0-3', self_help: '0-15', receptive_language: '0-1', expressive_language: '-', cognitive: '0', social_emotional: '0-13' },
            { scaled_score: 2, gross_motor: '6', fine_motor: '4', self_help: '16', receptive_language: '-', expressive_language: '0-5', cognitive: '1', social_emotional: '14' },
            { scaled_score: 3, gross_motor: '-', fine_motor: '-', self_help: '17', receptive_language: '2', expressive_language: '-', cognitive: '2-3', social_emotional: '15' },
            { scaled_score: 4, gross_motor: '7', fine_motor: '5', self_help: '18', receptive_language: '-', expressive_language: '-', cognitive: '4', social_emotional: '16' },
            { scaled_score: 5, gross_motor: '8', fine_motor: '6', self_help: '19', receptive_language: '-', expressive_language: '6', cognitive: '5', social_emotional: '17' },
            { scaled_score: 6, gross_motor: '-', fine_motor: '-', self_help: '20', receptive_language: '3', expressive_language: '-', cognitive: '6-7', social_emotional: '-' },
            { scaled_score: 7, gross_motor: '9', fine_motor: '7', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '8', social_emotional: '18' },
            { scaled_score: 8, gross_motor: '10', fine_motor: '-', self_help: '21', receptive_language: '-', expressive_language: '7', cognitive: '9-10', social_emotional: '19' },
            { scaled_score: 9, gross_motor: '-', fine_motor: '8', self_help: '22', receptive_language: '4', expressive_language: '-', cognitive: '11', social_emotional: '20' },
            { scaled_score: 10, gross_motor: '11', fine_motor: '9', self_help: '23', receptive_language: '-', expressive_language: '8', cognitive: '12', social_emotional: '21' },
            { scaled_score: 11, gross_motor: '12', fine_motor: '-', self_help: '24', receptive_language: '5', expressive_language: '-', cognitive: '13-14', social_emotional: '22' },
            { scaled_score: 12, gross_motor: '-', fine_motor: '10', self_help: '25', receptive_language: '-', expressive_language: '-', cognitive: '15', social_emotional: '23' },
            { scaled_score: 13, gross_motor: '13', fine_motor: '-', self_help: '26', receptive_language: '-', expressive_language: '-', cognitive: '16-17', social_emotional: '24' },
            { scaled_score: 14, gross_motor: '-', fine_motor: '11', self_help: '27', receptive_language: '-', expressive_language: '-', cognitive: '18', social_emotional: '-' },
            { scaled_score: 15, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '19-20', social_emotional: '-' },
            { scaled_score: 16, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '21', social_emotional: '-' },
            { scaled_score: 17, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 18, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 19, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' }
        ]
    },
    {
        age_key: '5_1_to_5_11',
        age_label: 'Ages 5.1 - 5.11 years',
        rows: [
            { scaled_score: 1, gross_motor: '0-10', fine_motor: '0-5', self_help: '-', receptive_language: '0-2', expressive_language: '-', cognitive: '0-9', social_emotional: '0-15' },
            { scaled_score: 2, gross_motor: '-', fine_motor: '-', self_help: '0-19', receptive_language: '-', expressive_language: '-', cognitive: '10', social_emotional: '16' },
            { scaled_score: 3, gross_motor: '-', fine_motor: '6', self_help: '20', receptive_language: '-', expressive_language: '-', cognitive: '11', social_emotional: '17' },
            { scaled_score: 4, gross_motor: '11', fine_motor: '-', self_help: '21', receptive_language: '3', expressive_language: '-', cognitive: '12', social_emotional: '-' },
            { scaled_score: 5, gross_motor: '-', fine_motor: '7', self_help: '-', receptive_language: '-', expressive_language: '0-7', cognitive: '13', social_emotional: '18' },
            { scaled_score: 6, gross_motor: '-', fine_motor: '-', self_help: '22', receptive_language: '-', expressive_language: '-', cognitive: '14', social_emotional: '19' },
            { scaled_score: 7, gross_motor: '12', fine_motor: '8', self_help: '23', receptive_language: '-', expressive_language: '-', cognitive: '15', social_emotional: '20' },
            { scaled_score: 8, gross_motor: '-', fine_motor: '9', self_help: '-', receptive_language: '4', expressive_language: '-', cognitive: '16', social_emotional: '-' },
            { scaled_score: 9, gross_motor: '-', fine_motor: '-', self_help: '24', receptive_language: '-', expressive_language: '-', cognitive: '17', social_emotional: '21' },
            { scaled_score: 10, gross_motor: '-', fine_motor: '10', self_help: '25', receptive_language: '-', expressive_language: '-', cognitive: '18', social_emotional: '22' },
            { scaled_score: 11, gross_motor: '13', fine_motor: '-', self_help: '-', receptive_language: '5', expressive_language: '8', cognitive: '19', social_emotional: '23' },
            { scaled_score: 12, gross_motor: '-', fine_motor: '11', self_help: '26', receptive_language: '-', expressive_language: '-', cognitive: '20', social_emotional: '-' },
            { scaled_score: 13, gross_motor: '-', fine_motor: '-', self_help: '27', receptive_language: '-', expressive_language: '-', cognitive: '21', social_emotional: '24' },
            { scaled_score: 14, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 15, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 16, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 17, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 18, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' },
            { scaled_score: 19, gross_motor: '-', fine_motor: '-', self_help: '-', receptive_language: '-', expressive_language: '-', cognitive: '-', social_emotional: '-' }
        ]
    }
];

export const PLAY_SCHOOL_STANDARD_SCORE_ROWS = [
    { sum_scaled_score: 29, standard_score: 37 },
    { sum_scaled_score: 30, standard_score: 38 },
    { sum_scaled_score: 31, standard_score: 40 },
    { sum_scaled_score: 32, standard_score: 41 },
    { sum_scaled_score: 33, standard_score: 43 },
    { sum_scaled_score: 34, standard_score: 44 },
    { sum_scaled_score: 35, standard_score: 45 },
    { sum_scaled_score: 36, standard_score: 47 },
    { sum_scaled_score: 37, standard_score: 48 },
    { sum_scaled_score: 38, standard_score: 50 },
    { sum_scaled_score: 39, standard_score: 51 },
    { sum_scaled_score: 40, standard_score: 53 },
    { sum_scaled_score: 41, standard_score: 54 },
    { sum_scaled_score: 42, standard_score: 56 },
    { sum_scaled_score: 43, standard_score: 57 },
    { sum_scaled_score: 44, standard_score: 59 },
    { sum_scaled_score: 45, standard_score: 60 },
    { sum_scaled_score: 46, standard_score: 62 },
    { sum_scaled_score: 47, standard_score: 63 },
    { sum_scaled_score: 48, standard_score: 65 },
    { sum_scaled_score: 49, standard_score: 66 },
    { sum_scaled_score: 50, standard_score: 67 },
    { sum_scaled_score: 51, standard_score: 69 },
    { sum_scaled_score: 52, standard_score: 70 },
    { sum_scaled_score: 53, standard_score: 72 },
    { sum_scaled_score: 54, standard_score: 73 },
    { sum_scaled_score: 55, standard_score: 75 },
    { sum_scaled_score: 56, standard_score: 76 },
    { sum_scaled_score: 57, standard_score: 78 },
    { sum_scaled_score: 58, standard_score: 79 },
    { sum_scaled_score: 59, standard_score: 81 },
    { sum_scaled_score: 60, standard_score: 82 },
    { sum_scaled_score: 61, standard_score: 84 },
    { sum_scaled_score: 62, standard_score: 85 },
    { sum_scaled_score: 63, standard_score: 86 },
    { sum_scaled_score: 64, standard_score: 88 },
    { sum_scaled_score: 65, standard_score: 89 },
    { sum_scaled_score: 66, standard_score: 91 },
    { sum_scaled_score: 67, standard_score: 92 },
    { sum_scaled_score: 68, standard_score: 94 },
    { sum_scaled_score: 69, standard_score: 95 },
    { sum_scaled_score: 70, standard_score: 97 },
    { sum_scaled_score: 71, standard_score: 98 },
    { sum_scaled_score: 72, standard_score: 100 },
    { sum_scaled_score: 73, standard_score: 101 },
    { sum_scaled_score: 74, standard_score: 103 },
    { sum_scaled_score: 75, standard_score: 104 },
    { sum_scaled_score: 76, standard_score: 105 },
    { sum_scaled_score: 77, standard_score: 107 },
    { sum_scaled_score: 78, standard_score: 108 },
    { sum_scaled_score: 79, standard_score: 110 },
    { sum_scaled_score: 80, standard_score: 111 },
    { sum_scaled_score: 81, standard_score: 113 },
    { sum_scaled_score: 82, standard_score: 114 },
    { sum_scaled_score: 83, standard_score: 116 },
    { sum_scaled_score: 84, standard_score: 117 },
    { sum_scaled_score: 85, standard_score: 119 },
    { sum_scaled_score: 86, standard_score: 120 },
    { sum_scaled_score: 87, standard_score: 122 },
    { sum_scaled_score: 88, standard_score: 123 },
    { sum_scaled_score: 89, standard_score: 124 },
    { sum_scaled_score: 90, standard_score: 126 },
    { sum_scaled_score: 91, standard_score: 127 },
    { sum_scaled_score: 92, standard_score: 129 },
    { sum_scaled_score: 93, standard_score: 130 },
    { sum_scaled_score: 94, standard_score: 132 },
    { sum_scaled_score: 95, standard_score: 133 },
    { sum_scaled_score: 96, standard_score: 135 },
    { sum_scaled_score: 97, standard_score: 136 },
    { sum_scaled_score: 98, standard_score: 138 }
];

export function getPlaySchoolTransmutationTables(tables = PLAY_SCHOOL_TRANSMUTATION_TABLES) {
    return normalizePlaySchoolTransmutationTables(tables);
}

export function normalizePlaySchoolDomains(domains = PLAY_SCHOOL_DEFAULT_DOMAINS) {
    const defaults = PLAY_SCHOOL_DEFAULT_DOMAINS.map(domain => ({ ...domain }));
    const source = Array.isArray(domains) && domains.length ? domains : defaults;
    const seen = new Set();
    const normalized = [];

    source.forEach((domain, index) => {
        const label = String(domain.domain_label || domain.label || domain.area_name || domain.domain_key || '').trim();
        const key = normalizePlaySchoolDomainKey(domain.domain_key || domain.key || label);
        if (!label || !key || seen.has(key)) return;

        seen.add(key);
        normalized.push({
            domain_key: key,
            domain_label: label,
            order_index: Number(domain.order_index) || index + 1,
            is_active: Number(domain.is_active ?? 1)
        });
    });

    return normalized.sort((a, b) => {
        const orderDiff = Number(a.order_index) - Number(b.order_index);
        if (orderDiff !== 0) return orderDiff;
        return a.domain_label.localeCompare(b.domain_label);
    });
}

export function normalizePlaySchoolDomainKey(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    const aliases = {
        gross_motor_skills: 'gross_motor',
        fine_motor_skills: 'fine_motor',
        self_help_and_independence: 'self_help',
        social_and_emotional_development: 'social_emotional',
        social_emotional_development: 'social_emotional',
        behavior_and_routine: 'social_emotional',
        cognitive_and_early_learning: 'cognitive',
        creativity_and_play: 'cognitive'
    };

    return aliases[normalized] || normalized;
}

export function normalizePlaySchoolTransmutationTables(data = PLAY_SCHOOL_TRANSMUTATION_TABLES) {
    const defaultTables = PLAY_SCHOOL_TRANSMUTATION_TABLES.map((table, tableIndex) => ({
        age_key: table.age_key,
        age_label: table.age_label,
        age_order: table.age_order || tableIndex + 1,
        rows: table.rows.map((row, rowIndex) => ({
            ...row,
            play_transmutation_id: row.play_transmutation_id || '',
            temp_id: row.temp_id || '',
            order_index: row.order_index || rowIndex + 1
        }))
    }));

    if (!Array.isArray(data) || data.length === 0) return defaultTables;

    const flatRows = data[0]?.rows
        ? data.flatMap(table => table.rows.map(row => ({
            ...row,
            age_key: row.age_key || table.age_key,
            age_label: row.age_label || table.age_label,
            age_order: row.age_order || table.age_order
        })))
        : data;
    const groupedRows = new Map();
    flatRows.forEach((row, index) => {
        const ageKey = String(row.age_key || '').trim();
        const scaledScore = Number(row.scaled_score);
        if (!ageKey || !Number.isFinite(scaledScore)) return;

        if (!groupedRows.has(ageKey)) groupedRows.set(ageKey, []);
        groupedRows.get(ageKey).push({
            play_transmutation_id: row.play_transmutation_id || row.transmutation_id || '',
            temp_id: row.temp_id || '',
            scaled_score: scaledScore,
            order_index: Number(row.order_index) || index + 1,
            ...Object.fromEntries(getRawScoreColumnKeys(row).map(key => [key, normalizeRawScoreCell(row[key])]))
        });
    });

    const combined = defaultTables.map((table, tableIndex) => {
        const incomingRows = groupedRows.get(table.age_key);
        return {
            age_key: table.age_key,
            age_label: flatRows.find(row => String(row.age_key || '').trim() === table.age_key)?.age_label || table.age_label,
            age_order: Number(flatRows.find(row => String(row.age_key || '').trim() === table.age_key)?.age_order) || table.age_order || tableIndex + 1,
            rows: (incomingRows?.length ? incomingRows : table.rows).sort((a, b) => {
                const orderDiff = Number(a.order_index) - Number(b.order_index);
                if (orderDiff !== 0) return orderDiff;
                return Number(a.scaled_score) - Number(b.scaled_score);
            })
        };
    });

    groupedRows.forEach((rows, ageKey) => {
        if (combined.some(table => table.age_key === ageKey)) return;
        const sourceRow = flatRows.find(row => String(row.age_key || '').trim() === ageKey);
        combined.push({
            age_key: ageKey,
            age_label: sourceRow?.age_label || ageKey,
            age_order: Number(sourceRow?.age_order) || (combined.length + 1),
            rows: rows.sort((a, b) => {
                const orderDiff = Number(a.order_index) - Number(b.order_index);
                if (orderDiff !== 0) return orderDiff;
                return Number(a.scaled_score) - Number(b.scaled_score);
            })
        });
    });

    return combined.sort((a, b) => Number(a.age_order) - Number(b.age_order));
}

export function getPlaySchoolTransmutationRows(tables = PLAY_SCHOOL_TRANSMUTATION_TABLES) {
    return normalizePlaySchoolTransmutationTables(tables).flatMap((table, tableIndex) =>
        table.rows.map((row, rowIndex) => ({
            play_transmutation_id: row.play_transmutation_id || '',
            age_key: table.age_key,
            age_label: table.age_label,
            age_order: table.age_order || tableIndex + 1,
            scaled_score: Number(row.scaled_score),
            order_index: row.order_index || rowIndex + 1,
            ...Object.fromEntries(getRawScoreColumnKeys(row).map(key => [key, normalizeRawScoreCell(row[key])]))
        }))
    );
}

export function getPlaySchoolStandardScoreRows(rows = PLAY_SCHOOL_STANDARD_SCORE_ROWS) {
    return normalizePlaySchoolStandardScoreRows(rows);
}

export function normalizePlaySchoolStandardScoreRows(data = PLAY_SCHOOL_STANDARD_SCORE_ROWS) {
    const defaults = PLAY_SCHOOL_STANDARD_SCORE_ROWS.map((row, index) => ({
        ...row,
        standard_score_id: row.standard_score_id || '',
        temp_id: row.temp_id || '',
        order_index: row.order_index || index + 1
    }));

    if (!Array.isArray(data)) return defaults;

    return data.map((row, index) => ({
        standard_score_id: row.standard_score_id || '',
        temp_id: row.temp_id || '',
        sum_scaled_score: Number(row.sum_scaled_score ?? 0),
        standard_score: Number(row.standard_score ?? 0),
        order_index: Number(row.order_index) || index + 1
    })).sort((a, b) => {
        const orderDiff = Number(a.order_index) - Number(b.order_index);
        if (orderDiff !== 0) return orderDiff;
        return Number(a.sum_scaled_score) - Number(b.sum_scaled_score);
    });
}

export function getPlaySchoolScaledScore(ageKey, areaKey, rawScore, tables = PLAY_SCHOOL_TRANSMUTATION_TABLES) {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) return '';

    const table = normalizePlaySchoolTransmutationTables(tables).find(item => item.age_key === ageKey);
    if (!table) return '';

    const match = table.rows.find(row => rawScoreMatchesCell(row[areaKey], score));
    return match?.scaled_score ?? '';
}

export function getPlaySchoolStandardScore(sumScaledScore, rows = PLAY_SCHOOL_STANDARD_SCORE_ROWS) {
    const sum = Number(sumScaledScore);
    if (!Number.isFinite(sum)) return '';

    const match = normalizePlaySchoolStandardScoreRows(rows).find(row => Number(row.sum_scaled_score) === sum);
    return match?.standard_score ?? '';
}

export function getPlaySchoolAgeGroupFromMonths(ageInMonths) {
    const months = Number(ageInMonths);
    if (!Number.isFinite(months)) return null;
    return PLAY_SCHOOL_AGE_GROUPS.find(group => months >= group.min_months && months <= group.max_months) || null;
}

export function getPlaySchoolAgeGroupFromYearsMonths(years, months = 0) {
    const yearValue = Number(years);
    const monthValue = Number(months);
    if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) return null;
    return getPlaySchoolAgeGroupFromMonths((yearValue * 12) + monthValue);
}

export function getPlaySchoolScaledScoreInterpretation(scaledScore, rules = PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS) {
    return findScoreInterpretation(scaledScore, normalizePlaySchoolInterpretations(rules, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS));
}

export function getPlaySchoolStandardScoreInterpretation(standardScore, rules = PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS) {
    return findScoreInterpretation(standardScore, normalizePlaySchoolInterpretations(rules, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS));
}

export function calculatePlaySchoolEccdResult(rawScores, ageKey, tables = PLAY_SCHOOL_TRANSMUTATION_TABLES, standardRows = PLAY_SCHOOL_STANDARD_SCORE_ROWS, domainKeys = null, interpretations = {}) {
    const scaledScores = {};
    const domainInterpretations = {};
    const missingDomains = [];
    const keys = Array.isArray(domainKeys) && domainKeys.length
        ? [...new Set(domainKeys.map(normalizePlaySchoolDomainKey).filter(Boolean))]
        : PLAY_SCHOOL_DOMAIN_KEYS;

    keys.forEach(key => {
        const rawScore = Number(rawScores?.[key]);
        const scaledScore = getPlaySchoolScaledScore(ageKey, key, rawScore, tables);

        if (!Number.isFinite(rawScore) || scaledScore === '') {
            missingDomains.push(key);
            scaledScores[key] = '';
            domainInterpretations[key] = null;
            return;
        }

        scaledScores[key] = Number(scaledScore);
        domainInterpretations[key] = getPlaySchoolScaledScoreInterpretation(scaledScore, interpretations.scaled);
    });

    const complete = missingDomains.length === 0;
    const sumScaledScores = complete
        ? keys.reduce((sum, key) => sum + Number(scaledScores[key] || 0), 0)
        : '';
    const standardScore = complete ? getPlaySchoolStandardScore(sumScaledScores, standardRows) : '';
    const standardInterpretation = standardScore === ''
        ? null
        : getPlaySchoolStandardScoreInterpretation(standardScore, interpretations.standard);
    const lowDomainKeys = keys.filter(key => domainInterpretations[key]?.level === 'below_expected');
    const requiresSecondTierEvaluation = lowDomainKeys.length > 0 || standardInterpretation?.level === 'below_expected';
    const followUpMonths = [
        ...Object.values(domainInterpretations).filter(Boolean).map(item => item.follow_up_months),
        standardInterpretation?.follow_up_months
    ].filter(Number.isFinite).sort((a, b) => a - b)[0] ?? null;

    return {
        age_key: ageKey,
        raw_scores: { ...(rawScores || {}) },
        scaled_scores: scaledScores,
        domain_interpretations: domainInterpretations,
        sum_scaled_scores: sumScaledScores,
        standard_score: standardScore,
        standard_interpretation: standardInterpretation,
        missing_domains: missingDomains,
        is_complete: complete,
        low_domain_keys: lowDomainKeys,
        requires_second_tier_evaluation: requiresSecondTierEvaluation,
        follow_up_months: followUpMonths
    };
}

export function createPlaySchoolTransmutationTable(tables = PLAY_SCHOOL_TRANSMUTATION_TABLES, options = {}) {
    const editable = Boolean(options.editable);
    const columns = getPlaySchoolTransmutationColumns(options.domains);
    const normalizedTables = normalizePlaySchoolTransmutationTables(tables);
    const standardScoreRows = normalizePlaySchoolStandardScoreRows(options.standardScores);
    const interpretations = {
        scaled: normalizePlaySchoolInterpretations(options.interpretations?.scaled, PLAY_SCHOOL_SCALED_SCORE_INTERPRETATIONS),
        standard: normalizePlaySchoolInterpretations(options.interpretations?.standard, PLAY_SCHOOL_STANDARD_SCORE_INTERPRETATIONS)
    };

    return `
        <div class="play-transmutation-shell">
            <style>
                .play-transmutation-shell {
                    --play-blue: #2f5cff;
                    --play-sky: #67bee8;
                    --play-red: #f02d63;
                }
                .play-transmutation-title {
                    color: var(--play-blue);
                    font-weight: 800;
                    font-size: 18px;
                    line-height: 1.18;
                    text-align: center;
                    margin-bottom: 18px;
                }
                .play-transmutation-grid {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(320px, 1fr));
                    gap: 28px;
                    align-items: start;
                }
                .play-transmutation-panel:last-child {
                    grid-column: 1 / -1;
                    justify-self: center;
                    width: min(100%, 620px);
                }
                .play-transmutation-age {
                    color: var(--play-blue);
                    font-size: 16px;
                    font-weight: 800;
                    text-align: center;
                    margin-bottom: 4px;
                }
                .play-transmutation-table {
                    border-color: var(--play-blue);
                    table-layout: fixed;
                    font-size: 10px;
                    line-height: 1.05;
                    margin-bottom: 0;
                }
                .play-transmutation-table th,
                .play-transmutation-table td {
                    border-color: var(--play-blue);
                    padding: 3px 4px;
                    text-align: center;
                    vertical-align: middle;
                }
                .play-transmutation-table th {
                    background: var(--play-sky);
                    color: #fff;
                    font-size: 8px;
                    font-weight: 800;
                }
                .play-transmutation-table th:first-child {
                    background: var(--play-red);
                    width: 42px;
                }
                .play-transmutation-table td:first-child {
                    color: #666;
                    font-weight: 700;
                    width: 42px;
                }
                .play-standard-score-panel {
                    margin: 34px auto 0;
                    max-width: 720px;
                }
                .play-standard-score-title {
                    color: var(--play-blue);
                    font-weight: 800;
                    font-size: 18px;
                    line-height: 1.18;
                    text-align: center;
                    margin-bottom: 8px;
                }
                .play-standard-score-table {
                    border-color: var(--play-blue);
                    font-size: 13px;
                    line-height: 1.1;
                    table-layout: fixed;
                }
                .play-standard-score-table th,
                .play-standard-score-table td {
                    border-color: var(--play-blue);
                    padding: 4px 8px;
                    text-align: center;
                    vertical-align: middle;
                }
                .play-standard-score-table th {
                    background: #acd8f2;
                    color: #fff;
                    font-weight: 800;
                }
                .play-standard-score-sum {
                    color: var(--play-blue);
                    font-weight: 700;
                }
                .play-standard-score-value {
                    color: var(--play-red);
                    font-weight: 800;
                }
                .play-interpretation-guide {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(280px, 1fr));
                    gap: 18px;
                    margin-top: 24px;
                }
                .play-interpretation-guide h6 {
                    color: var(--play-blue);
                    font-size: 14px;
                    font-weight: 800;
                    margin: 0 0 6px;
                }
                .play-interpretation-guide table {
                    font-size: 12px;
                }
                .play-interpretation-guide th {
                    background: #eef6ff;
                    color: #3553b8;
                    font-weight: 800;
                }
                .play-interpretation-row td:first-child {
                    min-width: 210px;
                }
                .play-interpretation-row .play-interpretation-min,
                .play-interpretation-row .play-interpretation-max {
                    min-width: 78px;
                }
                .play-interpretation-row .play-interpretation-label {
                    min-width: 260px;
                    text-align: left;
                }
                .play-transmutation-input {
                    border: 0;
                    border-radius: 0;
                    box-shadow: none;
                    font-size: 10px;
                    height: 22px;
                    min-width: 38px;
                    padding: 1px 2px;
                    text-align: center;
                }
                .play-transmutation-input:focus {
                    box-shadow: inset 0 0 0 1px var(--play-blue);
                }
                @media (max-width: 991.98px) {
                    .play-transmutation-grid {
                        grid-template-columns: 1fr;
                    }
                    .play-transmutation-panel:last-child {
                        grid-column: auto;
                    }
                }
            </style>
            <div class="play-transmutation-title">
                Scaled Score Equivalent of Raw Scores Table<br>
                Child's Record 2
            </div>
            <div class="play-transmutation-grid">
                ${normalizedTables.map(table => createPlaySchoolAgeTransmutationTable(table, editable, columns)).join('')}
            </div>
            ${createPlaySchoolStandardScoreTable(standardScoreRows, editable)}
                ${createPlaySchoolInterpretationGuide(interpretations, editable)}
        </div>
    `;
}

export function getPlaySchoolTransmutationRowsFromEditor(root = document) {
    return Array.from(root.querySelectorAll('.play-transmutation-row')).map(row => {
        const values = {
            play_transmutation_id: row.dataset.playTransmutationId || '',
            temp_id: row.dataset.tempId || '',
            age_key: row.dataset.ageKey || '',
            age_label: row.dataset.ageLabel || '',
            age_order: Number(row.dataset.ageOrder || 0),
            scaled_score: Number(row.querySelector('.play-scaled-score-input')?.value || row.dataset.scaledScore || 0),
            order_index: Number(row.dataset.orderIndex || 0)
        };

        row.querySelectorAll('.play-transmutation-input[data-field]').forEach(input => {
            values[input.dataset.field] = normalizeRawScoreCell(input.value);
        });

        return values;
    });
}

export function validatePlaySchoolTransmutationRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return 'Please keep at least one Play School transmutation row.';
    }

    const uniqueScores = new Set();
    for (const row of rows) {
        if (!row.age_key || !Number.isFinite(Number(row.scaled_score))) {
            return 'Every Play School transmutation row needs an age group and scaled score.';
        }
        const scaledScore = Number(row.scaled_score);
        if (!Number.isInteger(scaledScore) || scaledScore <= 0) {
            return `Scaled score for ${row.age_label || row.age_key} must be a whole number greater than 0.`;
        }
        const pairKey = `${row.age_key}:${scaledScore}`;
        if (uniqueScores.has(pairKey)) {
            return `Scaled score ${scaledScore} is duplicated in ${row.age_label || row.age_key}.`;
        }
        uniqueScores.add(pairKey);

        for (const key of getRawScoreColumnKeys(row)) {
            const value = normalizeRawScoreCell(row[key]);
            if (value === '-') continue;

            const range = value.split('-').map(part => Number(part));
            if (range.length === 1 && Number.isFinite(range[0])) continue;
            if (range.length === 2 && range.every(Number.isFinite) && range[0] <= range[1]) continue;

            const label = PLAY_SCHOOL_TRANSMUTATION_COLUMNS.find(column => column.key === key)?.label || key;
            return `${label} for scaled score ${row.scaled_score} must be a number, range, or dash.`;
        }
    }

    return '';
}

export function getPlaySchoolStandardScoreRowsFromEditor(root = document) {
    return Array.from(root.querySelectorAll('.play-standard-score-row')).map((row, index) => {
        // The row metadata and the standard-score input are in separate table
        // cells, so read both values from the containing table row.
        const tableRow = row.closest('tr') || row;

        return {
            standard_score_id: row.dataset.standardScoreId || '',
            temp_id: row.dataset.tempId || '',
            sum_scaled_score: Number(tableRow.querySelector('.play-standard-score-sum-input')?.value || 0),
            standard_score: Number(tableRow.querySelector('.play-standard-score-input')?.value || 0),
            order_index: Number(row.dataset.orderIndex || index + 1)
        };
    });
}

export function validatePlaySchoolStandardScoreRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return 'Please keep at least one Play School standard score row.';
    }

    const usedSums = new Set();
    for (const row of rows) {
        const sum = Number(row.sum_scaled_score);
        const standard = Number(row.standard_score);
        if (!Number.isInteger(sum) || sum <= 0) {
            return 'Every standard score row needs a valid sum of scaled scores.';
        }
        if (usedSums.has(sum)) {
            return `Sum of scaled scores ${sum} is duplicated.`;
        }
        usedSums.add(sum);

        if (!Number.isInteger(standard) || standard <= 0) {
            return `Standard score for sum ${sum} must be a whole number greater than 0.`;
        }
    }

    return '';
}

const PLAY_SCHOOL_GROUPS = [

];

export function createPlaySchoolChecklistPreview(areas, quarterPeriods = []) {
    const periods = Array.isArray(quarterPeriods) && quarterPeriods.length
        ? quarterPeriods
        : [1, 2, 3].map(number => ({ number, label: `${number}${number === 1 ? 'st' : number === 2 ? 'nd' : 'rd'} Quarter` }));
    const quarterGroups = periods.map((period, index) => ({
        quarter: Number(period.number) || index + 1,
        label: period.label || `Quarter ${index + 1}`,
        groups: createPlaySchoolGroupsFromAreas(
            areas.filter(area => Number(area.introduced_quarter || 1) === (Number(period.number) || index + 1))
        )
    }));

    return `
        <div id="cardPreviewShell" class="report-card-preview border rounded p-3 bg-light">
            <style>
                .play-card-preview-page {
                    background: #f5f6ef;
                    color: #5f625f;
                    border: 1px solid #d9ddd2;
                    min-height: 520px;
                    padding: 26px 34px;
                    font-family: Arial, Helvetica, sans-serif;
                }
                .play-card-preview-title {
                    text-align: center;
                    font-size: 20px;
                    line-height: 1.05;
                    font-weight: 800;
                    letter-spacing: 0;
                    text-transform: uppercase;
                    margin-bottom: 22px;
                }
                .play-card-logo {
                    width: 54px;
                    height: 54px;
                    object-fit: contain;
                    opacity: .58;
                    position: absolute;
                    left: 30px;
                    top: 20px;
                }
                .play-card-info {
                    width: 48%;
                    margin: 0 0 22px 62px;
                    font-size: 16px;
                    line-height: 1.35;
                }
                .play-card-line {
                    border-bottom: 1px solid #777;
                    display: inline-block;
                    min-width: 145px;
                    height: 18px;
                    vertical-align: bottom;
                }
                .play-card-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    column-gap: 52px;
                    row-gap: 26px;
                }
                .play-card-section h6 {
                    color: #565956;
                    font-size: 18px;
                    font-weight: 800;
                    margin: 0 0 4px;
                }
                .play-card-check {
                    display: grid;
                    grid-template-columns: 18px 1fr;
                    gap: 8px;
                    align-items: start;
                    font-size: 15px;
                    line-height: 1.22;
                    margin: 2px 0;
                }
                .play-card-box {
                    width: 15px;
                    height: 15px;
                    border: 1px solid #777;
                    margin-top: 1px;
                    background: transparent;
                }
                .play-card-comments {
                    display: grid;
                    grid-template-columns: .95fr 1.2fr;
                    gap: 52px;
                    margin-top: 8px;
                }
                .play-card-comment-lines {
                    padding-top: 28px;
                }
                .play-card-comment-title,
                .play-card-signature {
                    font-weight: 800;
                    font-size: 18px;
                    color: #555;
                    margin-bottom: 18px;
                }
                .play-card-writing-line {
                    border-bottom: 1px solid #666;
                    height: 21px;
                }
                .play-card-progress {
                    margin-top: 54px;
                }
            </style>
            <div class="nav nav-pills nav-fill gap-2 mb-3" role="tablist" aria-label="Preview quarter">
                ${quarterGroups.map(({ quarter, label }) => `
                    <button class="nav-link ${quarter === 1 ? 'active' : ''}" data-bs-toggle="pill" data-bs-target="#playPreviewQuarter${quarter}" type="button" role="tab">
                        ${escapeHtml(label)}
                    </button>
                `).join('')}
            </div>
            <div class="tab-content">
                ${quarterGroups.map(({ quarter, groups }) => `
                    <div class="tab-pane fade ${quarter === 1 ? 'show active' : ''}" id="playPreviewQuarter${quarter}" role="tabpanel">
                        ${createPlaySchoolQuarterPreviewPage(groups, quarter)}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function createPlaySchoolAgeTransmutationTable(table, editable = false, columns = PLAY_SCHOOL_TRANSMUTATION_COLUMNS) {
    return `
        <div class="play-transmutation-panel">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-1">
                <div class="play-transmutation-age mb-0">${escapeHtml(table.age_label)}</div>
                ${editable ? `
                    <button type="button" class="btn btn-sm btn-outline-primary btn-add-play-transmutation-row" data-age-key="${escapeHtml(table.age_key)}">
                        <i class="bi bi-plus-lg me-1"></i>Add Row
                    </button>
                ` : ''}
            </div>
            <div class="table-responsive">
                <table class="table table-sm table-bordered play-transmutation-table">
                    <thead>
                        <tr>
                            ${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}
                            ${editable ? '<th style="width: 68px;">Action</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${table.rows.length ? table.rows.map((row, rowIndex) => `
                            <tr class="play-transmutation-row"
                                data-play-transmutation-id="${escapeHtml(row.play_transmutation_id || '')}"
                                data-temp-id="${escapeHtml(row.temp_id || '')}"
                                data-age-key="${escapeHtml(table.age_key)}"
                                data-age-label="${escapeHtml(table.age_label)}"
                                data-age-order="${escapeHtml(table.age_order || '')}"
                                data-scaled-score="${escapeHtml(row.scaled_score)}"
                                data-order-index="${escapeHtml(row.order_index || rowIndex + 1)}">
                                ${columns.map(column => createPlaySchoolTransmutationCell(row, column, editable)).join('')}
                                ${editable ? `
                                    <td class="text-center">
                                        <button type="button" class="btn btn-sm btn-outline-warning btn-archive-play-transmutation" data-play-transmutation-id="${escapeHtml(row.play_transmutation_id || '')}" data-temp-id="${escapeHtml(row.temp_id || '')}" data-age-key="${escapeHtml(table.age_key)}">
                                            <i class="bi bi-archive"></i>
                                        </button>
                                    </td>
                                ` : ''}
                            </tr>
                        `).join('') : `
                            <tr>
                                <td colspan="${columns.length + (editable ? 1 : 0)}" class="text-center text-muted">Add the first scaled-score row for this age group.</td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function createPlaySchoolStandardScoreTable(rows, editable = false) {
    return `
        <div class="play-standard-score-panel">
            <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                <div class="play-standard-score-title mb-0">
                    Standard Score Equivalent of Sum of Scaled Scores Table<br>
                    Child's Record 2
                </div>
                ${editable ? `
                    <button type="button" class="btn btn-sm btn-outline-primary btn-add-play-standard-score-row">
                        <i class="bi bi-plus-lg me-1"></i>Add Row
                    </button>
                ` : ''}
            </div>
            <div class="table-responsive">
                <table class="table table-sm table-bordered play-standard-score-table mb-0">
                    <thead>
                        <tr>
                            <th style="width: 180px;">Sum of Scaled Scores</th>
                            <th>Standard Score</th>
                            ${editable ? '<th style="width: 90px;">Action</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.length
                            ? rows.map((row, index) => createPlaySchoolStandardScoreEditorRow(row, editable, index)).join('')
                            : `<tr><td colspan="${editable ? 3 : 2}" class="text-center text-muted">Add the first standard score row.</td></tr>`
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function createPlaySchoolInterpretationGuide(interpretations, editable) {
    return `
        <div class="play-interpretation-guide">
            <div>
                <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                    <h6 class="mb-0">Scaled Score Interpretation</h6>
                    ${editable ? `
                        <button type="button" class="btn btn-sm btn-outline-primary btn-add-play-interpretation-row" data-score-type="scaled">
                            <i class="bi bi-plus-lg me-1"></i>Add Row
                        </button>
                    ` : ''}
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-bordered mb-0">
                        <thead>
                            <tr>
                                <th style="width: 90px;">Scaled Score</th>
                                <th>Interpretation</th>
                                ${editable ? '<th style="width: 90px;">Action</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${interpretations.scaled.length
                                ? interpretations.scaled.map(rule => createInterpretationEditorRow(rule, 'scaled', editable)).join('')
                                : `<tr><td colspan="${editable ? 3 : 2}" class="text-center text-muted">Add the first scaled interpretation row.</td></tr>`
                            }
                        </tbody>
                    </table>
                </div>
            </div>
            <div>
                <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-2">
                    <h6 class="mb-0">Standard Score Interpretation</h6>
                    ${editable ? `
                        <button type="button" class="btn btn-sm btn-outline-primary btn-add-play-interpretation-row" data-score-type="standard">
                            <i class="bi bi-plus-lg me-1"></i>Add Row
                        </button>
                    ` : ''}
                </div>
                <div class="table-responsive">
                    <table class="table table-sm table-bordered mb-0">
                        <thead>
                            <tr>
                                <th style="width: 110px;">Standard Score</th>
                                <th>Interpretation</th>
                                ${editable ? '<th style="width: 90px;">Action</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${interpretations.standard.length
                                ? interpretations.standard.map(rule => createInterpretationEditorRow(rule, 'standard', editable)).join('')
                                : `<tr><td colspan="${editable ? 3 : 2}" class="text-center text-muted">Add the first standard interpretation row.</td></tr>`
                            }
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function createInterpretationEditorRow(rule, type, editable) {
    if (!editable) {
        return `<tr><td class="text-center fw-semibold">${formatInterpretationRange(rule)}</td><td>${escapeHtml(rule.label)}</td></tr>`;
    }

    const min = Number.isFinite(rule.min) ? rule.min : '';
    const max = Number.isFinite(rule.max) ? rule.max : '';
    return `
        <tr class="play-interpretation-row"
            data-interpretation-id="${escapeHtml(rule.interpretation_id || '')}"
            data-temp-id="${escapeHtml(rule.temp_id || '')}"
            data-score-type="${escapeHtml(type)}"
            data-code="${escapeHtml(rule.code)}"
            data-level="${escapeHtml(rule.level)}"
            data-follow-up-months="${escapeHtml(rule.follow_up_months ?? '')}"
            data-order-index="${escapeHtml(rule.order_index)}">
            <td>
                <div class="d-flex align-items-center gap-1">
                    <input type="number" class="form-control form-control-sm play-transmutation-input play-interpretation-min" value="${escapeHtml(min)}" placeholder="No min" aria-label="Minimum score">
                    <span>-</span>
                    <input type="number" class="form-control form-control-sm play-transmutation-input play-interpretation-max" value="${escapeHtml(max)}" placeholder="No max" aria-label="Maximum score">
                </div>
            </td>
            <td><input type="text" maxlength="500" class="form-control form-control-sm play-transmutation-input play-interpretation-label" value="${escapeHtml(rule.label)}"></td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-outline-warning btn-archive-play-interpretation" data-score-type="${escapeHtml(type)}" data-interpretation-id="${escapeHtml(rule.interpretation_id || '')}" data-temp-id="${escapeHtml(rule.temp_id || '')}">
                    <i class="bi bi-archive"></i>
                </button>
            </td>
        </tr>`;
}

export function getPlaySchoolInterpretationsFromEditor(root) {
    const result = { scaled: [], standard: [] };
    root?.querySelectorAll('.play-interpretation-row').forEach(row => {
        const minValue = row.querySelector('.play-interpretation-min')?.value.trim() ?? '';
        const maxValue = row.querySelector('.play-interpretation-max')?.value.trim() ?? '';
        result[row.dataset.scoreType]?.push({
            interpretation_id: row.dataset.interpretationId || '',
            temp_id: row.dataset.tempId || '',
            score_type: row.dataset.scoreType,
            min: minValue === '' ? null : Number(minValue),
            max: maxValue === '' ? null : Number(maxValue),
            code: row.dataset.code || '',
            level: row.dataset.level || '',
            follow_up_months: row.dataset.followUpMonths === '' ? null : Number(row.dataset.followUpMonths),
            order_index: Number(row.dataset.orderIndex) || 1,
            label: row.querySelector('.play-interpretation-label')?.value.trim() || ''
        });
    });
    return result;
}

export function validatePlaySchoolInterpretations(interpretations) {
    for (const type of ['scaled', 'standard']) {
        if (!interpretations[type]?.length) return `Please keep the ${type} score interpretation rows.`;
        for (const row of interpretations[type]) {
            if (!row.label) return `Every ${type} score range needs an interpretation.`;
            if (row.min !== null && row.max !== null && row.min > row.max) {
                return `A ${type} score minimum cannot be greater than its maximum.`;
            }
        }
    }
    return '';
}

function createStandardScorePair(row, editable) {
    if (!row) return '<td></td><td></td>';

    return `
        <td class="play-standard-score-sum">${escapeHtml(row.sum_scaled_score)}</td>
        <td class="play-standard-score-value">
            <span class="play-standard-score-row"
                data-standard-score-id="${escapeHtml(row.standard_score_id || '')}"
                data-sum-scaled-score="${escapeHtml(row.sum_scaled_score)}"
                data-order-index="${escapeHtml(row.order_index || '')}">
                ${editable
                    ? `<input type="number" min="1" step="1" class="form-control form-control-sm play-transmutation-input play-standard-score-input" value="${escapeHtml(row.standard_score)}">`
                    : escapeHtml(row.standard_score)}
            </span>
        </td>
    `;
}

function createPlaySchoolStandardScoreEditorRow(row, editable, index) {
    return `
        <tr>
            <td class="play-standard-score-sum">
                <span class="play-standard-score-row"
                    data-standard-score-id="${escapeHtml(row.standard_score_id || '')}"
                    data-temp-id="${escapeHtml(row.temp_id || '')}"
                    data-order-index="${escapeHtml(row.order_index || index + 1)}">
                    ${editable
                        ? `<input type="number" min="1" step="1" class="form-control form-control-sm play-transmutation-input play-standard-score-sum-input" value="${escapeHtml(row.sum_scaled_score)}">`
                        : escapeHtml(row.sum_scaled_score)}
                </span>
            </td>
            <td class="play-standard-score-value">
                ${editable
                    ? `<input type="number" min="1" step="1" class="form-control form-control-sm play-transmutation-input play-standard-score-input" value="${escapeHtml(row.standard_score)}">`
                    : escapeHtml(row.standard_score)}
            </td>
            ${editable ? `
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-outline-warning btn-archive-play-standard-score" data-standard-score-id="${escapeHtml(row.standard_score_id || '')}" data-temp-id="${escapeHtml(row.temp_id || '')}">
                        <i class="bi bi-archive"></i>
                    </button>
                </td>
            ` : ''}
        </tr>
    `;
}

function createPlaySchoolTransmutationCell(row, column, editable) {
    if (column.key === 'scaled_score') {
        if (!editable) {
            return `<td>${escapeHtml(row[column.key])}</td>`;
        }

        return `
            <td>
                <input type="number"
                    min="1"
                    step="1"
                    class="form-control form-control-sm play-transmutation-input play-scaled-score-input"
                    value="${escapeHtml(row[column.key])}">
            </td>
        `;
    }

    if (!editable) {
        return `<td>${escapeHtml(row[column.key])}</td>`;
    }

    return `
        <td>
            <input type="text"
                class="form-control form-control-sm play-transmutation-input"
                data-field="${escapeHtml(column.key)}"
                value="${escapeHtml(normalizeRawScoreCell(row[column.key]))}">
        </td>
    `;
}

function getPlaySchoolTransmutationColumns(domains = null) {
    const domainColumns = normalizePlaySchoolDomains(domains).map(domain => ({
        key: domain.domain_key,
        label: `${domain.domain_label} raw score`
    }));

    return [
        PLAY_SCHOOL_TRANSMUTATION_COLUMNS[0],
        ...domainColumns
    ];
}

function getRawScoreColumnKeys(row = null) {
    const keys = new Set(
        PLAY_SCHOOL_TRANSMUTATION_COLUMNS
            .filter(column => column.key !== 'scaled_score')
            .map(column => column.key)
    );

    if (row && typeof row === 'object') {
        Object.keys(row).forEach(key => {
            if (!PLAY_SCHOOL_TRANSMUTATION_META_KEYS.has(key)) keys.add(key);
        });
    }

    return Array.from(keys);
}

function normalizeRawScoreCell(value) {
    const normalized = String(value ?? '').trim().replace(/\s+/g, '');
    return normalized || '-';
}

function findScoreInterpretation(score, rules) {
    const value = Number(score);
    if (!Number.isFinite(value)) return null;

    const match = rules.find(rule => value >= rule.min && value <= rule.max);
    return match ? { ...match } : null;
}

function formatInterpretationRange(rule) {
    if (rule.min === Number.NEGATIVE_INFINITY) return `${rule.max} and below`;
    if (rule.max === Number.POSITIVE_INFINITY) return `${rule.min} and above`;
    return rule.min === rule.max ? String(rule.min) : `${rule.min}-${rule.max}`;
}

function rawScoreMatchesCell(cellValue, rawScore) {
    const value = normalizeRawScoreCell(cellValue);
    if (!value || value === '-') return false;

    const range = value.split('-').map(part => Number(part.trim()));
    if (range.length === 2 && range.every(Number.isFinite)) {
        return rawScore >= range[0] && rawScore <= range[1];
    }

    const exact = Number(value);
    return Number.isFinite(exact) && rawScore === exact;
}

function createPlaySchoolGroupsFromAreas(areas) {
    if (!areas.length) return PLAY_SCHOOL_GROUPS;

    const groups = new Map();
    sortAreasByOrder(areas).forEach(area => {
        const rawName = String(area.area_name || '').trim();
        if (!rawName) return;

        const parts = rawName.split(':');
        const legacyTitle = parts.length > 1 ? parts.shift().trim() : 'Observation Checklist';
        const title = String(area.domain_label || '').trim() || legacyTitle;
        const item = String(area.domain_label || '').trim()
            ? rawName
            : (parts.join(':').trim() || rawName);

        if (!groups.has(title)) groups.set(title, []);
        groups.get(title).push(item);
    });

    return Array.from(groups, ([title, items]) => ({ title, items }));
}

function createPlaySchoolGroupPreview(group) {
    return `
        <div class="play-card-section">
            <h6>${escapeHtml(group.title)}</h6>
            ${group.items.map(item => `
                <div class="play-card-check">
                    <span class="play-card-box"></span>
                    <span>${escapeHtml(item)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function createPlaySchoolQuarterPreviewPage(groups, quarter) {
    const ordinal = quarter === 1 ? '1st' : quarter === 2 ? '2nd' : '3rd';

    return `
        <div class="play-card-preview-page position-relative">
            <img class="play-card-logo" src="../../assist/logo.png" alt="">
            <div class="play-card-preview-title">Play School Observation Checklist<br>${ordinal} Quarter</div>
            <div class="play-card-info">
                <div>Child Name: <span class="play-card-line"></span></div>
                <div>Age: <span class="play-card-line"></span></div>
                <div>Observation Period: <span class="play-card-line"></span></div>
                <div>Teacher: <span class="play-card-line"></span></div>
            </div>
            <div class="play-card-grid">
                ${groups.length
                    ? groups.map(createPlaySchoolGroupPreview).join('')
                    : '<div class="text-muted">No checklist items are introduced this quarter.</div>'}
            </div>
        </div>
    `;
}

function sortAreasByOrder(areas) {
    return [...areas].sort((a, b) => {
        const aOrder = Number(a.order_index) || Number.MAX_SAFE_INTEGER;
        const bOrder = Number(b.order_index) || Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return bOrder - aOrder;
        return String(a.area_name || '').localeCompare(String(b.area_name || ''));
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
