import { canUseProgramPermission, guardProgramPermission } from './program_rbac.js';

const API_URL = '../../api/landing_page.php';
const FIELDS = ['announcement_1', 'announcement_2', 'announcement_3', 'picture_1', 'picture_2', 'picture_3', 'mission', 'vision', 'core_values', 'gmail', 'contact_number', 'facebook'];

let record = null;

function populate(data = {}) {
    FIELDS.forEach(field => {
        const input = document.getElementById(`landing-${field}`);
        if (input) input.value = data[field] || '';
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
        const data = Object.fromEntries(FIELDS.map(field => [field, document.getElementById(`landing-${field}`).value.trim()]));
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
