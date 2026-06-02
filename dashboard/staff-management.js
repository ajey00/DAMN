/*
=======================================================
Smart Restaurant — Staff Management Module
File: staff-management.js
Purpose: Full CRUD for staff with validation,
         auto-calculations, search & filter.
Data Layer: Firebase Realtime Database (Compat SDK v8)
=======================================================
*/

/* ─── HELPERS ───────────────────────────────────────── */
function getStaffDatabase() {
    // Uses the shared window.db set by firebase-config.js (compat SDK v8)
    return window.db || null;
}

function getStaffRestaurantId() {
    // window.currentRestaurantId is a local var in owner-dashboard.js (not on window),
    // so we rely on sessionStorage as the authoritative fallback — it is always
    // populated by appStorage.set('currentRestaurant', restaurantId) on login.
    return window.currentRestaurantId || sessionStorage.getItem('currentRestaurant') || null;
}

/* ─── STATE ─────────────────────────────────────────── */
let staffData = [];
let staffRef = null;
let editingStaffId = null;
let staffSearchQuery = '';
let staffFilterWorkType = '';

/* ─── AUTO-CALCULATIONS ─────────────────────────────── */
function calculateExperienceDetailed(joiningDate) {
    if (!joiningDate) return '0 years';
    const join = new Date(joiningDate);
    const today = new Date();
    let years = today.getFullYear() - join.getFullYear();
    let months = today.getMonth() - join.getMonth();
    if (today.getDate() < join.getDate()) months--;
    if (months < 0) { years--; months += 12; }
    years = Math.max(0, years);
    months = Math.max(0, months);
    if (years === 0 && months === 0) return 'New';
    if (years === 0) return months + (months === 1 ? ' month' : ' months');
    if (months === 0) return years + (years === 1 ? ' year' : ' years');
    return years + (years === 1 ? ' yr ' : ' yrs ') + months + (months === 1 ? ' mo' : ' mos');
}

function calculateSalaryStatus(salaryDay, lastSalaryPaidDate) {
    if (!lastSalaryPaidDate) return 'Pending';
    const today = new Date();
    const lastPaid = new Date(lastSalaryPaidDate);
    const isSameMonthYear =
        today.getMonth() === lastPaid.getMonth() &&
        today.getFullYear() === lastPaid.getFullYear();
    if (isSameMonthYear) return 'Paid';
    return today.getDate() >= (salaryDay || 1) ? 'Pending' : 'Paid';
}

function formatCurrency(amount) {
    return '₹' + (Number(amount) || 0).toLocaleString('en-IN');
}

/* ─── VALIDATION ────────────────────────────────────── */
function validateStaffForm(formData) {
    const errors = [];

    if (!formData.name || !formData.name.trim()) {
        errors.push('Name is required');
    } else if (!/^[A-Za-z\s]+$/.test(formData.name.trim())) {
        errors.push('Name must contain only alphabets and spaces');
    }

    if (!formData.phone || !formData.phone.trim()) {
        errors.push('Phone number is required');
    } else if (!/^\d{10}$/.test(formData.phone.trim())) {
        errors.push('Enter valid 10-digit phone number');
    }

    if (!formData.staff_id || !formData.staff_id.trim()) {
        errors.push('Staff ID is required');
    } else if (!/^S\d+$/.test(formData.staff_id.trim())) {
        errors.push('Staff ID must start with "S" followed by numbers (e.g., S001)');
    }

    if (!formData.work_type) {
        errors.push('Work type is required');
    }

    if (!formData.age) {
        errors.push('Age is required');
    } else {
        const age = Number(formData.age);
        if (isNaN(age) || age < 18) {
            errors.push('Staff must be at least 18 years old');
        }
    }

    if (!formData.joining_date) {
        errors.push('Joining date is required');
    }

    if (formData.salary === undefined || formData.salary === '' || formData.salary === null) {
        errors.push('Salary is required');
    } else if (Number(formData.salary) <= 0) {
        errors.push('Salary must be a positive number');
    }

    if (formData.salary_day) {
        const day = Number(formData.salary_day);
        if (day < 1 || day > 28 || !Number.isInteger(day)) {
            errors.push('Salary day must be between 1 and 28');
        }
    }

    return errors;
}

/* ─── STAFF ID HELPERS ──────────────────────────────── */
function generateNextStaffId() {
    let maxNum = 0;
    staffData.forEach(staff => {
        const match = (staff.staff_id || '').match(/^S(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    return 'S' + String(maxNum + 1).padStart(3, '0');
}

function isStaffIdUnique(staffId, excludeKey) {
    return !staffData.some(s => s.staff_id === staffId && s.id !== excludeKey);
}

/* ─── FIREBASE REALTIME DATABASE LISTENER ───────────── */
window.setupStaffListener = function () {
    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();
    if (!database || !restaurantId) {
        console.warn('[Staff] Database or Restaurant ID not available.');
        return;
    }

    if (staffRef) { staffRef.off(); staffRef = null; }

    // FIX: Use RTDB path  restaurants/<id>/staff  — matches the rest of the app's structure
    staffRef = database.ref('restaurants/' + restaurantId + '/staff');

    staffRef.on('value', snap => {
        staffData = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const val = child.val();
                staffData.push({
                    ...val,
                    id: child.key,
                    experience: calculateExperienceDetailed(val.joining_date),
                    salary_status: calculateSalaryStatus(val.salary_day, val.last_salary_paid_date)
                });
            });
        }
        renderStaffTable();
    }, err => console.error('[Staff] Listener error:', err));
};

window.detachStaffListener = function () {
    if (staffRef) { staffRef.off(); staffRef = null; }
    staffData = [];
};

/* ─── ADD STAFF ─────────────────────────────────────── */
window.addStaff = async function (event) {
    if (event) event.preventDefault();

    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();

    if (!database || !restaurantId) {
        alert('Database not connected. Please log in again.');
        return;
    }

    const formData = {
        staff_id:     document.getElementById('staffId').value.trim(),
        name:         document.getElementById('staffName').value.trim(),
        phone:        document.getElementById('staffPhone').value.trim(),
        work_type:    document.getElementById('staffWorkType').value,
        age:          document.getElementById('staffAge').value,
        joining_date: document.getElementById('staffJoiningDate').value,
        salary:       document.getElementById('staffSalary').value,
        salary_day:   document.getElementById('staffSalaryDay').value || '1'
    };

    const errors = validateStaffForm(formData);
    if (errors.length > 0) { showStaffError(errors.join('\n')); return; }

    if (!isStaffIdUnique(formData.staff_id, null)) {
        showStaffError('Staff ID "' + formData.staff_id + '" already exists. Please use a unique ID.');
        return;
    }

    const phoneExists = staffData.some(s => s.phone === formData.phone && s.status !== 'inactive');
    if (phoneExists) {
        showStaffError('A staff member with this phone number already exists.');
        return;
    }

    const record = {
        staff_id:              formData.staff_id,
        name:                  formData.name,
        phone:                 formData.phone,
        work_type:             formData.work_type,
        age:                   Number(formData.age),
        joining_date:          formData.joining_date,
        salary:                Number(formData.salary),
        salary_day:            Number(formData.salary_day) || 1,
        status:                'active',
        last_salary_paid_date: null,
        profile_image:         null,
        created_at:            new Date().toISOString()
    };

    try {
        // FIX: Use RTDB push() instead of Firestore setDoc()
        await database.ref('restaurants/' + restaurantId + '/staff').push(record);

        document.getElementById('addStaffForm').reset();
        clearStaffError();
        setTimeout(() => {
            const idField = document.getElementById('staffId');
            if (idField) idField.value = generateNextStaffId();
        }, 500);
        showStaffSuccess('Staff member added successfully!');
    } catch (err) {
        console.error('[Staff] Add error:', err);
        showStaffError('Failed to add staff. Please try again.');
    }
};

/* ─── EDIT STAFF ────────────────────────────────────── */
window.openStaffEditModal = function (id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;

    editingStaffId = id;

    document.getElementById('editStaffId').value          = staff.staff_id || '';
    document.getElementById('editStaffName').value        = staff.name || '';
    document.getElementById('editStaffPhone').value       = staff.phone || '';
    document.getElementById('editStaffWorkType').value    = staff.work_type || 'server';
    document.getElementById('editStaffAge').value         = staff.age || '';
    document.getElementById('editStaffJoiningDate').value = staff.joining_date || '';
    document.getElementById('editStaffSalary').value      = staff.salary || '';
    document.getElementById('editStaffSalaryDay').value   = staff.salary_day || '1';
    document.getElementById('editStaffStatus').value      = staff.status || 'active';

    document.getElementById('staffEditModal').classList.add('active');
    clearStaffEditError();
};

window.closeStaffEditModal = function () {
    editingStaffId = null;
    document.getElementById('staffEditModal').classList.remove('active');
};

window.saveStaffEdit = async function () {
    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();
    if (!database || !restaurantId || !editingStaffId) return;

    const formData = {
        staff_id:     document.getElementById('editStaffId').value.trim(),
        name:         document.getElementById('editStaffName').value.trim(),
        phone:        document.getElementById('editStaffPhone').value.trim(),
        work_type:    document.getElementById('editStaffWorkType').value,
        age:          document.getElementById('editStaffAge').value,
        joining_date: document.getElementById('editStaffJoiningDate').value,
        salary:       document.getElementById('editStaffSalary').value,
        salary_day:   document.getElementById('editStaffSalaryDay').value || '1'
    };

    const errors = validateStaffForm(formData);
    if (errors.length > 0) { showStaffEditError(errors.join('\n')); return; }

    if (!isStaffIdUnique(formData.staff_id, editingStaffId)) {
        showStaffEditError('Staff ID "' + formData.staff_id + '" already exists.');
        return;
    }

    const phoneExists = staffData.some(
        s => s.phone === formData.phone && s.id !== editingStaffId && s.status !== 'inactive'
    );
    if (phoneExists) {
        showStaffEditError('Another staff member already has this phone number.');
        return;
    }

    const updates = {
        staff_id:     formData.staff_id,
        name:         formData.name,
        phone:        formData.phone,
        work_type:    formData.work_type,
        age:          Number(formData.age),
        joining_date: formData.joining_date,
        salary:       Number(formData.salary),
        salary_day:   Number(formData.salary_day) || 1,
        status:       document.getElementById('editStaffStatus').value || 'active',
        updated_at:   new Date().toISOString()
    };

    try {
        // FIX: Use RTDB update() instead of Firestore updateDoc()
        await database.ref('restaurants/' + restaurantId + '/staff/' + editingStaffId).update(updates);
        window.closeStaffEditModal();
        showStaffSuccess('Staff member updated successfully!');
    } catch (err) {
        console.error('[Staff] Edit error:', err);
        showStaffEditError('Failed to update staff. Please try again.');
    }
};

/* ─── SOFT DELETE (DEACTIVATE) ──────────────────────── */
window.deleteStaff = async function (id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;
    if (!confirm('Mark "' + staff.name + '" as inactive?\nThis will soft-delete the staff member.')) return;

    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();
    if (!database || !restaurantId) return;

    try {
        await database.ref('restaurants/' + restaurantId + '/staff/' + id).update({
            status: 'inactive',
            updated_at: new Date().toISOString()
        });
        showStaffSuccess('"' + staff.name + '" has been marked inactive.');
    } catch (err) {
        console.error('[Staff] Deactivate error:', err);
        alert('Failed to update staff status. Please try again.');
    }
};

/* ─── MARK SALARY PAID ─────────────────────────────── */
window.markSalaryPaid = async function (id) {
    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();
    if (!database || !restaurantId) return;

    try {
        await database.ref('restaurants/' + restaurantId + '/staff/' + id).update({
            last_salary_paid_date: new Date().toISOString(),
            salary_status: 'Paid',
            updated_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Staff] Salary update error:', err);
        alert('Failed to update salary status.');
    }
};

/* ─── PERMANENT DELETE ──────────────────────────────── */
window.permanentDeleteStaff = async function (id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;
    if (!confirm('Are you sure you want to PERMANENTLY delete "' + staff.name + '"? This action cannot be undone.')) return;

    const database = getStaffDatabase();
    const restaurantId = getStaffRestaurantId();
    if (!database || !restaurantId) return;

    try {
        // FIX: Use RTDB remove() instead of Firestore deleteDoc()
        await database.ref('restaurants/' + restaurantId + '/staff/' + id).remove();
        showStaffSuccess('"' + staff.name + '" has been permanently deleted.');
    } catch (err) {
        console.error('[Staff] Permanent delete error:', err);
        alert('Failed to delete staff member permanently. Please try again.');
    }
};

/* ─── SEARCH & FILTER ───────────────────────────────── */
window.onStaffSearch = function () {
    staffSearchQuery = (document.getElementById('staffSearchInput')?.value || '').toLowerCase();
    renderStaffTable();
};

window.onStaffFilterWorkType = function () {
    staffFilterWorkType = document.getElementById('staffFilterWorkType')?.value || '';
    renderStaffTable();
};

function getFilteredStaff() {
    return staffData.filter(staff => {
        if (staffSearchQuery && !(staff.name || '').toLowerCase().includes(staffSearchQuery)) return false;
        if (staffFilterWorkType && staff.work_type !== staffFilterWorkType) return false;
        return true;
    });
}

/* ─── RENDER ────────────────────────────────────────── */
function renderStaffTable() {
    const container = document.getElementById('staff-table-container');
    if (!container) return;

    const filtered = getFilteredStaff();

    const totalEl  = document.getElementById('staffTotalCount');
    const activeEl = document.getElementById('staffActiveCount');
    if (totalEl)  totalEl.textContent  = staffData.length;
    if (activeEl) activeEl.textContent = staffData.filter(s => s.status === 'active').length;

    if (filtered.length === 0) {
        container.innerHTML =
            '<div class="empty-state"><h3>No staff found</h3><p>' +
            (staffData.length === 0
                ? 'Add staff members using the form above'
                : 'Try adjusting your search or filters') +
            '</p></div>';
        return;
    }

    const rows = filtered.map(staff => {
        const statusClass       = staff.status === 'active' ? 'staff-status-active' : 'staff-status-inactive';
        const salaryStatusClass = staff.salary_status === 'Paid' ? 'salary-status-paid' : 'salary-status-pending';
        const isInactive        = staff.status === 'inactive';

        return `
        <tr class="${isInactive ? 'staff-row-inactive' : ''}">
            <td>${staff.name || '-'}</td>
            <td>${staff.phone || '-'}</td>
            <td>${(staff.work_type || '-').charAt(0).toUpperCase() + (staff.work_type || '').slice(1)}</td>
            <td>${staff.age || '-'}</td>
            <td>${formatCurrency(staff.salary)}</td>
            <td>${staff.salary_day || '-'}</td>
            <td><span class="${salaryStatusClass}">${staff.salary_status || '-'}</span></td>
            <td class="staff-actions-cell" style="display:flex; gap:6px;">
                <button class="btn-staff-edit"   onclick="openStaffEditModal('${staff.id}')"    title="Edit">✏️ Edit</button>
                ${staff.salary_status === 'Pending' ? `<button class="btn-staff-pay" onclick="markSalaryPaid('${staff.id}')" title="Mark Salary Paid">💰 Paid</button>` : ''}
                ${staff.status === 'active' ? `<button class="btn-staff-delete" onclick="deleteStaff('${staff.id}')" title="Deactivate">🛑 Deactivate</button>` : ''}
                <button class="btn-staff-delete" style="background:#dc3545;" onclick="permanentDeleteStaff('${staff.id}')" title="Permanently Delete">🗑️ Delete</button>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
    <table class="staff-table">
        <thead>
            <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Work Type</th>
                <th>Age</th>
                <th>Salary</th>
                <th>Salary Day</th>
                <th>Salary Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/* ─── UI FEEDBACK ───────────────────────────────────── */
function showStaffError(msg) {
    const el = document.getElementById('staffFormError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearStaffError() {
    const el = document.getElementById('staffFormError');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function showStaffEditError(msg) {
    const el = document.getElementById('staffEditError');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearStaffEditError() {
    const el = document.getElementById('staffEditError');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
}

function showStaffSuccess(msg) {
    const el = document.getElementById('staffSuccessMsg');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
}

/* ─── FORM INIT ─────────────────────────────────────── */
window.initStaffForm = function () {
    const idField = document.getElementById('staffId');
    if (idField && !idField.value) {
        setTimeout(() => { idField.value = generateNextStaffId(); }, 800);
    }

    const joinField = document.getElementById('staffJoiningDate');
    if (joinField) {
        joinField.max = new Date().toISOString().split('T')[0];
    }
};
