import { renderPasswordModal, setupPasswordModal } from "./password.js";

let gendersList = [];
let currentStudentData = null;
let lastLoadedStudentId = null;

function formatStudentName(student = {}) {
    return [student.first_name, student.last_name, student.ext]
        .filter(part => part && part.toString().trim())
        .map(part => part.toString().trim())
        .join(' ');
}

function getGenderLabel(genderId) {
    const match = Array.isArray(gendersList)
        ? gendersList.find(gender => String(gender.gender_id) === String(genderId))
        : null;

    return match?.gender || 'Not set';
}

export function initStudentProfile() {
    const container = document.getElementById('dashboard-content') || document.querySelector('.dashboard-content');
    if (!container) return;

    // Get logged-in student ID from localStorage
    const userData = localStorage.getItem('user');
    const user = userData ? JSON.parse(userData) : null;
    
    // Try user_id first (from login), fall back to student_id
    const studentId = user?.user_id || user?.student_id || 1;

    console.log('Current logged-in user:', user);
    console.log('Student ID from localStorage:', studentId);

    // Only load if student_id changed or first load
    if (lastLoadedStudentId !== studentId) {
        lastLoadedStudentId = studentId;
        currentStudentData = null; // Clear cached data
        
        // Load genders first
        axios.get('../../api/admin/student.php?operation=getGenders')
            .then(res => {
                gendersList = Array.isArray(res.data) ? res.data : [];
                console.log('Genders loaded:', gendersList);
                loadStudentProfile(studentId, container);
            })
            .catch(err => {
                console.error('Error loading genders:', err);
                gendersList = [];
                loadStudentProfile(studentId, container);
            });
    }
}

function loadStudentProfile(studentId, container) {
    // Fetch actual student profile data from API
    axios.get(`../../api/admin/student.php?operation=getStudentProfile&student_id=${studentId}`)
        .then(res => {
            console.log('Profile API Response:', res.data);
            
            if (res.data && res.data.status === 'success' && res.data.data) {
                const student = res.data.data;
                
                // Build profile data combining API data with defaults
                const addressParts = [student.adr_street, student.adr_barangay, student.adr_city, student.adr_province]
                    .filter(part => part && part.toString().trim().length > 0)
                    .map(part => part.toString().trim());
                const profileData = {
                    student_id: student.student_id,
                    student_id_number: student.student_id_number || 'N/A',
                    guardian_id: student.guardian_id,
                    username: student.username || '',
                    fullName: formatStudentName(student),
                    first_name: student.first_name || '',
                    last_name: student.last_name || '',
                    ext: student.ext || '',
                    middle_name: student.middle_name || '',
                    email: student.email || '',
                    phone: student.guardian_contact || 'N/A',
                    address: addressParts.length > 0 ? addressParts.join(', ') : 'Address not set',
                    address_note: student.adr_note || '',
                    birthday: student.birthday || '',
                    age: calculateAge(student.birthday),
                    gender_id: student.gender_id || '',
                    nickname: student.nickname || '',
                    profile_picture: student.profile_picture || '',
                    guardian_name: student.guardian_name || '',
                    guardian_contact: student.guardian_contact || '',
                    guardian_relationship: student.guardian_relationship || '',
                    health_note: student.health_note || '',
                    role: 'Student',
                    status: 'Online',
                    earnings: '0.00',
                    earningsTrend: '+ 0%',
                    balance: '0.00',
                    upcoming: 0,
                    completed: 0,
                    hours: 0,
                    paymentMethod: 'Not set'
                };
                
                currentStudentData = profileData;
                renderProfilePage(profileData, container);
                renderPasswordModal(container);
                setupEditProfileModal(profileData, container);
                setupPasswordModal(profileData);
            } else {
                console.error('Unexpected API response:', res.data);
                loadDemoProfile(container);
            }
        })
        .catch(err => {
            console.error('Error loading student profile:', err.message);
            loadDemoProfile(container);
        });
}

function loadDemoProfile(container) {
    // Fallback demo data when API is unavailable
    const profileData = {
        student_id: 1,
        student_id_number: 'STU-0001',
        guardian_id: 1,
        username: 'cmapagmahal',
        fullName: 'Carl Mapagmahal',
        first_name: 'Carl',
        last_name: 'Mapagmahal',
        ext: '',
        middle_name: '',
        email: 'cmapagmahal@gmail.com',
        phone: '+1 (234) 567 8901',
        address: '123 Learning Lane, EduCity, 56789, USA',
        birthday: '2005-08-15',
        age: calculateAge('2005-08-15'),
        gender_id: 1,
        nickname: 'CM',
        profile_picture: '',
        guardian_name: 'Maria Mapagmahal',
        guardian_contact: '+1 (234) 567 8901',
        guardian_relationship: 'Mother',
        health_note: '',
        role: 'Math Tutor',
        status: 'Online',
        earnings: '$5,250.00',
        earningsTrend: '+ 112.5%',
        balance: '$725.00',
        upcoming: 6,
        completed: 18,
        hours: 56,
        paymentMethod: 'Visa ***** 4242'
    };

    currentStudentData = profileData;
    renderProfilePage(profileData, container);
    renderPasswordModal(container);
    setupEditProfileModal(profileData, container);
    setupPasswordModal(profileData);
}

function renderProfilePage(profileData, container) {
    const primaryColor = '#ea9aa6';
    const formattedBirthday = profileData.birthday
        ? new Date(profileData.birthday).toLocaleDateString()
        : 'Not set';
    const guardianName = profileData.guardian_name || 'Not set';
    const guardianContact = profileData.guardian_contact || profileData.phone || 'Not set';
    const guardianRelationship = profileData.guardian_relationship || 'Not set';
    const nickname = profileData.nickname || 'Not set';
    const nameExtension = profileData.ext || 'Not set';
    const username = profileData.username || 'Not set';
    const email = profileData.email || 'Not set';
    const genderLabel = getGenderLabel(profileData.gender_id);
    const addressNote = profileData.address_note
        ? `<div class="text-muted small mt-1">${profileData.address_note}</div>`
        : '';

    container.innerHTML = `
        <style>
            .profile-card { border-radius: 12px; border: none; box-shadow: 0 2px 12px rgba(0,0,0,0.04); background: #fff; margin-bottom: 1rem; }
            .compact-header { padding: 1.5rem !important; }
            .section-title { font-size: 1rem; font-weight: 600; color: #333; margin-bottom: 1rem; display: flex; align-items: center; gap: 8px; }
            .btn-action { border: 1px solid #eee; border-radius: 6px; padding: 6px 12px; font-size: 0.85rem; background: #fff; color: #666; transition: 0.2s; }
            .btn-action:hover { background: ${primaryColor}; color: white; border-color: ${primaryColor}; }
            .info-label { color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; }
            .info-value { color: #333; font-weight: 500; font-size: 0.9rem; margin-bottom: 12px; }
            .stat-badge { border-radius: 8px; padding: 10px; text-align: center; background: #fdfdfd; border: 1px solid #f0f0f0; }
        </style>

        <div class="container-fluid p-0">
            <div class="row g-3">
                <div class="col-12">
                    <div class="card profile-card compact-header">
                        <div class="row align-items-center">
                            <div class="col-auto position-relative">
                                ${profileData.profile_picture ? 
                                    `<img src="${resolveProfilePictureUrl(profileData.profile_picture)}" alt="Profile" class="rounded-circle" style="width: 80px; height: 80px; object-fit: cover; border: 3px solid ${primaryColor};">` :
                                    `<div class="rounded-circle d-flex align-items-center justify-content-center fw-bold" 
                                        style="width: 80px; height: 80px; background: ${primaryColor}; color: white; font-size: 1.5rem;">
                                        ${getInitials(profileData.first_name, profileData.last_name)}
                                    </div>`
                                }
                            </div>
                            <div class="col">
                                <h4 class="mb-0 fw-bold">${profileData.fullName}</h4>
                                <div class="d-flex align-items-center gap-2 mt-1" style="font-size: 0.85rem;">
                                    <span style="color: ${primaryColor}"><i class="bi bi-patch-check-fill"></i> ${profileData.role}</span>
                                    <span class="text-muted">|</span>
                                    <span class="text-success">● ${profileData.status}</span>
                                </div>
                                <div class="d-flex gap-3 mt-2" style="font-size: 0.8rem; color: #777;">
                                    <span><i class="bi bi-envelope"></i> ${profileData.email}</span>
                                    <span><i class="bi bi-telephone"></i> ${profileData.phone}</span>
                                </div>
                            </div>
                        </div>
                        <div class="d-flex gap-2 mt-3">
                            <button type="button" class="btn btn-action flex-grow-1" id="editProfileBtn"><i class="bi bi-pencil"></i> Edit Profile</button>
                            <button type="button" class="btn btn-action flex-grow-1" id="passwordStudentProfileBtn"><i class="bi bi-shield-lock"></i> Password</button>
                        </div>
                    </div>

                    <div class="row g-3">
                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3">
                                <h6 class="section-title"><i class="bi bi-person" style="color:${primaryColor}"></i> Personal Info</h6>
                                <div class="info-label">Full Name</div>
                                <div class="info-value">${profileData.fullName}</div>
                                <div class="info-label">Name Extension</div>
                                <div class="info-value">${nameExtension}</div>
                                <div class="info-label">Student ID</div>
                                <div class="info-value">${profileData.student_id_number}</div>
                                <div class="info-label">Username</div>
                                <div class="info-value">${username}</div>
                                <div class="info-label">Age</div>
                                <div class="info-value">${profileData.age}</div>
                                <div class="info-label">Nickname</div>
                                <div class="info-value mb-0">${nickname}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-people" style="color:${primaryColor}"></i> Guardian Details</h6>
                                <div class="info-label">Guardian Name</div>
                                <div class="info-value">${guardianName}</div>
                                <div class="info-label">Relationship</div>
                                <div class="info-value">${guardianRelationship}</div>
                                <div class="info-label">Contact Number</div>
                                <div class="info-value mb-0">${guardianContact}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-mortarboard" style="color:${primaryColor}"></i> Student Details</h6>
                                <div class="info-label">Role</div>
                                <div class="info-value">${profileData.role}</div>
                                <div class="info-label">Birthday</div>
                                <div class="info-value">${formattedBirthday}</div>
                                <div class="info-label">Gender</div>
                                <div class="info-value">${genderLabel}</div>
                                <div class="info-label">Status</div>
                                <div class="info-value mb-0">${profileData.status}</div>
                            </div>
                        </div>

                        <div class="col-lg-6 col-md-6">
                            <div class="card profile-card p-3 h-100">
                                <h6 class="section-title"><i class="bi bi-telephone" style="color:${primaryColor}"></i> Contact Details</h6>
                                <div class="info-label">Email Address</div>
                                <div class="info-value">${email}</div>
                                <div class="info-label">Contact Number</div>
                                <div class="info-value">${guardianContact}</div>
                                <div class="info-label">Address</div>
                                <div class="info-value mb-0">${profileData.address}</div>
                                ${addressNote}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Edit Profile Modal -->
        <div class="modal fade" id="editProfileModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Edit Profile</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="editProfileForm" enctype="multipart/form-data">
                            <h6 class="text-primary mb-3">Profile Picture</h6>
                            <div class="mb-3">
                                <label class="form-label">Profile Picture</label>
                                <div class="d-flex align-items-center gap-3">
                                    <div id="previewProfilePicture" class="rounded-circle d-flex align-items-center justify-content-center fw-bold" 
                                         style="width: 80px; height: 80px; background: #ea9aa6; color: white; font-size: 1.5rem; overflow: hidden;">
                                    </div>
                                    <input type="file" class="form-control" id="editProfilePicture" accept="image/*">
                                </div>
                                <small class="text-muted d-block mt-2">Accepted formats: JPG, PNG, GIF (Max 5MB)</small>
                            </div>

                            <h6 class="text-primary mb-3 border-top pt-3">Student Details</h6>
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                <label class="form-label">First Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editFirstName" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Middle Name</label>
                                    <input type="text" class="form-control" id="editMiddleName">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Last Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editLastName" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Name Extension</label>
                                    <select class="form-select" id="editNameExtension">
                                        <option value="">None</option>
                                        <option value="Jr.">Jr.</option>
                                        <option value="Sr.">Sr.</option>
                                        <option value="II">II</option>
                                        <option value="III">III</option>
                                        <option value="IV">IV</option>
                                        <option value="V">V</option>
                                    </select>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Nickname</label>
                                    <input type="text" class="form-control" id="editNickname">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Birthday</label>
                                    <input type="date" class="form-control" id="editBirthday">
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Gender</label>
                                    <select class="form-select" id="editGenderId">
                                        <option value="">Select Gender</option>
                                    </select>
                                </div>
                                <div class="col-md-12 mb-3">
                                    <label class="form-label">Email <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="email" class="form-control" id="editEmail" required>
                                </div>
                            </div>

                            <h6 class="text-primary mb-3 border-top pt-3">Guardian Details</h6>
                            <div class="row">
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Guardian Name <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editGuardianName" required>
                                </div>
                                <div class="col-md-6 mb-3">
                                    <label class="form-label">Contact Number <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="tel" class="form-control" id="editGuardianContact" required>
                                </div>
                                <div class="col-md-12 mb-3">
                                    <label class="form-label">Relationship <span class="text-danger" aria-hidden="true">*</span></label>
                                    <input type="text" class="form-control" id="editGuardianRelationship" required>
                                </div>
                            </div>

                            <h6 class="text-primary mb-3 border-top pt-3">
                                <i class="bi bi-heart-pulse me-1"></i> Medical &amp; Safety Notes
                            </h6>
                            <div class="mb-3">
                                <label class="form-label" for="editHealthNote">Health Condition &amp; Safety Risks</label>
                                <textarea class="form-control" id="editHealthNote" rows="3" maxlength="111"
                                    placeholder="Enter any allergies, medical conditions, or behavioral safety risks here..."></textarea>
                                <small class="text-muted">Optional</small>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupEditProfileModal(profileData, container) {
    const editBtn = document.getElementById('editProfileBtn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            openEditProfileModal(profileData);
        });
    }
}

function openEditProfileModal(profileData) {
    // Populate form with current data
    document.getElementById('editFirstName').value = profileData.first_name || '';
    document.getElementById('editMiddleName').value = profileData.middle_name || '';
    document.getElementById('editLastName').value = profileData.last_name || '';
    document.getElementById('editNameExtension').value = profileData.ext || '';
    document.getElementById('editNickname').value = profileData.nickname || '';
    document.getElementById('editBirthday').value = profileData.birthday || '';
    document.getElementById('editEmail').value = profileData.email || '';
    document.getElementById('editGenderId').value = profileData.gender_id || '';
    document.getElementById('editGuardianName').value = profileData.guardian_name || '';
    document.getElementById('editGuardianContact').value = profileData.guardian_contact || '';
    document.getElementById('editGuardianRelationship').value = profileData.guardian_relationship || '';
    document.getElementById('editHealthNote').value = profileData.health_note || '';
    
    // Setup profile picture preview
    const previewDiv = document.getElementById('previewProfilePicture');
    const fileInput = document.getElementById('editProfilePicture');
    
    if (profileData.profile_picture) {
        previewDiv.innerHTML = `<img src="${resolveProfilePictureUrl(profileData.profile_picture)}" alt="Profile" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
        previewDiv.innerHTML = getInitials(profileData.first_name, profileData.last_name);
    }
    
    // Handle file input change for preview
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                previewDiv.innerHTML = `<img src="${event.target.result}" alt="Preview" style="width: 100%; height: 100%; object-fit: cover;">`;
            };
            reader.readAsDataURL(file);
        }
    }, { once: false });

    // Populate gender dropdown
    const genderSelect = document.getElementById('editGenderId');
    const genders = Array.isArray(gendersList) ? gendersList : [];
    genderSelect.innerHTML = '<option value="">Select Gender</option>' + 
        genders.map(g => `<option value="${g.gender_id}">${g.gender}</option>`).join('');
    genderSelect.value = profileData.gender_id || '';

    // Setup save handler
    const saveBtn = document.getElementById('saveProfileBtn');
    if (saveBtn) {
        saveBtn.onclick = () => handleSaveProfile(profileData.student_id);
    }

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('editProfileModal'));
    modal.show();
}

function handleSaveProfile(studentId) {
    const data = {
        student_id: studentId,
        guardian_id: currentStudentData.guardian_id,
        first_name: document.getElementById('editFirstName').value,
        middle_name: document.getElementById('editMiddleName').value,
        last_name: document.getElementById('editLastName').value,
        ext: document.getElementById('editNameExtension').value.trim(),
        nickname: document.getElementById('editNickname').value,
        birthday: document.getElementById('editBirthday').value,
        gender_id: document.getElementById('editGenderId').value,
        email: document.getElementById('editEmail').value,
        guardian_name: document.getElementById('editGuardianName').value,
        guardian_contact: document.getElementById('editGuardianContact').value,
        guardian_relationship: document.getElementById('editGuardianRelationship').value,
        health_note: document.getElementById('editHealthNote').value.trim() || null
    };

    // Validation
    if (!data.first_name || !data.last_name || !data.email || !data.guardian_contact) {
        Swal.fire('Required', 'Please fill in all required fields', 'warning');
        return;
    }

    if (!isValidEmail(data.email)) {
        Swal.fire('Invalid Email', 'Please enter a valid email address', 'warning');
        return;
    }

    if (!isValidContactNumber(data.guardian_contact)) {
        Swal.fire('Invalid Contact', 'Please enter a valid contact number', 'warning');
        return;
    }

    // Handle file upload if present
    const fileInput = document.getElementById('editProfilePicture');
    const formData = new FormData();
    formData.append('operation', 'updateStudent');
    formData.append('json', JSON.stringify(data));
    
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        
        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            Swal.fire('File Too Large', 'Profile picture must be less than 5MB', 'warning');
            return;
        }
        
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
            Swal.fire('Invalid File', 'Please upload a JPG, PNG, or GIF image', 'warning');
            return;
        }
        
        formData.append('profile_picture', file);
    }

    axios.post('../../api/admin/student.php', formData, {
        headers: {
            'Content-Type': 'multipart/form-data'
        }
    })
    .then(res => {
        if (res.data.status === 'success') {
            Swal.fire('Success', 'Profile updated successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editProfileModal')).hide();
            // Reload profile
            location.reload();
        } else {
            Swal.fire('Error', res.data.message, 'error');
        }
    })
    .catch(err => {
        console.error('Error:', err);
        Swal.fire('Error', 'Network error occurred', 'error');
    });
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidContactNumber(contact) {
    return typeof contact === 'string' && /^[0-9+()\\s-]{7,20}$/.test(contact);
}

function getInitials(firstName, lastName) {
    const first = (firstName || '').charAt(0).toUpperCase();
    const last = (lastName || '').charAt(0).toUpperCase();
    return (first + last) || '?';
}

function resolveProfilePictureUrl(profilePicture) {
    if (!profilePicture) return '';
    if (/^(?:https?:)?\/\//.test(profilePicture)) {
        return profilePicture;
    }
    const cleaned = profilePicture.replace(/^\/+/, '');
    return `../../${cleaned}`;
}

function calculateAge(birthday) {
    if (!birthday) return 'N/A';

    const birthDate = new Date(birthday);
    if (Number.isNaN(birthDate.getTime())) return 'N/A';

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const birthdayThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());

    if (today < birthdayThisYear) {
        age -= 1;
    }

    return age >= 0 ? `${age} years old` : 'N/A';
}
