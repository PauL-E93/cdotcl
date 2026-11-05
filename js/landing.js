import { initLandingPage } from './modules/landingpage.js?v=20261105-consistent-layout';
import { initFaqLanding } from './modules/faq.js?v=20261001-faq-archive';

// The public page can load independently of the authenticated application.
initLandingPage();
initFaqLanding();
