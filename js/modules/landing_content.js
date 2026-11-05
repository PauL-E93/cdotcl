// Correct known legacy copy while preserving content entered in the page editor.
export const LANDING_COPY = {
    hero_tagline: 'Kind, friendly, and dedicated professionals.',
    hero_description: 'We are licensed professional teachers who provide high-quality learning support for students at all levels and in all subjects.',
    mission: 'To provide excellent service and learning experiences that nurture each child academically, emotionally, socially, and physically, while maintaining positive, harmonious, and enjoyable learning and working environments.',
    vision: 'To become a nationally recognized learning center and school with outstanding teachers and students.'
};

const LEGACY_COPY = {
    hero_tagline: ['Kind friendly, dedicated professionals'],
    hero_description: ['We are licensed professional teachers who cater all levels and all subjects with excellent and quality services.'],
    mission: [
        'To provide good customer service satisfaction. Excellent learning that will nurture a child academically, emotionally, socially, and physically. Keeping positive, harmonious, enjoyable learning and working environments.',
        'To provide good customer service satisfaction. Excellent learning that will nurture a child academicallyd working environments.'
    ],
    vision: ['To become a nationally-recognized learning center and school with a hundred of excellence teachers and students.']
};

export function normalizeLandingCopy(data = {}) {
    const result = { ...data };
    Object.entries(LEGACY_COPY).forEach(([field, versions]) => {
        if (versions.includes(String(result[field] || '').trim())) result[field] = LANDING_COPY[field];
    });
    ['announcement_1', 'announcement_2', 'announcement_3'].forEach(field => {
        if (result[field]) result[field] = result[field].replace(/With the teachers guidance/g, "With the teacher's guidance");
    });
    return result;
}
