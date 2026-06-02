/*
=======================================================
Smart Restaurant — Staff Management Module (Firestore)
File: staff-management.js
Purpose: Full CRUD for staff with validation,
         auto-calculations, search & filter.
Data Layer: Firebase Firestore (Modular SDK)
=======================================================
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, updateDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

/* ─── FIREBASE INITIALIZATION ───────────────────────── */
// Fix Critical Error: Properly initialize Modular SDK alongside Compat SDK
const firebaseConfig = window.firebaseConfig;
const staffApp = initializeApp(firebaseConfig, "staffApp"); 
const db = getFirestore(staffApp);

/* ─── STATE ─────────────────────────────────────────── */
let staffData = [];
let staffUnsubscribe = null;
let editingStaffId = null;
let staffSearchQuery = '';
let staffFilterWorkType = '';

/* ─── HELPERS ───────────────────────────────────────── */
function getStaffRestaurantId() {
    // FIX CRITICAL ERROR: "Database not connected"
    // window.currentRestaurantId was undefined. Fetch from sessionStorage reliably.
    return window.currentRestaurantId || sessionStorage.getItem('currentRestaurant') || null;
}

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

    const isSameMonthYear = today.getMonth() === lastPaid.getMonth() && today.getFullYear() === lastPaid.getFullYear();

    if (isSameMonthYear) {
        return 'Paid';
    } else {
        if (today.getDate() >= (salaryDay || 1)) {
            return 'Pending';
        } else {
            return 'Paid';
        }
    }
}

function formatCurrency(amount) {
    return '₹' + (Number(amount) || 0).toLocaleString('en-IN');
}

/* ─── VALIDATION ────────────────────────────────────── */
function validateStaffForm(formData, isEdit = false) {
    const errors = [];

    // Name validation: Only alphabets and spaces
    if (!formData.name || !formData.name.trim()) {
        errors.push('Name is required');
    } else if (!/^[A-Za-z\s]+$/.test(formData.name.trim())) {
        errors.push('Name must contain only alphabets and spaces');
    }

    // Phone validation: Exactly 10 digits
    if (!formData.phone || !formData.phone.trim()) {
        errors.push('Phone number is required');
    } else if (!/^\d{10}$/.test(formData.phone.trim())) {
        errors.push('Enter valid 10-digit phone number');
    }

    // Staff ID validation
    if (!formData.staff_id || !formData.staff_id.trim()) {
        errors.push('Staff ID is required');
    } else if (!/^S\d+$/.test(formData.staff_id.trim())) {
        errors.push('Staff ID must start with "S" followed by numbers (e.g., S001)');
    }

    // Work type validation
    if (!formData.work_type) {
        errors.push('Work type is required');
    }

    // Age validation (Manual input >= 18)
    if (!formData.age) {
        errors.push('Age is required');
    } else {
        const age = Number(formData.age);
        if (isNaN(age) || age < 18) {
            errors.push('Staff must be at least 18 years old');
        }
    }

    // Joining date validation
    if (!formData.joining_date) {
        errors.push('Joining date is required');
    }

    // Salary validation
    if (formData.salary === undefined || formData.salary === '' || formData.salary === null) {
        errors.push('Salary is required');
    } else if (Number(formData.salary) <= 0) {
        errors.push('Salary must be a positive number');
    }

    // Salary day validation
    if (formData.salary_day) {
        const day = Number(formData.salary_day);
        if (day < 1 || day > 28 || !Number.isInteger(day)) {
            errors.push('Salary day must be between 1 and 28');
        }
    }

    return errors;
}

/* ─── STAFF ID GENERATION ───────────────────────────── */
function generateNextStaffId() {
    let maxNum = 0;
    staffData.forEach(staff => {
        const match = (staff.staff_id || '').match(/^S(\d+)$/);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) maxNum = num;
        }
    });
    const nextNum = maxNum + 1;
    return 'S' + String(nextNum).padStart(3, '0');
}

function isStaffIdUnique(staffId, excludeKey) {
    return !staffData.some(s => s.staff_id === staffId && s.id !== excludeKey);
}

/* ─── FIREBASE LISTENER ────────────────────────────── */
window.setupStaffListener = function() {
    const restaurantId = getStaffRestaurantId();
    if (!restaurantId) return;

    if (staffUnsubscribe) { staffUnsubscribe(); staffUnsubscribe = null; }

    const staffCollection = collection(db, `restaurants/${restaurantId}/staff`);
    
    staffUnsubscribe = onSnapshot(staffCollection, (snapshot) => {
        staffData = [];
        snapshot.forEach(document => {
            const val = document.data();
            staffData.push({
                ...val,
                id: document.id,
                experience: calculateExperienceDetailed(val.joining_date),
                salary_status: calculateSalaryStatus(val.salary_day, val.last_salary_paid_date)
            });
        });
        renderStaffTable();
    }, err => console.error('[Staff] Listener error:', err));
}

window.detachStaffListener = function() {
    if (staffUnsubscribe) { staffUnsubscribe(); staffUnsubscribe = null; }
    staffData = [];
}

/* ─── ADD STAFF ─────────────────────────────────────── */
window.addStaff = async function(event) {
    if (event) event.preventDefault();

    const restaurantId = getStaffRestaurantId();
    if (!restaurantId) { alert('Database not connected. Please log in again.'); return; }

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

    // Validate
    const errors = validateStaffForm(formData);
    if (errors.length > 0) {
        showStaffError(errors.join('\n'));
        return;
    }

    // Check uniqueness
    if (!isStaffIdUnique(formData.staff_id, null)) {
        showStaffError('Staff ID "' + formData.staff_id + '" already exists. Please use a unique ID.');
        return;
    }

    // Check phone uniqueness
    const phoneExists = staffData.some(s => s.phone === formData.phone && s.status !== 'inactive');
    if (phoneExists) {
        showStaffError('A staff member with this phone number already exists.');
        return;
    }

    const record = {
        staff_id:             formData.staff_id,
        name:                 formData.name,
        phone:                formData.phone,
        work_type:            formData.work_type,
        age:                  Number(formData.age),
        joining_date:         formData.joining_date,
        salary:               Number(formData.salary),
        salary_day:           Number(formData.salary_day) || 1,
        status:               'active',
        last_salary_paid_date: null,
        profile_image:        null,
        created_at:           new Date().toISOString()
    };

    try {
        const newDocRef = doc(collection(db, `restaurants/${restaurantId}/staff`));
        await setDoc(newDocRef, record);
        
        document.getElementById('addStaffForm').reset();
        clearStaffError();
        // Re-generate next ID suggestion
        setTimeout(() => {
            const idField = document.getElementById('staffId');
            if (idField) idField.value = generateNextStaffId();
        }, 500);
        showStaffSuccess('Staff member added successfully!');
    } catch (err) {
        console.error('[Staff] Add error:', err);
        showStaffError('Failed to add staff. Please try again.');
    }
}

/* ─── EDIT STAFF ────────────────────────────────────── */
window.openStaffEditModal = function(id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;

    editingStaffId = id;

    document.getElementById('editStaffId').value       = staff.staff_id || '';
    document.getElementById('editStaffName').value     = staff.name || '';
    document.getElementById('editStaffPhone').value    = staff.phone || '';
    document.getElementById('editStaffWorkType').value = staff.work_type || 'server';
    document.getElementById('editStaffAge').value      = staff.age || '';
    document.getElementById('editStaffJoiningDate').value = staff.joining_date || '';
    document.getElementById('editStaffSalary').value   = staff.salary || '';
    document.getElementById('editStaffSalaryDay').value = staff.salary_day || '1';
    document.getElementById('editStaffStatus').value   = staff.status || 'active';

    document.getElementById('staffEditModal').classList.add('active');
    clearStaffEditError();
}

window.closeStaffEditModal = function() {
    editingStaffId = null;
    document.getElementById('staffEditModal').classList.remove('active');
}

window.saveStaffEdit = async function() {
    const restaurantId = getStaffRestaurantId();
    if (!restaurantId || !editingStaffId) return;

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

    const errors = validateStaffForm(formData, true);
    if (errors.length > 0) {
        showStaffEditError(errors.join('\n'));
        return;
    }

    if (!isStaffIdUnique(formData.staff_id, editingStaffId)) {
        showStaffEditError('Staff ID "' + formData.staff_id + '" already exists.');
        return;
    }

    // Check phone uniqueness (exclude current)
    const phoneExists = staffData.some(s => s.phone === formData.phone && s.id !== editingStaffId && s.status !== 'inactive');
    if (phoneExists) {
        showStaffEditError('Another staff member already has this phone number.');
        return;
    }

    const status = document.getElementById('editStaffStatus').value || 'active';

    const updates = {
        staff_id:     formData.staff_id,
        name:         formData.name,
        phone:        formData.phone,
        work_type:    formData.work_type,
        age:          Number(formData.age),
        joining_date: formData.joining_date,
        salary:       Number(formData.salary),
        salary_day:   Number(formData.salary_day) || 1,
        status:       status,
        updated_at:   new Date().toISOString()
    };

    try {
        const docRef = doc(db, `restaurants/${restaurantId}/staff`, editingStaffId);
        await updateDoc(docRef, updates);
        window.closeStaffEditModal();
        showStaffSuccess('Staff member updated successfully!');
    } catch (err) {
        console.error('[Staff] Edit error:', err);
        showStaffEditError('Failed to update staff. Please try again.');
    }
}

/* ─── DELETE STAFF (SOFT DELETE) ────────────────────── */
window.deleteStaff = async function(id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;

    if (!confirm('Mark "' + staff.name + '" as inactive?\nThis will soft-delete the staff member.')) return;

    const restaurantId = getStaffRestaurantId();
    if (!restaurantId) return;

    try {
        const docRef = doc(db, `restaurants/${restaurantId}/staff`, id);
        await updateDoc(docRef, {
            status: 'inactive',
            updated_at: new Date().toISOString()
        });
        showStaffSuccess('"' + staff.name + '" has been marked inactive.');
    } catch (err) {
        console.error('[Staff] Delete error:', err);
        alert('Failed to update staff status. Please try again.');
    }
}

/* ─── MARK SALARY PAID ─────────────────────────────── */
window.markSalaryPaid = async function(id) {
    const restaurantId = getStaffRestaurantId();
    if (!restaurantId) return;

    try {
        const docRef = doc(db, `restaurants/${restaurantId}/staff`, id);
        await updateDoc(docRef, {
            last_salary_paid_date: new Date().toISOString(),
            salary_status: 'Paid',
            updated_at: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Staff] Salary update error:', err);
        alert('Failed to update salary status.');
    }
}

/* ─── PERMANENT DELETE STAFF ────────────────────────── */
window.permanentDeleteStaff = async function(id) {
    const staff = staffData.find(s => s.id === id);
    if (!staff) return;

    if (!confirm('Are you sure you want to PERMANENTLY delete "' + staff.name + '"? This action cannot be undone.')) return;

    const restaurantId = getStaffRestaurantId();
    if (!restaurantId) return;

    try {
        const docRef = doc(db, `restaurants/${restaurantId}/staff`, id);
        await deleteDoc(docRef);
        showStaffSuccess('"' + staff.name + '" has been permanently deleted.');
    } catch (err) {
        console.error('[Staff] Permanent delete error:', err);
        alert('Failed to delete staff member permanently. Please try again.');
    }
}

/* ─── SEARCH & FILTER ───────────────────────────────── */
window.onStaffSearch = function() {
    staffSearchQuery = (document.getElementById('staffSearchInput')?.value || '').toLowerCase();
    renderStaffTable();
}

window.onStaffFilterWorkType = function() {
    staffFilterWorkType = document.getElementById('staffFilterWorkType')?.value || '';
    renderStaffTable();
}

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

    // Update counts
    const totalEl = document.getElementById('staffTotalCount');
    const activeEl = document.getElementById('staffActiveCount');
    if (totalEl) totalEl.textContent = staffData.length;
    if (activeEl) activeEl.textContent = staffData.filter(s => s.status === 'active').length;

    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No staff found</h3><p>' +
            (staffData.length === 0 ? 'Add staff members using the form above' : 'Try adjusting your search or filters') +
            '</p></div>';
        return;
    }

    const rows = filtered.map(staff => {
        const statusClass = staff.status === 'active' ? 'staff-status-active' : 'staff-status-inactive';
        const salaryStatusClass = staff.salary_status === 'Paid' ? 'salary-status-paid' : 'salary-status-pending';
        const isInactive = staff.status === 'inactive';

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
                <button class="btn-staff-edit" onclick="openStaffEditModal('${staff.id}')" title="Edit">✏️ Edit</button>
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

/* ─── AUTO-FILL STAFF ID ON FORM LOAD ───────────────── */
window.initStaffForm = function() {
    const idField = document.getElementById('staffId');
    if (idField && !idField.value) {
        // Wait until staff data is loaded
        setTimeout(() => {
            idField.value = generateNextStaffId();
        }, 800);
    }

    // Set max date for joining date (today)
    const joinField = document.getElementById('staffJoiningDate');
    if (joinField) {
        joinField.max = new Date().toISOString().split('T')[0];
    }
}
