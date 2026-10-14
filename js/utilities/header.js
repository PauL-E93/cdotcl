import { logout } from "../modules/login.js?v=20260921-notification-history";
import { createNotificationBell } from "./notif.js?v=20260921-actions";
import { buildAppUrl } from "./app_url.js";

function injectHeaderProfileStyles() {
    if (document.getElementById('header-profile-styles')) return;

    const style = document.createElement('style');
    style.id = 'header-profile-styles';
    style.textContent = `
        #dynamic-header { left:0; right:0; width:auto; }
        .header-profile-button { width:42px; height:42px; display:inline-flex; align-items:center; justify-content:center; flex:0 0 42px; padding:0; overflow:hidden; border:2px solid rgba(234,154,166,.5); border-radius:50%; background:#fff4f6; color:#b94f62; font:inherit; line-height:1; cursor:pointer; transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease; }
        .header-profile-button:hover,.header-profile-button:focus-visible { border-color:#ea9aa6; box-shadow:0 0 0 3px rgba(234,154,166,.2); outline:none; }
        .header-profile-button:active { transform:scale(.96); }
        .header-profile-image { width:100% !important; height:100% !important; max-width:42px; max-height:42px; display:block; object-fit:cover; }
        .header-profile-initials { font-size:.82rem; font-weight:800; letter-spacing:.02em; }
        .profile-dropdown { position:absolute; top:calc(100% + 18px); right:0; z-index:1100; width:min(290px,calc(100vw - 24px)); padding:8px; overflow:visible; border:1px solid #f2d7dc; border-radius:14px; background:#fff; box-shadow:0 16px 40px rgba(79,32,45,.16); color:#35252a; font-size:.9rem; }
        .profile-dropdown[hidden] { display:none !important; }
        .profile-dropdown::before { content:''; position:absolute; top:-7px; right:14px; width:14px; height:14px; border-top:1px solid #f2d7dc; border-left:1px solid #f2d7dc; background:#fff7f9; transform:rotate(45deg); }
        .profile-dropdown-header { display:flex; flex-direction:column; align-items:flex-start; padding:13px 14px 14px; border-radius:10px; background:linear-gradient(135deg,#fff3f6 0%,#fff9fa 100%); }
        .profile-dropdown-eyebrow { margin-bottom:2px; color:#a66a75; font-size:.68rem; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
        .profile-dropdown-identity { max-width:100%; overflow:hidden; color:#35252a; font-size:.96rem; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
        .profile-dropdown-role { margin-top:5px; padding:3px 8px; border-radius:999px; background:#ea9aa6; color:#fff; font-size:.68rem; font-weight:700; }
        .profile-dropdown-action { width:100%; display:grid; grid-template-columns:36px minmax(0,1fr) auto; align-items:center; gap:10px; margin-top:5px; padding:10px; border:0; border-radius:9px; background:transparent; color:#49363c; font:inherit; text-align:left; cursor:pointer; transition:color .18s ease,background-color .18s ease; }
        .profile-dropdown-action:hover,.profile-dropdown-action:focus-visible { background:#fff1f4; color:#b94f62; outline:none; }
        .profile-dropdown-action-icon { width:36px; height:36px; display:grid; place-items:center; border-radius:9px; background:#fde3e8; color:#bd5265; font-size:1rem; }
        .profile-dropdown-action>span:nth-child(2) { min-width:0; }
        .profile-dropdown-action strong,.profile-dropdown-action small { display:block; }
        .profile-dropdown-action strong { font-size:.84rem; line-height:1.3; }
        .profile-dropdown-action small { margin-top:2px; color:#8b747b; font-size:.7rem; line-height:1.3; }
        .profile-dropdown-chevron { color:#c7a8af; font-size:.75rem; }
        .profile-dropdown-logout { border-top:1px solid #f6e7ea; border-radius:0 0 9px 9px; }
        .profile-dropdown-logout:hover,.profile-dropdown-logout:focus-visible { background:#fff0f0; color:#c73d4d; }
        .profile-dropdown-logout .profile-dropdown-action-icon { background:#ffeaec; color:#c73d4d; }
        @media (max-width:576px) { .profile-dropdown { top:calc(100% + 14px); right:-2px; } }
    `;
    document.head.appendChild(style);
}

function getInitials(user = {}) {
    const first = String(user.first_name || '').trim().charAt(0);
    const last = String(user.last_name || '').trim().charAt(0);
    return (first + last).toUpperCase() || '?';
}

function resolveProfilePictureUrl(profilePicture) {
    return window.resolveUploadUrl(profilePicture);
}

function renderProfileAvatar(button, user = {}) {
    button.replaceChildren();

    const pictureUrl = resolveProfilePictureUrl(user.profile_picture);
    if (pictureUrl) {
        const image = document.createElement('img');
        image.className = 'header-profile-image';
        image.width = 42;
        image.height = 42;
        image.src = pictureUrl;
        image.alt = '';
        image.addEventListener('error', () => renderProfileAvatar(button, {
            ...user,
            profile_picture: ''
        }), { once: true });
        button.appendChild(image);
        return;
    }

    const initials = getInitials(user);
    if (initials !== '?') {
        const fallback = document.createElement('span');
        fallback.className = 'header-profile-initials';
        fallback.textContent = initials;
        fallback.setAttribute('aria-hidden', 'true');
        button.appendChild(fallback);
        return;
    }

    const icon = document.createElement('i');
    icon.className = 'bi bi-person-circle';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
}

async function loadHeaderProfile(button, user) {
    const userId = Number(user?.user_id || user?.student_id || user?.employee_id);
    if (!Number.isInteger(userId) || userId <= 0) return;

    const isStudent = String(user?.user_type || user?.role_name || '').toLowerCase() === 'student';
    const endpoint = isStudent
        ? `../../api/admin/student.php?operation=getStudentProfile&student_id=${encodeURIComponent(userId)}`
        : `../../api/admin/employee.php?operation=getEmployeeProfile&employee_id=${encodeURIComponent(userId)}`;

    try {
        const response = await fetch(endpoint, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin'
        });
        if (!response.ok) return;

        const result = await response.json();
        if (result?.status === 'success' && result.data) {
            renderProfileAvatar(button, result.data);
        }
    } catch (error) {
        console.warn('Unable to load the header profile picture:', error);
    }
}

export function createHeader() {
    const headerContainer = document.getElementById('dynamic-header');
    if (!headerContainer) {
        return;
    }

    injectHeaderProfileStyles();

    // 1. Get current user role from localStorage
    // The role is stored inside the 'user' object as role_name
    const userData = localStorage.getItem('user');
    let userRole = 'guest';
    let currentUser = {};
    if (userData) {
        try {
            currentUser = JSON.parse(userData) || {};
            userRole = currentUser.role_name?.toLowerCase() || 'guest';
        } catch (e) {
        }
    }

    const currentPath = window.location.pathname;

    // Role to folder mapping
    const roleFolderMap = {
        'owner': 'owner',
        'auditor': 'auditor',
        'branch admin': 'branch_admin',
        'secretary': 'secretary',
        'student': 'student',
        'teacher': 'teacher'
    };

    const userFolder = roleFolderMap[userRole] || 'owner';

    const navLeft = document.createElement('div');
    navLeft.className = 'nav-left';

    const sidebarToggle = document.createElement('button');
    sidebarToggle.type = 'button';
    sidebarToggle.className = 'sidebar-toggle';
    sidebarToggle.title = 'Toggle navigation';
    sidebarToggle.setAttribute('aria-label', 'Toggle navigation');
    sidebarToggle.setAttribute('aria-controls', 'sidebar');
    sidebarToggle.innerHTML = '<i class="bi bi-list"></i>';

    const isSmallScreen = () => window.matchMedia('(max-width: 992px)').matches;

    sidebarToggle.addEventListener('click', () => {
        if (isSmallScreen()) {
            const opened = document.body.classList.toggle('sidebar-open');
            document.body.classList.remove('sidebar-collapsed');
            localStorage.setItem('sidebarOpen', opened ? 'true' : 'false');
            sidebarToggle.setAttribute('aria-expanded', String(opened));
        } else {
            const collapsed = document.body.classList.toggle('sidebar-collapsed');
            document.body.classList.remove('sidebar-open');
            localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
            sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
        }
    });

    const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const isSidebarOpen = localStorage.getItem('sidebarOpen') === 'true';

    if (!isSmallScreen() && isSidebarCollapsed) {
        document.body.classList.add('sidebar-collapsed');
    }

    if (isSmallScreen() && isSidebarOpen) {
        document.body.classList.add('sidebar-open');
    }

    sidebarToggle.setAttribute('aria-expanded', String(
        isSmallScreen() ? isSidebarOpen : !isSidebarCollapsed
    ));

    window.addEventListener('resize', () => {
        if (!isSmallScreen()) {
            document.body.classList.remove('sidebar-open');
        }

        sidebarToggle.setAttribute('aria-expanded', String(
            isSmallScreen()
                ? document.body.classList.contains('sidebar-open')
                : !document.body.classList.contains('sidebar-collapsed')
        ));
    });

    document.addEventListener('click', (event) => {
        const sidebar = document.getElementById('sidebar');
        const clickInsideSidebar = sidebar && sidebar.contains(event.target);
        const clickOnToggle = sidebarToggle.contains(event.target);

        if (isSmallScreen() && document.body.classList.contains('sidebar-open') && !clickInsideSidebar && !clickOnToggle) {
            document.body.classList.remove('sidebar-open');
            localStorage.setItem('sidebarOpen', 'false');
            sidebarToggle.setAttribute('aria-expanded', 'false');
        }
    });

    // Logo setup
    const logoContainer = document.createElement('div');
    logoContainer.className = 'logo-container';
    const logoImg = document.createElement('img');

    logoImg.src = '../../assist/logo.png'; 
    logoImg.alt = 'CDO LC Logo';

    logoImg.onerror = function() {
        this.style.display='none';
        logoContainer.innerText = 'CDO LOGO';
        logoContainer.style.fontWeight = 'bold';
    };
    logoContainer.appendChild(logoImg);

    // 2. No navigation items in header anymore - moved to sidebar

    // Assemble Left Section
    navLeft.appendChild(sidebarToggle);
    navLeft.appendChild(logoContainer);
    // Removed navList from header - moved to sidebar

    // 4. Create Right Section (Settings + Profile)
    const navActions = document.createElement('div');
    navActions.className = 'nav-actions';
    navActions.style.position = 'relative';

    const notificationBell = createNotificationBell();

    const profileButton = document.createElement('button');
    profileButton.type = 'button';
    profileButton.className = 'header-profile-button';
    profileButton.title = 'Open profile menu';
    profileButton.setAttribute('aria-label', 'Open profile menu');
    profileButton.setAttribute('aria-haspopup', 'menu');
    profileButton.setAttribute('aria-expanded', 'false');
    renderProfileAvatar(profileButton, currentUser);

    // Dropdown menu
    const dropdownMenu = document.createElement('div');
    dropdownMenu.className = 'profile-dropdown';
    dropdownMenu.hidden = true;
    dropdownMenu.setAttribute('role', 'menu');

    const dropdownHeader = document.createElement('div');
    dropdownHeader.className = 'profile-dropdown-header';

    const dropdownEyebrow = document.createElement('span');
    dropdownEyebrow.className = 'profile-dropdown-eyebrow';
    dropdownEyebrow.textContent = 'Signed in as';

    const dropdownIdentity = document.createElement('strong');
    dropdownIdentity.className = 'profile-dropdown-identity';
    dropdownIdentity.textContent = currentUser.username || 'My account';

    const dropdownRole = document.createElement('span');
    dropdownRole.className = 'profile-dropdown-role';
    dropdownRole.textContent = userRole === 'guest'
        ? 'Account'
        : userRole.replace(/\b\w/g, character => character.toUpperCase());

    dropdownHeader.append(dropdownEyebrow, dropdownIdentity, dropdownRole);

    const profileOption = document.createElement('button');
    profileOption.type = 'button';
    profileOption.className = 'profile-dropdown-action';
    profileOption.setAttribute('role', 'menuitem');
    profileOption.innerHTML = '<span class="profile-dropdown-action-icon"><i class="bi bi-person" aria-hidden="true"></i></span><span><strong>My Profile</strong><small>View and update your details</small></span><i class="bi bi-chevron-right profile-dropdown-chevron" aria-hidden="true"></i>';
    profileOption.addEventListener('click', () => {
        const profileHref = buildAppUrl(`html/${userFolder}/profile.html`);
        window.location.href = profileHref;
        dropdownMenu.hidden = true;
    });

    const logoutOption = document.createElement('button');
    logoutOption.type = 'button';
    logoutOption.className = 'profile-dropdown-action profile-dropdown-logout';
    logoutOption.setAttribute('role', 'menuitem');
    logoutOption.innerHTML = '<span class="profile-dropdown-action-icon"><i class="bi bi-box-arrow-right" aria-hidden="true"></i></span><span><strong>Log Out</strong><small>End your current session</small></span>';
    logoutOption.addEventListener('click', () => {
        logout();
        dropdownMenu.hidden = true;
    });

    dropdownMenu.appendChild(dropdownHeader);
    dropdownMenu.appendChild(profileOption);
    dropdownMenu.appendChild(logoutOption);

    profileButton.addEventListener('click', () => {
        dropdownMenu.hidden = !dropdownMenu.hidden;
        profileButton.setAttribute('aria-expanded', dropdownMenu.hidden ? 'false' : 'true');
    });

    document.addEventListener('click', (e) => {
        if (!profileButton.contains(e.target) && !dropdownMenu.contains(e.target)) {
            dropdownMenu.hidden = true;
            profileButton.setAttribute('aria-expanded', 'false');
        }
    });

    navActions.appendChild(notificationBell);
    navActions.appendChild(profileButton);
    navActions.appendChild(dropdownMenu);

    // Final Assembly
    headerContainer.innerHTML = ''; // Clear existing content before appending
    headerContainer.appendChild(navLeft);
    headerContainer.appendChild(navActions);

    loadHeaderProfile(profileButton, currentUser);
}
