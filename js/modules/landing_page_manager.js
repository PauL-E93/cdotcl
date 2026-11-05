import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js?v=20261001-payment-view-only';

import { LANDING_COPY, normalizeLandingCopy } from './landing_content.js?v=20261105';

const API_URL = '../../api/landing_page.php';
const FIELDS = [
    'hero_eyebrow', 'hero_title', 'hero_tagline', 'hero_description',
    'highlight_1_value', 'highlight_1_label', 'highlight_2_value', 'highlight_2_label',
    'highlight_3_value', 'highlight_3_label', 'highlight_4_value', 'highlight_4_label',
    'announcement_1', 'announcement_2', 'announcement_3',
    'picture_1', 'picture_2', 'picture_3', 'mission', 'vision', 'core_values',
    'gmail', 'contact_number', 'facebook'
];
const DEFAULTS = {
    hero_eyebrow: 'WELCOME TO CDO TUTOR!',
    hero_title: 'We Are\nYour Teachers!',
    hero_tagline: LANDING_COPY.hero_tagline,
    hero_description: LANDING_COPY.hero_description,
    mission: LANDING_COPY.mission,
    vision: LANDING_COPY.vision,
    highlight_1_value: '5.3K+',
    highlight_1_label: 'Followers\nand growing',
    highlight_2_value: 'Licensed',
    highlight_2_label: 'Professional\nTeachers',
    highlight_3_value: 'All Levels',
    highlight_3_label: 'All Subjects\nCovered',
    highlight_4_value: 'Quality',
    highlight_4_label: 'Education You\nCan Trust'
};

let record = null;

function populate(data = {}) {
    data = normalizeLandingCopy(data);
    FIELDS.forEach(field => {
        const input = document.getElementById(`landing-${field}`);
        if (input) input.value = data[field] || DEFAULTS[field] || '';
    });
    document.getElementById('landing-page-save')?.replaceChildren(document.createTextNode(data.landingpage_id ? 'Save Landing Page Content' : 'Create Landing Page Content'));
}

export async function initLandingPageManager() {
    const form = document.getElementById('landing-page-form');
    if (!form || !canUseProgramPermission('view_landing')) return;
    try {
        const response = await axios.get(API_URL, { params: { operation: 'getLandingPage' } });
        record = response.data?.[0] || null;
        populate(record || {});
    } catch (error) {
        console.error('Unable to load landing page settings:', error);
        Swal.fire('Unable to load', 'Landing page settings could not be loaded.', 'error');
    }

    const canEditLanding = canUseProgramPermission('edit_landing');
    form.querySelectorAll('input, textarea, select').forEach(control => {
        control.disabled = !canEditLanding;
    });
    document.getElementById('landing-page-save')?.classList.toggle('d-none', !canEditLanding);

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!guardProgramPermission('edit_landing', 'You do not have permission to edit landing-page content.')) return;
        const data = Object.fromEntries(FIELDS.map(field => {
            const input = document.getElementById(`landing-${field}`);
            return [field, input ? input.value.trim() : (record?.[field] || '')];
        }));
        if (record?.landingpage_id) data.landingpage_id = record.landingpage_id;
        try {
            await axios.post(API_URL, new URLSearchParams({ operation: record ? 'updateLandingPage' : 'insertLandingPage', json: JSON.stringify(data) }));
            Swal.fire('Saved', 'Landing page content is now updated.', 'success');
            if (!record) {
                const response = await axios.get(API_URL, { params: { operation: 'getLandingPage' } });
                record = response.data?.[0] || null;
                populate(record || {});
            }
        } catch (error) {
            console.error('Unable to save landing page settings:', error);
            Swal.fire('Unable to save', 'Please try again.', 'error');
        }
    });
}
