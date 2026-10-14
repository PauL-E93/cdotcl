import './utilities/csrf.js';
import { handleLogin, initLoginPage, initializeAuthGuard } from './modules/login.js?v=20260930-remember-me';

window.handleLogin = handleLogin;

document.addEventListener('DOMContentLoaded', async () => {
    if (await initializeAuthGuard()) {
        initLoginPage();
    }
});
