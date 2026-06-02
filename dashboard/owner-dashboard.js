/*
=======================================================
Smart Restaurant QR-Based Ordering System
File: owner-dashboard.js
Purpose: Restaurant owner dashboard — auth, menu, orders,
         billing, tables, reviews, QR generation.
Data Layer: Firebase Realtime Database
Session Only (sessionStorage): currentOwner, currentRestaurantId,
                              OTP verification codes (ephemeral)
=======================================================
*/

/* ─── STATE ─────────────────────────────────────────── */
let currentOwnerId      = null;
let currentRestaurantId = null;
let menuItems           = [];
let orders              = [];   // kept in sync by Firebase listener
let feedbacks           = [];   // kept in sync by Firebase listener
let tablesData          = {};   // Firebase-backed table data
let editingItemId       = null;
let changingImageItemId = null;
let pendingSignupData   = null;
let pendingLoginOwner   = null;
let pendingResetOwnerId = null;
let pendingResetEmail   = null;
let ordersRef           = null;
let menuRef             = null;
let feedbackRef         = null;
let tablesRef           = null;
const CODE_EXPIRY_MS    = 5 * 60 * 1000; // 5 minutes

const DEFAULT_IMAGE = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dy=".3em"%3ENo Image%3C/text%3E%3C/svg%3E';

const DEBUG = true;
function debugLog(...args) {
    if (DEBUG) console.log(...args);
}

function getDatabase() {
    return window.db || null;
}

const appStorage = (() => {
    const memory = {};
    const getStore = () => {
        try { return window.sessionStorage; } catch (e) { return null; }
    };
    return {
        get(key) {
            const store = getStore();
            return store ? store.getItem(key) : (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null);
        },
        set(key, value) {
            const store = getStore();
            if (store) store.setItem(key, value);
            else memory[key] = String(value);
        },
        remove(key) {
            const store = getStore();
            if (store) store.removeItem(key);
            else delete memory[key];
        }
    };
})();

const AUTH_PANEL_IDS = [
    'signupForm','signupVerificationForm',
    'loginForm','loginVerificationForm',
    'forgotPasswordForm','resetVerificationForm','resetPasswordForm'
];

const COUNTRY_PHONE_DATA = [
    { flag: '\uD83C\uDDEE\uD83C\uDDF3', name: 'India',                code: '+91'  },
    { flag: '\uD83C\uDDFA\uD83C\uDDF8', name: 'United States',        code: '+1'   },
    { flag: '\uD83C\uDDEC\uD83C\uDDE7', name: 'United Kingdom',       code: '+44'  },
    { flag: '\uD83C\uDDE6\uD83C\uDDEA', name: 'United Arab Emirates', code: '+971' },
    { flag: '\uD83C\uDDE8\uD83C\uDDE6', name: 'Canada',               code: '+1'   },
    { flag: '\uD83C\uDDE6\uD83C\uDDFA', name: 'Australia',            code: '+61'  },
    { flag: '\uD83C\uDDF8\uD83C\uDDEC', name: 'Singapore',            code: '+65'  },
    { flag: '\uD83C\uDDE9\uD83C\uDDEA', name: 'Germany',              code: '+49'  },
    { flag: '\uD83C\uDDEB\uD83C\uDDF7', name: 'France',               code: '+33'  },
    { flag: '\uD83C\uDDEF\uD83C\uDDF5', name: 'Japan',                code: '+81'  }
];

/* ─── AUTH PANEL HELPERS ────────────────────────────── */
function showAuthPanel(panelId) {
    AUTH_PANEL_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === panelId) ? 'block' : 'none';
    });
}

function showSignup()          { pendingSignupData = null; showAuthPanel('signupForm');         clearAllAuthMessages(); }
function showLogin()           { pendingLoginOwner = null; pendingResetOwnerId = null; pendingResetEmail = null; showAuthPanel('loginForm'); clearAllAuthMessages(); }
function showForgotPassword()  { showAuthPanel('forgotPasswordForm'); clearAllAuthMessages(); }

function clearAllAuthMessages() {
    ['signupError','signupVerificationError','loginError','loginVerificationError',
     'forgotPasswordError','resetVerificationError','resetPasswordError'].forEach(clearError);
    ['signupCodeInfo','loginCodeInfo','resetCodeInfo'].forEach(clearInfo);
}

function showError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('show'); }
}
function clearError(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.remove('show'); }
}
function showInfo(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.classList.add('show'); }
}
function clearInfo(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.remove('show'); }
}

/* ─── VALIDATION HELPERS ────────────────────────────── */
function isValidEmail(email)  { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email); }
function normalizePhone(p)    { return String(p || '').replace(/\D/g, ''); }

function isValidPhone(phone, code) {
    return code === '+91' ? /^\d{10}$/.test(phone) : /^\d{6,15}$/.test(phone);
}

function passwordError(pw) {
    if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw))
        return 'Password must be at least 8 characters with uppercase, lowercase, number, and special character.';
    return '';
}

function encodePassword(password) {
    try {
        return btoa(unescape(encodeURIComponent(password)));
    } catch (error) {
        return btoa(password);
    }
}

function decodePassword(password) {
    try {
        return decodeURIComponent(escape(atob(password)));
    } catch (error) {
        try {
            return atob(password);
        } catch (fallbackError) {
            return String(password || '');
        }
    }
}

function generateRestaurantId(name) {
    const base = String(name || 'restaurant')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'restaurant';
    return base + '-' + Date.now().toString(36);
}

/* ─── OTP (temp codes stored in sessionStorage — ephemeral) ─── */
function generateCode()   { return String(Math.floor(100000 + Math.random() * 900000)); }

function setCode(key, expKey, code) {
    appStorage.set(key, code);
    appStorage.set(expKey, String(Date.now() + CODE_EXPIRY_MS));
}

function validateCode(key, expKey, entered) {
    const stored = appStorage.get(key);
    const expiry = Number(appStorage.get(expKey));
    if (!stored || !expiry || isNaN(expiry)) return { ok: false, reason: 'Code not found. Please request a new code.' };
    if (Date.now() >= expiry)               return { ok: false, reason: 'Code expired. Please request a new code.' };
    if (String(entered) !== String(stored)) return { ok: false, reason: 'Incorrect code. Please try again.' };
    return { ok: true, reason: '' };
}

function clearCode(key, expKey) { appStorage.remove(key); appStorage.remove(expKey); }

function samePhoneNumber(phone, countryCode, restaurant) {
    const inputLocal = normalizePhone(phone);
    const inputFull  = normalizePhone(countryCode) + inputLocal;
    const storedLocal = normalizePhone(restaurant?.phone);
    const storedFull  = normalizePhone(restaurant?.countryCode) + storedLocal;

    return Boolean(
        inputLocal &&
        storedLocal &&
        (
            inputLocal === storedLocal ||
            inputFull === storedFull ||
            inputFull === storedLocal ||
            storedFull === inputLocal
        )
    );
}

function matchesPhoneIdentifier(identifier, restaurant) {
    const inputDigits = normalizePhone(identifier);
    const storedLocal = normalizePhone(restaurant?.phone);
    const storedFull  = normalizePhone(restaurant?.countryCode) + storedLocal;

    return Boolean(
        inputDigits &&
        storedLocal &&
        (
            inputDigits === storedLocal ||
            inputDigits === storedFull ||
            inputDigits.endsWith(storedLocal)
        )
    );
}

function findRestaurantByIdentifier(restaurantsValue, identifier) {
    const normalizedEmail = String(identifier || '').trim().toLowerCase();

    for (const [id, restaurant] of Object.entries(restaurantsValue || {})) {
        if ((restaurant?.email || '').toLowerCase() === normalizedEmail || matchesPhoneIdentifier(identifier, restaurant)) {
            return { ...restaurant, id };
        }
    }

    return null;
}

function findRestaurantByEmailAndPhone(restaurantsValue, email, phone, countryCode) {
    for (const [id, restaurant] of Object.entries(restaurantsValue || {})) {
        if ((restaurant?.email || '').toLowerCase() === email.toLowerCase() && samePhoneNumber(phone, countryCode, restaurant)) {
            return { ...restaurant, id };
        }
    }

    return null;
}

function detachRestaurantListeners() {
    if (ordersRef) {
        ordersRef.off();
        ordersRef = null;
    }
    if (menuRef) {
        menuRef.off();
        menuRef = null;
    }
    if (feedbackRef) {
        feedbackRef.off();
        feedbackRef = null;
    }
    if (tablesRef) {
        tablesRef.off();
        tablesRef = null;
    }
    if (analyticsRef) {
        analyticsRef.off();
        analyticsRef = null;
    }
    // Detach staff & order history listeners (from separate modules)
    if (typeof detachStaffListener === 'function') detachStaffListener();
    if (typeof detachOrderHistoryListener === 'function') detachOrderHistoryListener();
}

function extractTableNumber(value) {
    const digits = normalizePhone(value);
    return digits ? String(parseInt(digits, 10)) : '';
}

function getOrderTotals(order) {
    const subtotal = (order.items || []).reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0);
    const tax = Math.round(subtotal * 0.05);
    const total = Number(order.total) || (subtotal + tax);
    return { subtotal, tax, total };
}

function normalizeOrderRecord(order, id) {
    const safeItems = Array.isArray(order?.items)
        ? order.items
            .filter(item => item && item.name)
            .map(item => ({
                id: item.id ?? null,
                name: item.name,
                price: Number(item.price) || 0,
                quantity: Number(item.quantity) || 1
            }))
        : [];

    return {
        ...order,
        id,
        items: safeItems,
        tableNumber: extractTableNumber(order?.tableNumber),
        total: Number(order?.total) || getOrderTotals({ items: safeItems }).total,
        status: ['pending', 'confirmed', 'delivered', 'paid'].includes(order?.status) ? order.status : 'pending',
        createdAt: order?.createdAt || new Date().toISOString(),
        updatedAt: order?.updatedAt || order?.createdAt || new Date().toISOString()
    };
}

function normalizeFeedbackRecord(feedback, id) {
    return {
        ...feedback,
        id,
        rating: Number(feedback?.rating) || 0,
        message: feedback?.message || feedback?.text || '',
        name: feedback?.name || 'Anonymous',
        tableNumber: feedback?.tableNumber || '',
        orderId: feedback?.orderId || '',
        createdAt: feedback?.createdAt || new Date().toISOString()
    };
}

/* ─── SIGNUP FLOW ───────────────────────────────────── */
function handleSignup(event) {
    event.preventDefault();
    clearError('signupError');
    clearInfo('signupCodeInfo');

    const database = getDatabase();
    const name        = document.getElementById('restaurantName').value.trim();
    const email       = document.getElementById('ownerEmail').value.trim().toLowerCase();
    const countryCode = document.getElementById('ownerCountryCode').value;
    const phone       = normalizePhone(document.getElementById('ownerPhoneNumber').value);
    const password    = document.getElementById('ownerPassword').value.trim();

    debugLog('[Auth] Signup attempt', { email, countryCode, phoneDigits: phone.length });

    if (!database)                              { showError('signupError', 'Database connection is not ready. Please refresh the page.'); return; }
    if (!name || !email || !phone || !password) { showError('signupError', 'All fields are required.'); return; }
    if (!isValidEmail(email))                    { showError('signupError', 'Please enter a valid email.'); return; }
    if (!isValidPhone(phone, countryCode))       { showError('signupError', 'Please enter a valid phone number.'); return; }
    const pwErr = passwordError(password);
    if (pwErr) { showError('signupError', pwErr); return; }

    database.ref('restaurants').once('value').then(snap => {
        const restaurantsValue = snap.val() || {};
        const duplicateEmail = Object.values(restaurantsValue).some(restaurant => (restaurant?.email || '').toLowerCase() === email);
        const duplicatePhone = Object.values(restaurantsValue).some(restaurant => samePhoneNumber(phone, countryCode, restaurant));

        if (duplicateEmail) { showError('signupError', 'This email is already registered. Please login.'); return; }
        if (duplicatePhone) { showError('signupError', 'This phone number is already registered. Please login.'); return; }

        pendingSignupData = { restaurantId: generateRestaurantId(name), name, email, phone, countryCode, password };
        const code    = generateCode();
        setCode('signupCode_' + email, 'signupCodeExp_' + email, code);
        showAuthPanel('signupVerificationForm');
        document.getElementById('signupVerificationCode').value = '';
        showInfo('signupCodeInfo', 'Verification code: ' + code + ' (valid 5 minutes)');
        clearError('signupVerificationError');
    }).catch(err => {
        showError('signupError', 'Connection error. Please check your internet and try again.');
        console.error(err);
    });
}

function verifySignupCode(event) {
    event.preventDefault();
    clearError('signupVerificationError');

    const database = getDatabase();
    if (!database) { showError('signupVerificationError', 'Database connection is not ready. Please refresh the page.'); return; }
    if (!pendingSignupData) { showError('signupVerificationError', 'Session expired. Please start again.'); showSignup(); return; }

    const entered = document.getElementById('signupVerificationCode').value.replace(/\D/g,'');
    if (!/^\d{6}$/.test(entered)) { showError('signupVerificationError', 'Please enter a valid 6-digit code.'); return; }

    const result = validateCode('signupCode_' + pendingSignupData.email, 'signupCodeExp_' + pendingSignupData.email, entered);
    if (!result.ok) { showError('signupVerificationError', result.reason); return; }

    clearCode('signupCode_' + pendingSignupData.email, 'signupCodeExp_' + pendingSignupData.email);

    const restaurantId = pendingSignupData.restaurantId || generateRestaurantId(pendingSignupData.name);
    const record = {
        restaurantId:   restaurantId,
        name:           pendingSignupData.name,
        email:          pendingSignupData.email,
        phone:          pendingSignupData.phone,
        countryCode:    pendingSignupData.countryCode,
        password:       encodePassword(pendingSignupData.password),
        createdAt:      new Date().toISOString()
    };

    const defaultMenuItems = typeof DEFAULT_MENU !== 'undefined' ? normalizeMenuItems(DEFAULT_MENU) : [];
    const writes = [database.ref('restaurants/' + restaurantId).set(record)];
    if (defaultMenuItems.length > 0) {
        writes.push(database.ref('menus/' + restaurantId + '/items').set(defaultMenuItems));
    }

    Promise.all(writes).then(() => {
        appStorage.set('currentOwner',      restaurantId);
        appStorage.set('currentRestaurant', restaurantId);
        currentOwnerId      = restaurantId;
        currentRestaurantId = restaurantId;
        pendingSignupData   = null;
        document.getElementById('signupVerificationCode').value = '';
        debugLog('[Auth] Signup complete for', restaurantId);
        openDashboard();
    }).catch(err => {
        showError('signupVerificationError', 'Failed to create account. Please try again.');
        console.error(err);
    });
}

function resendSignupCode() {
    clearError('signupVerificationError');
    if (!pendingSignupData) { showError('signupVerificationError', 'Session expired.'); showSignup(); return; }
    const code = generateCode();
    setCode('signupCode_' + pendingSignupData.email, 'signupCodeExp_' + pendingSignupData.email, code);
    document.getElementById('signupVerificationCode').value = '';
    showInfo('signupCodeInfo', 'Verification code: ' + code + ' (valid 5 minutes)');
}

function backToSignupFromVerification() { pendingSignupData = null; showSignup(); }

/* ─── LOGIN FLOW ────────────────────────────────────── */
function handleLogin(event) {
    event.preventDefault();
    clearError('loginError');
    clearInfo('loginCodeInfo');

    const database = getDatabase();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password   = document.getElementById('loginPassword').value.trim();

    if (!database) { showError('loginError', 'Database connection is not ready. Please refresh the page.'); return; }
    if (!identifier || !password) { showError('loginError', 'Please fill in all fields.'); return; }

    debugLog('[Auth] Login attempt', { identifier: identifier.toLowerCase() || normalizePhone(identifier) });

    database.ref('restaurants').once('value').then(snap => {
        const matched = findRestaurantByIdentifier(snap.val(), identifier);

        if (!matched) { showError('loginError', 'Account not found. Please check your email or phone.'); return; }

        const storedPw = decodePassword(matched.password);
        if (storedPw !== password) { showError('loginError', 'Incorrect password.'); return; }

        const restaurantId = matched.restaurantId || matched.id;
        if (!restaurantId) { showError('loginError', 'Account data is incomplete. Please contact support.'); return; }
        pendingLoginOwner = { ...matched, restaurantId };
        const code = generateCode();
        setCode('loginCode_' + restaurantId, 'loginCodeExp_' + restaurantId, code);
        showAuthPanel('loginVerificationForm');
        document.getElementById('loginVerificationCode').value = '';
        showInfo('loginCodeInfo', 'Login code: ' + code + ' (valid 5 minutes)');
        clearError('loginVerificationError');
    }).catch(err => {
        showError('loginError', 'Connection error. Please try again.');
        console.error(err);
    });
}

function verifyLoginCode(event) {
    event.preventDefault();
    clearError('loginVerificationError');

    if (!pendingLoginOwner) { showError('loginVerificationError', 'Session expired.'); showLogin(); return; }

    const entered = document.getElementById('loginVerificationCode').value.replace(/\D/g,'');
    if (!/^\d{6}$/.test(entered)) { showError('loginVerificationError', 'Please enter a valid 6-digit code.'); return; }

    const restaurantId = pendingLoginOwner.restaurantId || pendingLoginOwner.id;
    const result = validateCode('loginCode_' + restaurantId, 'loginCodeExp_' + restaurantId, entered);
    if (!result.ok) { showError('loginVerificationError', result.reason); return; }

    clearCode('loginCode_' + restaurantId, 'loginCodeExp_' + restaurantId);

    appStorage.set('currentOwner',      restaurantId);
    appStorage.set('currentRestaurant', restaurantId);
    currentOwnerId      = restaurantId;
    currentRestaurantId = restaurantId;
    pendingLoginOwner   = null;
    document.getElementById('loginVerificationCode').value = '';
    debugLog('[Auth] Login verified for', restaurantId);
    openDashboard();
}

function resendLoginCode() {
    clearError('loginVerificationError');
    if (!pendingLoginOwner) { showError('loginVerificationError', 'Session expired.'); showLogin(); return; }
    const code = generateCode();
    const restaurantId = pendingLoginOwner.restaurantId || pendingLoginOwner.id;
    setCode('loginCode_' + restaurantId, 'loginCodeExp_' + restaurantId, code);
    document.getElementById('loginVerificationCode').value = '';
    showInfo('loginCodeInfo', 'Login code: ' + code + ' (valid 5 minutes)');
}

function backToLoginFromVerification() { pendingLoginOwner = null; showLogin(); }

/* ─── FORGOT PASSWORD FLOW ──────────────────────────── */
function handleForgotPassword(event) {
    event.preventDefault();
    clearError('forgotPasswordError');
    clearInfo('resetCodeInfo');

    const database    = getDatabase();
    const email       = document.getElementById('forgotEmail').value.trim().toLowerCase();
    const countryCode = document.getElementById('forgotCountryCode').value;
    const phone       = normalizePhone(document.getElementById('forgotPhoneNumber').value);

    if (!database) { showError('forgotPasswordError', 'Database connection is not ready. Please refresh the page.'); return; }
    if (!email || !phone) { showError('forgotPasswordError', 'Please enter your registered email and phone number.'); return; }
    if (!isValidEmail(email)) { showError('forgotPasswordError', 'Please enter a valid email address.'); return; }
    if (!isValidPhone(phone, countryCode)) { showError('forgotPasswordError', 'Please enter a valid phone number.'); return; }

    debugLog('[Auth] Password reset requested', { email });

    database.ref('restaurants').once('value').then(snap => {
        const matched = findRestaurantByEmailAndPhone(snap.val(), email, phone, countryCode);

        if (!matched) { showError('forgotPasswordError', 'No account matches the provided email and phone number.'); return; }

        const restaurantId = matched.restaurantId || matched.id;
        pendingResetOwnerId = restaurantId;
        pendingResetEmail   = matched.email || email;

        const code = generateCode();
        setCode('resetCode_' + pendingResetEmail, 'resetCodeExp_' + pendingResetEmail, code);
        showAuthPanel('resetVerificationForm');
        document.getElementById('resetVerificationCode').value = '';
        showInfo('resetCodeInfo', 'Reset code: ' + code + ' (valid 5 minutes)');
        clearError('resetVerificationError');
    }).catch(err => {
        showError('forgotPasswordError', 'Connection error. Please try again.');
        console.error(err);
    });
}

function verifyResetCode(event) {
    event.preventDefault();
    clearError('resetVerificationError');

    if (!pendingResetEmail || !pendingResetOwnerId) { showError('resetVerificationError', 'Session expired.'); showForgotPassword(); return; }

    const entered = document.getElementById('resetVerificationCode').value.replace(/\D/g,'');
    if (!/^\d{6}$/.test(entered)) { showError('resetVerificationError', 'Please enter a valid 6-digit code.'); return; }

    const result = validateCode('resetCode_' + pendingResetEmail, 'resetCodeExp_' + pendingResetEmail, entered);
    if (!result.ok) { showError('resetVerificationError', result.reason); return; }

    clearCode('resetCode_' + pendingResetEmail, 'resetCodeExp_' + pendingResetEmail);
    document.getElementById('resetVerificationCode').value = '';
    showAuthPanel('resetPasswordForm');
    clearError('resetPasswordError');
}

function resendResetCode() {
    clearError('resetVerificationError');
    if (!pendingResetEmail) { showError('resetVerificationError', 'Session expired.'); showForgotPassword(); return; }
    const code = generateCode();
    setCode('resetCode_' + pendingResetEmail, 'resetCodeExp_' + pendingResetEmail, code);
    document.getElementById('resetVerificationCode').value = '';
    showInfo('resetCodeInfo', 'Reset code: ' + code + ' (valid 5 minutes)');
}

function completePasswordReset(event) {
    event.preventDefault();
    clearError('resetPasswordError');

    const database = getDatabase();
    if (!pendingResetOwnerId) { showError('resetPasswordError', 'Session expired.'); showForgotPassword(); return; }
    if (!database) { showError('resetPasswordError', 'Database connection is not ready. Please refresh the page.'); return; }

    const newPw  = document.getElementById('resetNewPassword').value.trim();
    const confPw = document.getElementById('resetConfirmPassword').value.trim();

    if (!newPw || !confPw)  { showError('resetPasswordError', 'Please fill both fields.'); return; }
    if (newPw !== confPw)   { showError('resetPasswordError', 'Passwords do not match.'); return; }
    const pwErr = passwordError(newPw);
    if (pwErr) { showError('resetPasswordError', pwErr); return; }

    database.ref('restaurants/' + pendingResetOwnerId).update({ password: encodePassword(newPw) }).then(() => {
        pendingResetOwnerId = null;
        pendingResetEmail   = null;
        document.getElementById('resetNewPassword').value    = '';
        document.getElementById('resetConfirmPassword').value = '';
        alert('Password reset successful. Please login with your new password.');
        showLogin();
    }).catch(err => {
        showError('resetPasswordError', 'Failed to reset password. Please try again.');
        console.error(err);
    });
}

/* ─── LOGOUT ────────────────────────────────────────── */
function handleLogout() {
    if (!confirm('Are you sure you want to logout?')) return;
    debugLog('[Auth] Logout');

    detachRestaurantListeners();

    appStorage.remove('currentOwner');
    appStorage.remove('currentRestaurant');
    currentOwnerId      = null;
    currentRestaurantId = null;
    pendingSignupData   = null;
    pendingLoginOwner   = null;
    pendingResetOwnerId = null;
    pendingResetEmail   = null;
    orders              = [];
    menuItems           = [];
    feedbacks           = [];

    document.getElementById('dashboard').style.display   = 'none';
    document.getElementById('ownerAuth').style.display   = 'flex';
    document.getElementById('loginIdentifier').value     = '';
    document.getElementById('loginPassword').value       = '';
    // Reset staff data from module
    if (typeof detachStaffListener === 'function') detachStaffListener();
    if (typeof detachOrderHistoryListener === 'function') detachOrderHistoryListener();
    showLogin();
}

/* ─── DASHBOARD OPEN / INIT ─────────────────────────── */
function openDashboard() {
    document.getElementById('ownerAuth').style.display   = 'none';
    document.getElementById('dashboard').style.display   = 'block';
    loadRestaurantHeader();
    loadSettingsForm();
    prefillQrBaseUrl();
    initializeDashboard();
    loadAnalytics();
    // Initialize new modules
    if (typeof setupStaffListener === 'function') setupStaffListener();
    if (typeof setupOrderHistoryListener === 'function') setupOrderHistoryListener();
    if (typeof initStaffForm === 'function') initStaffForm();
    switchTab('orders'); // start on Orders tab
}

function loadRestaurantHeader() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;
    database.ref('restaurants/' + currentRestaurantId).once('value').then(snap => {
        if (snap.exists()) {
            const name = snap.val().name || 'Restaurant';
            document.getElementById('restaurantHeader').textContent = name + ' Dashboard';
        }
    });
}

/**
 * Sets up real-time Firebase listeners for orders, menu, and feedbacks.
 * These listeners keep the dashboard in sync automatically.
 */
function initializeDashboard() {
    if (!currentRestaurantId) {
        console.warn('[Dashboard] Missing restaurantId; cannot initialize listeners.');
        return;
    }
    detachRestaurantListeners();
    setupOrdersListener();
    setupMenuListener();
    setupFeedbackListener();
    setupTablesListener();
}

/* ─── ORDERS — FIREBASE REAL-TIME ───────────────────── */
/**
 * Listens to orders/{restaurantId} in real-time.
 * Rebuilds orders array and re-renders all order-dependent UI
 * (orders, tables, billing) every time any order changes.
 */
function setupOrdersListener() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    debugLog('[Orders] Listener attached for', currentRestaurantId);
    ordersRef = database.ref('orders/' + currentRestaurantId);
    ordersRef.on('value', snap => {
        orders = [];
        if (snap.exists()) {
            snap.forEach(child => {
                orders.push(normalizeOrderRecord(child.val(), child.key));
            });
            orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        renderOrders();
        renderTables();
        renderBilling();
    }, err => console.error('Orders listener error:', err));
}

function updateOrderStatus(orderId, newStatus) {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;
    debugLog('[Orders] Updating status', { orderId, newStatus });
    const updates = { status: newStatus, updatedAt: new Date().toISOString() };
    if (newStatus === 'paid') updates.paidAt = new Date().toISOString();
    database.ref('orders/' + currentRestaurantId + '/' + orderId)
      .update(updates)
      .then(() => {
          // Auto-free the table when order is marked as paid
          if (newStatus === 'paid') {
              const order = orders.find(o => o.id === orderId);
              if (order && order.tableNumber) {
                  markTableFree(extractTableNumber(order.tableNumber));
              }
          }
      })
      .catch(err => { alert('Failed to update order status. Please try again.'); console.error(err); });
}

function confirmOrderItem(orderId)  { updateOrderStatus(orderId, 'confirmed'); }
function deliverOrderItem(orderId)  { updateOrderStatus(orderId, 'delivered'); }
function markAsPaid(orderId)        { updateOrderStatus(orderId, 'paid'); }

function renderOrders() {
    const container = document.getElementById('orders-container');
    if (!container) return;

    // 24-hour frontend filter — orders remain in Firebase
    const now = new Date();
    const recentOrders = orders.filter(order => {
        const orderTime = new Date(order.createdAt || Date.now());
        const diffHours = (now - orderTime) / (1000 * 60 * 60);
        return diffHours <= 24;
    });

    if (recentOrders.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No recent orders</h3><p>No orders in the last 24 hours</p></div>';
        return;
    }

    container.innerHTML = recentOrders.map(order => {
        const statusClass = 'status-' + (order.status || 'pending');
        const statusLabel = (order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1);
        const tableLabel = extractTableNumber(order.tableNumber) || '-';
        const createdAt = new Date(order.createdAt || Date.now());
        return `
        <div class="order-card">
            <div class="order-header">
                <span class="order-id">${order.id ? order.id.slice(-8).toUpperCase() : 'ORDER'}</span>
                <span class="table-badge">Table ${tableLabel}</span>
            </div>
            <div class="order-items">
                ${(order.items || []).map(i => `
                    <div class="order-item">
                        <strong>${i.name}</strong> &times; ${i.quantity} = &#8377;${i.price * i.quantity}
                    </div>`).join('')}
            </div>
            ${order.note ? `<p style="font-size:13px;color:#888;margin:8px 0;">Note: ${order.note}</p>` : ''}
            <div class="order-time">${createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            <span class="status-badge ${statusClass}">${statusLabel}</span>
            <div class="order-actions">
                <button class="btn btn-confirm"
                        onclick="confirmOrderItem('${order.id}')"
                        ${order.status !== 'pending' ? 'disabled' : ''}>
                    Confirm
                </button>
                <button class="btn btn-deliver"
                        onclick="deliverOrderItem('${order.id}')"
                        ${order.status !== 'confirmed' ? 'disabled' : ''}>
                    Deliver
                </button>
            </div>
        </div>`;
    }).join('');
}

/* ─── TABLES — FIREBASE-BACKED CRUD ─────────────────── */
/**
 * Tables are stored in Firebase under tables/{restaurantId}.
 * Status is derived from live orders:
 *   occupied  = any pending/confirmed order
 *   delivered = delivered but unpaid orders
 *   free      = no unpaid orders
 * Owners can add/delete tables via the UI.
 */
function setupTablesListener() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    debugLog('[Tables] Listener attached for', currentRestaurantId);
    tablesRef = database.ref('tables/' + currentRestaurantId);
    tablesRef.on('value', snap => {
        if (snap.exists()) {
            tablesData = snap.val() || {};
        } else {
            // Auto-seed tables 1-10 on first load
            tablesData = {};
            for (let i = 1; i <= 10; i++) {
                tablesData[i] = { status: 'free' };
            }
            database.ref('tables/' + currentRestaurantId).set(tablesData)
                .catch(err => console.error('Failed to seed default tables:', err));
        }
        renderTables();
    }, err => console.error('Tables listener error:', err));
}

function addTable() {
    const input = document.getElementById('newTableNumber');
    const tableNumber = (input ? input.value.trim() : '').replace(/\D/g, '');

    if (!tableNumber) {
        alert('Please enter a valid table number');
        return;
    }

    if (tablesData[tableNumber]) {
        alert('Table ' + tableNumber + ' already exists');
        return;
    }

    const database = getDatabase();
    if (!database || !currentRestaurantId) {
        alert('Database not connected');
        return;
    }

    database.ref('tables/' + currentRestaurantId + '/' + tableNumber)
        .set({ status: 'free' })
        .then(() => {
            if (input) input.value = '';
            debugLog('[Tables] Added table', tableNumber);
        })
        .catch(err => {
            console.error('Failed to add table:', err);
            alert('Failed to add table. Please try again.');
        });
}

function deleteTable(tableNumber) {
    if (!confirm('Delete Table ' + tableNumber + '?')) return;

    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    database.ref('tables/' + currentRestaurantId + '/' + tableNumber)
        .remove()
        .then(() => debugLog('[Tables] Deleted table', tableNumber))
        .catch(err => {
            console.error('Failed to delete table:', err);
            alert('Failed to delete table. Please try again.');
        });
}

function markTableFree(tableNumber) {
    if (!tableNumber) return;
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    database.ref('tables/' + currentRestaurantId + '/' + tableNumber)
        .update({ status: 'free' })
        .catch(err => console.error('Failed to update table status:', err));
}

function renderTables() {
    const container = document.getElementById('tables-container');
    if (!container) return;

    // Derive status from recent orders only (same 24-hour window as renderOrders)
    // Without this filter, old orders that were never marked 'paid' would
    // permanently show their table as occupied — this was the root cause of
    // Table 2 and Table 5 being stuck as "occupied".
    const now = new Date();
    const orderDerivedStatus = {};
    orders.forEach(order => {
        const t = extractTableNumber(order.tableNumber);
        if (!t) return;

        const status = order.status || 'pending';
        if (status === 'paid') return;

        // Skip orders older than 24 hours — they are no longer active
        const orderTime = new Date(order.createdAt || 0);
        const diffHours = (now - orderTime) / (1000 * 60 * 60);
        if (diffHours > 24) return;

        if (status === 'delivered') {
            if (orderDerivedStatus[t] !== 'occupied') orderDerivedStatus[t] = 'delivered';
            return;
        }

        orderDerivedStatus[t] = 'occupied';
    });

    // Merge Firebase tables with order-derived status
    const tableNumbers = Object.keys(tablesData).sort((a, b) => Number(a) - Number(b));

    if (tableNumbers.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No tables</h3><p>Add tables using the form above</p></div>';
        return;
    }

    container.innerHTML = tableNumbers.map(num => {
        const status = orderDerivedStatus[num] || 'free';
        return `
        <div class="table-card ${status}">
            <div class="table-number">Table ${num}</div>
            <span class="table-status ${status}">
                ${status === 'free' ? 'Free' : status === 'occupied' ? 'Occupied' : 'Delivered'}
            </span>
            <button class="btn-delete-table" onclick="deleteTable('${num}')" title="Delete Table ${num}">&#128465;</button>
        </div>`;
    }).join('');
}

/* ─── BILLING ────────────────────────────────────────── */
/**
 * Bill status comes directly from order.status in Firebase.
 * Marking "paid" updates order.status to 'paid' — persists across refreshes.
 */
function renderBilling() {
    const container = document.getElementById('billing-container');
    if (!container) return;

    const billableOrders = orders.filter(o => o.status === 'delivered' || o.status === 'paid');

    if (billableOrders.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No bills yet</h3><p>Delivered orders will appear here</p></div>';
        return;
    }

    container.innerHTML = billableOrders.map(order => {
        const totals      = getOrderTotals(order);
        const isPaid      = order.status === 'paid';
        const createdAt   = new Date(order.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        const tableLabel  = extractTableNumber(order.tableNumber) || '-';

        return `
        <div class="bill-card">
            <div class="bill-header">
                <div>
                    <strong>Order: ${order.id ? order.id.slice(-8).toUpperCase() : ''}</strong><br>
                    <span style="font-size:13px;color:#666;">Table ${tableLabel} &bull; ${createdAt}</span>
                </div>
                <span class="payment-status ${isPaid ? 'payment-paid' : 'payment-unpaid'}">
                    ${isPaid ? 'Paid' : 'Unpaid'}
                </span>
            </div>
            <div class="bill-details">
                <div class="bill-row"><span>Subtotal:</span><span>&#8377;${totals.subtotal}</span></div>
                <div class="bill-row"><span>Tax (5%):</span><span>&#8377;${totals.tax}</span></div>
                <div class="bill-row total"><span>Grand Total:</span><span>&#8377;${totals.total}</span></div>
            </div>
            <div class="bill-actions">
                <button class="btn btn-pay" onclick="markAsPaid('${order.id}')" ${isPaid ? 'disabled' : ''}>
                    Mark as Paid
                </button>
                <button class="btn btn-view" onclick="viewBill('${order.id}')">View Bill</button>
                <button class="btn btn-print" onclick="printBill('${order.id}')">&#129534; Print Bill</button>
            </div>
        </div>`;
    }).join('');
}

function viewBill(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const totals = getOrderTotals(order);
    alert(
        'BILL DETAILS\n' +
        '\u2501'.repeat(22) + '\n' +
        'Order: '   + (order.id || '').slice(-8).toUpperCase() + '\n' +
        'Table: '   + (extractTableNumber(order.tableNumber) || '-') + '\n' +
        'Time: '    + new Date(order.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + '\n\n' +
        'ITEMS:\n'  + (order.items || []).map(i => i.name + ' x' + i.quantity + ' = \u20B9' + i.price * i.quantity).join('\n') + '\n\n' +
        'Subtotal: \u20B9' + totals.subtotal + '\n' +
        'Tax (5%): \u20B9' + totals.tax + '\n' +
        '\u2501'.repeat(22) + '\n' +
        'GRAND TOTAL: \u20B9' + totals.total + '\n' +
        'Status: ' + (order.status || 'unpaid').toUpperCase()
    );
}

function printBill(orderId) {
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        alert('Order not found');
        return;
    }

    const totals = getOrderTotals(order);
    const tableLabel = extractTableNumber(order.tableNumber) || '-';
    const dateStr = new Date(order.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const restaurantName = document.getElementById('restaurantHeader')?.textContent?.replace(' Dashboard', '') || 'Restaurant';

    let itemsHTML = '';
    (order.items || []).forEach(item => {
        const qty = Number(item.quantity) || 1;
        const price = Number(item.price) || 0;
        const itemTotal = qty * price;
        itemsHTML += '<tr><td>' + item.name + '</td><td>' + qty + '</td><td>\u20B9' + price + '</td><td>\u20B9' + itemTotal + '</td></tr>';
    });

    const billHTML = '<!DOCTYPE html><html><head><title>Bill - ' + restaurantName + '</title>' +
        '<style>' +
        'body{font-family:"Segoe UI",Arial,sans-serif;padding:30px;max-width:500px;margin:0 auto;color:#333;}' +
        'h2{text-align:center;margin-bottom:5px;color:#ff6b35;}' +
        '.subtitle{text-align:center;color:#666;margin-bottom:20px;font-size:14px;}' +
        '.info{margin-bottom:15px;font-size:14px;line-height:1.8;}' +
        '.info strong{color:#333;}' +
        'table{width:100%;border-collapse:collapse;margin:15px 0;}' +
        'th{background:#ff6b35;color:white;padding:10px 8px;text-align:center;font-size:13px;}' +
        'td{border-bottom:1px solid #eee;padding:10px 8px;text-align:center;font-size:13px;}' +
        'tr:last-child td{border-bottom:none;}' +
        '.totals{border-top:2px solid #ff6b35;margin-top:10px;padding-top:10px;}' +
        '.totals .row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;}' +
        '.totals .grand{font-size:18px;font-weight:bold;color:#ff6b35;border-top:2px solid #333;margin-top:8px;padding-top:10px;}' +
        '.footer{text-align:center;margin-top:25px;padding-top:15px;border-top:1px dashed #ccc;color:#666;font-size:13px;}' +
        '.status{text-align:center;margin-top:10px;padding:6px 16px;border-radius:20px;display:inline-block;font-size:12px;font-weight:600;}' +
        '.status-paid{background:#d4edda;color:#155724;}' +
        '.status-unpaid{background:#f8d7da;color:#721c24;}' +
        '@media print{body{padding:10px;}}' +
        '</style></head><body>' +
        '<h2>' + restaurantName + '</h2>' +
        '<p class="subtitle">Tax Invoice</p>' +
        '<div class="info">' +
        '<strong>Table:</strong> ' + tableLabel + '<br>' +
        '<strong>Order ID:</strong> ' + (order.id ? order.id.slice(-8).toUpperCase() : '-') + '<br>' +
        '<strong>Date:</strong> ' + dateStr +
        '</div>' +
        '<table><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>' +
        itemsHTML +
        '</table>' +
        '<div class="totals">' +
        '<div class="row"><span>Subtotal:</span><span>\u20B9' + totals.subtotal + '</span></div>' +
        '<div class="row"><span>Tax (5%):</span><span>\u20B9' + totals.tax + '</span></div>' +
        '<div class="row grand"><span>Grand Total:</span><span>\u20B9' + totals.total + '</span></div>' +
        '</div>' +
        '<div style="text-align:center;margin-top:15px;">' +
        '<span class="status ' + (order.status === 'paid' ? 'status-paid' : 'status-unpaid') + '">' +
        (order.status === 'paid' ? 'PAID' : 'UNPAID') + '</span></div>' +
        '<div class="footer">Thank You! Visit Again \uD83D\uDE0A</div>' +
        '</body></html>';

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
        alert('Pop-up blocked! Please allow pop-ups for this site to print bills.');
        return;
    }
    printWindow.document.write(billHTML);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); }, 300);
}

/* ─── MENU — FIREBASE REAL-TIME ─────────────────────── */
/**
 * Listens to menus/{restaurantId}/items in real-time.
 * Any change in Firebase updates the menu display instantly.
 */
function setupMenuListener() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    debugLog('[Menu] Listener attached for', currentRestaurantId);
    menuRef = database.ref('menus/' + currentRestaurantId + '/items');
    menuRef.on('value', snap => {
        const raw = snap.val();
        if (raw) {
            const arr = Array.isArray(raw) ? raw : Object.values(raw);
            menuItems = normalizeMenuItems(arr);
        } else {
            if (typeof DEFAULT_MENU !== 'undefined' && DEFAULT_MENU.length > 0) {
                menuItems = normalizeMenuItems(DEFAULT_MENU);
                saveMenu().catch(err => console.error('Failed to seed default menu:', err));
            } else {
                menuItems = [];
            }
        }
        renderMenu();
    }, err => console.error('Menu listener error:', err));
}

function normalizeMenuItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .filter(item => item && item.name && item.price !== undefined && item.price !== null)
        .map(item => ({
            ...item,
            id: item.id ?? null,
            price: Number(item.price) || 0,
            category:  item.category  || 'Main Course',
            type:      item.type      || 'veg',
            image:     item.image     || DEFAULT_IMAGE,
            available: typeof item.available === 'boolean' ? item.available : true
        }))
        .filter(item => item.name && item.price > 0);
}

function saveMenu() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) {
        return Promise.reject(new Error('Database connection is not ready.'));
    }

    return database.ref('menus/' + currentRestaurantId + '/items').set(menuItems);
}

function addMenuItem(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();

    const name     = document.getElementById('itemName').value.trim();
    const price    = parseFloat(document.getElementById('itemPrice').value);
    const category = document.getElementById('itemCategory').value;
    const type     = document.querySelector('input[name="itemType"]:checked')?.value || 'veg';
    const imagePreview = document.getElementById('imagePreview');
    const uploadedImage = imagePreview?.classList.contains('show') ? imagePreview.src : null;

    if (!name)            { alert('Please enter item name'); return; }
    if (!price || price <= 0) { alert('Please enter a valid price'); return; }
    if (!category)        { alert('Please select a category'); return; }

    const newId = menuItems.length > 0 ? Math.max(...menuItems.map(i => i.id || 0)) + 1 : 1;

    menuItems.push({
        id:        newId,
        name:      name,
        price:     price,
        category:  category,
        type:      type,
        image:     uploadedImage || DEFAULT_IMAGE,
        available: true
    });

    saveMenu().then(() => {
        const form = document.getElementById('addMenuForm');
        if (form) form.reset();
        if (imagePreview) { imagePreview.src = ''; imagePreview.classList.remove('show'); }
        debugLog('[Menu] Added menu item', { id: newId, name });
        alert('Menu item added successfully!');
    }).catch(err => {
        console.error('Failed to save menu item:', err);
        alert('Failed to save menu. Please try again.');
    });
}

function toggleAvailability(itemId) {
    const item = menuItems.find(i => String(i.id) === String(itemId));
    if (!item) return;
    item.available = !item.available;
    saveMenu().catch(err => {
        item.available = !item.available;
        console.error('Failed to update item availability:', err);
        alert('Failed to update menu. Please try again.');
    });
}

function openEditModal(itemId) {
    editingItemId = itemId;
    const item = menuItems.find(i => String(i.id) === String(itemId));
    if (!item) return;
    document.getElementById('editItemName').value     = item.name;
    document.getElementById('editItemPrice').value    = item.price;
    document.getElementById('editItemCategory').value = item.category || 'Main Course';
    (item.type === 'veg'
        ? document.getElementById('editTypeVeg')
        : document.getElementById('editTypeNonVeg')
    ).checked = true;
    document.getElementById('editModal').classList.add('active');
}

function closeEditModal() { editingItemId = null; document.getElementById('editModal').classList.remove('active'); }

function saveEdit() {
    const name     = document.getElementById('editItemName').value.trim();
    const price    = parseFloat(document.getElementById('editItemPrice').value);
    const category = document.getElementById('editItemCategory').value;
    const type     = document.querySelector('input[name="editItemType"]:checked')?.value || 'veg';

    if (!name)            { alert('Please enter item name'); return; }
    if (!price || price <= 0) { alert('Please enter a valid price'); return; }

    const item = menuItems.find(i => String(i.id) === String(editingItemId));
    if (item) { item.name = name; item.price = price; item.category = category; item.type = type; }

    saveMenu().then(() => {
        closeEditModal();
        alert('Menu item updated successfully!');
    }).catch(err => {
        console.error('Failed to update menu item:', err);
        alert('Failed to save menu. Please try again.');
    });
}

function deleteMenuItem(itemId) {
    const item = menuItems.find(i => String(i.id) === String(itemId));
    if (!confirm('Delete "' + (item?.name || 'item') + '"?')) return;
    menuItems = menuItems.filter(i => String(i.id) !== String(itemId));
    saveMenu().then(() => {
        alert('Menu item deleted.');
    }).catch(err => {
        console.error('Failed to delete menu item:', err);
        alert('Failed to save menu. Please try again.');
    });
}

function changeImage(itemId) {
    changingImageItemId = itemId;
    document.getElementById('changeImageInput').click();
}

function handleImageChange(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const item = menuItems.find(i => String(i.id) === String(changingImageItemId));
        if (item) {
            item.image = e.target.result;
            saveMenu().catch(err => {
                console.error('Failed to update menu image:', err);
                alert('Failed to save menu. Please try again.');
            });
        }
        event.target.value = '';
        changingImageItemId = null;
    };
    reader.readAsDataURL(file);
}

function renderMenu() {
    const container = document.getElementById('menu-items-container');
    if (!container) return;

    if (menuItems.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No menu items</h3><p>Add items above to get started</p></div>';
        return;
    }

    container.innerHTML = menuItems.map(item => `
        <div class="menu-item-card ${!item.available ? 'unavailable' : ''}">
            <img src="${item.image || DEFAULT_IMAGE}" alt="${item.name}" class="menu-item-image">
            <div class="menu-item-details">
                <div class="menu-item-name">${item.name}</div>
                <div class="menu-item-category">${item.category || 'Main Course'}</div>
                <span class="menu-item-type type-${item.type || 'veg'}">
                    ${(item.type || 'veg') === 'veg' ? 'Veg' : 'Non-Veg'}
                </span>
            </div>
            <div class="menu-item-price">&#8377;${item.price}</div>
            <div class="availability-toggle">
                <div class="toggle-switch ${item.available ? 'active' : ''}"
                     onclick="toggleAvailability(${item.id})">
                    <div class="toggle-switch-slider"></div>
                </div>
                <span style="font-size:13px;color:${item.available ? '#28a745' : '#dc3545'};font-weight:600;">
                    ${item.available ? 'Available' : 'Unavailable'}
                </span>
            </div>
            <div class="menu-item-actions">
                <button class="btn-edit"         onclick="openEditModal(${item.id})">Edit</button>
                <button class="btn-change-image" onclick="changeImage(${item.id})">Change Image</button>
                <button class="btn-delete"       onclick="deleteMenuItem(${item.id})">Delete</button>
            </div>
        </div>`).join('');
}

/* ─── REVIEWS — FIREBASE REAL-TIME ──────────────────── */
/**
 * Listens to feedbacks/{restaurantId} in real-time.
 * New customer reviews appear instantly in the Reviews tab.
 */
function setupFeedbackListener() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;

    debugLog('[Reviews] Listener attached for', currentRestaurantId);
    feedbackRef = database.ref('feedbacks/' + currentRestaurantId);
    feedbackRef.on('value', snap => {
        feedbacks = [];
        if (snap.exists()) {
            snap.forEach(child => {
                feedbacks.push(normalizeFeedbackRecord(child.val(), child.key));
            });
            feedbacks.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        }
        renderReviews();
    }, err => console.error('Feedbacks listener error:', err));
}

function renderReviews() {
    const container = document.getElementById('reviews-container');
    if (!container) return;

    if (feedbacks.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No reviews yet</h3><p>Customer reviews will appear here in real time</p></div>';
        return;
    }

    const avgRating = feedbacks.reduce((s, f) => s + (Number(f.rating) || 0), 0) / feedbacks.length;

    container.innerHTML = `
        <div style="background:white;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 2px 10px rgba(0,0,0,.08);text-align:center;">
            <div style="font-size:36px;font-weight:700;color:#ff6b35;">${avgRating.toFixed(1)}</div>
            <div style="font-size:22px;color:#f7b731;">${'&#9733;'.repeat(Math.round(avgRating))}${'&#9734;'.repeat(5 - Math.round(avgRating))}</div>
            <div style="color:#666;margin-top:4px;">Average rating from ${feedbacks.length} review${feedbacks.length !== 1 ? 's' : ''}</div>
        </div>
        ${feedbacks.map(fb => `
        <div class="order-card" style="margin-bottom:15px;">
            <div class="order-header">
                <span style="font-weight:600;color:#333;">${fb.name || 'Anonymous'}</span>
                <span class="table-badge">Table ${fb.tableNumber || 'N/A'}</span>
            </div>
            <div style="font-size:20px;color:#f7b731;margin:8px 0;">
                ${'&#9733;'.repeat(Number(fb.rating) || 0)}${'&#9734;'.repeat(5 - (Number(fb.rating) || 0))}
            </div>
            ${fb.message ? `<p style="color:#555;font-size:14px;margin:8px 0;">"${fb.message}"</p>` : ''}
            <div class="order-time" style="margin-top:8px;">
                ${fb.orderId ? 'Order: ' + String(fb.orderId).slice(-8).toUpperCase() + ' &bull; ' : ''}
                ${new Date(fb.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
        </div>`).join('')}`;
}

/* ─── SETTINGS ──────────────────────────────────────── */
function loadSettingsForm() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) return;
    database.ref('restaurants/' + currentRestaurantId).once('value').then(snap => {
        if (!snap.exists()) return;
        const d = snap.val();
        document.getElementById('settingsRestaurantName').value = d.name || '';
        document.getElementById('settingsOwnerEmail').value     = d.email       || '';
        document.getElementById('settingsOwnerPhoneNumber').value = d.phone    || '';
        document.getElementById('settingsOwnerContact').value   = d.email || d.phone || '';
        const codeEl = document.getElementById('settingsOwnerCountryCode');
        if (codeEl) codeEl.value = d.countryCode || '+91';
    });
}

function saveSettings() {
    const database = getDatabase();
    if (!database || !currentRestaurantId) { alert('Database connection is not ready. Please refresh the page.'); return; }

    const name      = document.getElementById('settingsRestaurantName').value.trim();
    const email     = document.getElementById('settingsOwnerEmail').value.trim().toLowerCase();
    const phone     = normalizePhone(document.getElementById('settingsOwnerPhoneNumber').value);
    const countryCode = document.getElementById('settingsOwnerCountryCode').value;
    const newPw     = document.getElementById('settingsOwnerPassword').value.trim();

    if (!name || !email || !phone) { alert('Name, email, and phone are required.'); return; }
    if (!isValidEmail(email))      { alert('Please enter a valid email.'); return; }
    if (!isValidPhone(phone, countryCode)) { alert('Please enter a valid phone number.'); return; }

    const updates = { name, email, phone, countryCode };
    if (newPw) {
        const pwErr = passwordError(newPw);
        if (pwErr) { alert(pwErr); return; }
        updates.password = encodePassword(newPw);
    }

    database.ref('restaurants').once('value').then(snap => {
        const restaurantsValue = snap.val() || {};
        const duplicateEmail = Object.entries(restaurantsValue).some(([id, restaurant]) => id !== currentRestaurantId && (restaurant?.email || '').toLowerCase() === email);
        const duplicatePhone = Object.entries(restaurantsValue).some(([id, restaurant]) => id !== currentRestaurantId && samePhoneNumber(phone, countryCode, restaurant));

        if (duplicateEmail) { alert('Another restaurant is already using this email.'); return; }
        if (duplicatePhone) { alert('Another restaurant is already using this phone number.'); return; }

        return database.ref('restaurants/' + currentRestaurantId).update(updates).then(() => {
            document.getElementById('settingsOwnerContact').value = email || phone;
            document.getElementById('settingsOwnerPassword').value  = '';
            loadRestaurantHeader();
            alert('Settings saved successfully!');
        });
    }).catch(err => {
        alert('Failed to save settings. Please try again.');
        console.error(err);
    });
}

/* ─── QR CODE GENERATION ────────────────────────────── */
function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function getCustomerSiteBaseUrl() {
    const saved = (appStorage.get('qrCustomerBaseUrl') || '').trim();
    if (saved) {
        try { return new URL(saved).origin; } catch (e) { /* fall through */ }
    }
    return window.location.origin;
}

function saveQrBaseUrl() {
    const input = document.getElementById('qrBaseUrlInput');
    if (!input) return;
    const raw = input.value.trim().replace(/\/+$/, '');
    if (!raw) { alert('Please enter a URL before saving.'); return; }
    try {
        const origin = new URL(raw).origin;
        appStorage.set('qrCustomerBaseUrl', origin);
        input.value = origin;
        alert('Customer website URL saved!\nQR codes will now point to:\n' + origin + '/?restaurant=...');
    } catch (e) {
        alert('Invalid URL. Please enter a full URL such as:\nhttps://smart-restaurant-menu.netlify.app');
    }
}

function generateQR() {
    if (!currentRestaurantId) return;

    const isFile  = window.location.protocol === 'file:';
    const isLocal = !isFile && isLocalHost(window.location.hostname);
    let baseUrl;

    if (isFile || isLocal) {
        const saved      = (appStorage.get('qrCustomerBaseUrl') || '').trim();
        const suggestion = saved || 'http://YOUR_PC_IP:5500';
        const entered    = prompt(
            'You are running locally.\n\nEnter the customer website base URL so phones on the same Wi-Fi can open it.\nExample: http://192.168.1.10:5500',
            suggestion
        );
        if (entered === null) return;
        const trimmed = entered.trim().replace(/\/+$/, '');
        if (!trimmed) { alert('No URL entered.'); return; }
        try {
            const parsed = new URL(trimmed);
            baseUrl = parsed.origin;
            if (isLocalHost(parsed.hostname)) {
                alert('Warning: localhost only works on this device.\nUse your PC LAN IP (e.g. 192.168.1.10) for phone scanning.');
            }
        } catch (e) { alert('Invalid URL.'); return; }
        appStorage.set('qrCustomerBaseUrl', baseUrl);
        const inp = document.getElementById('qrBaseUrlInput');
        if (inp) inp.value = baseUrl;
    } else {
        baseUrl = getCustomerSiteBaseUrl();
    }

    const customerUrl   = baseUrl + '/?restaurant=' + encodeURIComponent(currentRestaurantId);
    const primaryQrUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=20&ecc=M&data=' + encodeURIComponent(customerUrl);
    const fallbackQrUrl = 'https://quickchart.io/qr?size=420&margin=2&ecLevel=M&text=' + encodeURIComponent(customerUrl);

    const qrImage = document.getElementById('qrImage');
    qrImage.dataset.fallbackUsed = '0';
    qrImage.onerror = function () {
        if (qrImage.dataset.fallbackUsed === '1') {
            alert('Unable to load QR image. Please check your internet connection.');
            return;
        }
        qrImage.dataset.fallbackUsed = '1';
        qrImage.src = fallbackQrUrl;
    };
    qrImage.src = primaryQrUrl;
    document.getElementById('customerUrl').textContent = customerUrl;
    document.getElementById('qrDisplay').classList.add('show');
}

function prefillQrBaseUrl() {
    const input = document.getElementById('qrBaseUrlInput');
    if (input) input.value = (appStorage.get('qrCustomerBaseUrl') || '').trim();
}

/* ─── ANALYTICS — FIREBASE REAL-TIME (UPGRADED) ─────── */
/**
 * Full analytics dashboard with time filters, Chart.js charts,
 * item performance table with trend arrows, Firebase storage,
 * and JSON report export.
 */
let analyticsRef = null;
let revenueChartInstance = null;
let itemChartInstance = null;
let analyticsAllOrders = [];   // raw order cache from Firebase
let analyticsFilterDays = 7;   // default filter

function onAnalyticsFilterChange() {
    var sel = document.getElementById('analyticsTimeFilter');
    analyticsFilterDays = sel ? parseInt(sel.value, 10) || 7 : 7;
    processAnalytics();
}

function loadAnalytics() {
    var database = getDatabase();

    if (!database || !currentRestaurantId) {
        debugLog('[Analytics] DB or Restaurant ID missing');
        return;
    }

    // Detach any previous analytics listener
    if (analyticsRef) {
        analyticsRef.off();
        analyticsRef = null;
    }

    var loadingEl = document.getElementById('analyticsLoading');
    var contentEl = document.getElementById('analyticsContent');
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    analyticsRef = database.ref('orders/' + currentRestaurantId);
    analyticsRef.on('value', function (snapshot) {
        var data = snapshot.val() || {};
        analyticsAllOrders = [];
        Object.values(data).forEach(function (order) {
            if (order) analyticsAllOrders.push(order);
        });

        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';

        processAnalytics();
    }, function (err) {
        console.error('Analytics listener error:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
    });
}

function processAnalytics() {
    var now = new Date();
    var filterMs = analyticsFilterDays * 24 * 60 * 60 * 1000;
    var startDate = new Date(now.getTime() - filterMs);
    var prevStartDate = new Date(startDate.getTime() - filterMs);

    var totalRevenue = 0;
    var totalOrders = 0;
    var totalItems = 0;
    var itemData = {};         // { name: { count, revenue } }
    var prevItemData = {};     // previous period for trend
    var dailyRevenue = {};     // 'YYYY-MM-DD' -> revenue

    analyticsAllOrders.forEach(function (order) {
        if (!order) return;
        var orderDate = new Date(order.createdAt || 0);
        var total = Number(order.total) || 0;

        // Current period
        if (orderDate >= startDate && orderDate <= now) {
            totalOrders++;
            totalRevenue += total;

            var dateKey = orderDate.toISOString().slice(0, 10);
            dailyRevenue[dateKey] = (dailyRevenue[dateKey] || 0) + total;

            (order.items || []).forEach(function (item) {
                if (!item || !item.name) return;
                var qty = Number(item.quantity) || 1;
                var price = Number(item.price) || 0;
                totalItems += qty;
                if (!itemData[item.name]) itemData[item.name] = { count: 0, revenue: 0 };
                itemData[item.name].count += qty;
                itemData[item.name].revenue += price * qty;
            });
        }

        // Previous period (for trend)
        if (orderDate >= prevStartDate && orderDate < startDate) {
            (order.items || []).forEach(function (item) {
                if (!item || !item.name) return;
                var qty = Number(item.quantity) || 1;
                if (!prevItemData[item.name]) prevItemData[item.name] = { count: 0 };
                prevItemData[item.name].count += qty;
            });
        }
    });

    // Top item
    var topItem = '-';
    var topCount = 0;
    for (var name in itemData) {
        if (itemData[name].count > topCount) {
            topCount = itemData[name].count;
            topItem = name;
        }
    }

    var avgOrder = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // --- Update summary cards ---
    var el;
    el = document.getElementById('filteredRevenue'); if (el) el.textContent = totalRevenue.toLocaleString('en-IN');
    el = document.getElementById('totalOrders');     if (el) el.textContent = totalOrders;
    el = document.getElementById('totalItems');      if (el) el.textContent = totalItems;
    el = document.getElementById('avgOrderValue');   if (el) el.textContent = avgOrder.toLocaleString('en-IN');
    el = document.getElementById('topItem');         if (el) el.textContent = topItem;

    // --- Empty state ---
    var emptyEl = document.getElementById('analyticsEmptyState');
    var tableEl = document.getElementById('itemStatsTable');
    if (totalOrders === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (tableEl) tableEl.style.display = 'none';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        if (tableEl) tableEl.style.display = 'table';
    }

    // --- Revenue chart ---
    renderRevenueChart(dailyRevenue, startDate, now);

    // --- Item chart ---
    renderItemChart(itemData);

    // --- Item stats table ---
    renderItemStatsTable(itemData, prevItemData);

    // --- Store analytics summary in Firebase ---
    storeAnalyticsSummary(totalRevenue, totalOrders, totalItems, topItem, itemData);

    debugLog('[Analytics] Processed', { totalOrders, totalRevenue, totalItems, topItem, filterDays: analyticsFilterDays });
}

function renderRevenueChart(dailyRevenue, startDate, endDate) {
    var canvas = document.getElementById('revenueChart');
    if (!canvas) return;

    // Build labels and data array
    var labels = [];
    var data = [];
    var d = new Date(startDate);
    while (d <= endDate) {
        var key = d.toISOString().slice(0, 10);
        labels.push(d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
        data.push(dailyRevenue[key] || 0);
        d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    }

    // Limit labels for large ranges
    var step = 1;
    if (labels.length > 30) step = Math.ceil(labels.length / 30);
    var sparseLabels = labels.map(function (l, i) { return i % step === 0 ? l : ''; });

    if (revenueChartInstance) {
        revenueChartInstance.data.labels = sparseLabels;
        revenueChartInstance.data.datasets[0].data = data;
        revenueChartInstance.update();
        return;
    }

    try {
        revenueChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: sparseLabels,
                datasets: [{
                    label: 'Revenue',
                    data: data,
                    borderColor: '#ff6b35',
                    backgroundColor: 'rgba(255,107,53,0.1)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: data.length > 60 ? 0 : 3,
                    pointBackgroundColor: '#ff6b35',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) { return '\u20B9' + (ctx.parsed.y || 0).toLocaleString('en-IN'); }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function (v) { return '\u20B9' + v.toLocaleString('en-IN'); }
                        },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Revenue chart error:', e);
    }
}

function renderItemChart(itemData) {
    var canvas = document.getElementById('itemChart');
    if (!canvas) return;

    // Sort by count descending, take top 10
    var entries = Object.entries(itemData).sort(function (a, b) { return b[1].count - a[1].count; }).slice(0, 10);
    var labels = entries.map(function (e) { return e[0]; });
    var data = entries.map(function (e) { return e[1].count; });

    var colors = [
        '#ff6b35', '#f7931e', '#28a745', '#17a2b8', '#6f42c1',
        '#fd7e14', '#20c997', '#e83e8c', '#007bff', '#6c757d'
    ];

    if (itemChartInstance) {
        itemChartInstance.data.labels = labels;
        itemChartInstance.data.datasets[0].data = data;
        itemChartInstance.data.datasets[0].backgroundColor = colors.slice(0, data.length);
        itemChartInstance.update();
        return;
    }

    try {
        itemChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Orders',
                    data: data,
                    backgroundColor: colors.slice(0, data.length),
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 0,
                            font: { size: 11 }
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.error('Item chart error:', e);
    }
}

function renderItemStatsTable(itemData, prevItemData) {
    var tbody = document.getElementById('itemStatsBody');
    if (!tbody) return;

    var entries = Object.entries(itemData).sort(function (a, b) { return b[1].count - a[1].count; });

    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">No items sold in this period</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(function (entry) {
        var name = entry[0];
        var info = entry[1];
        var prev = (prevItemData[name] && prevItemData[name].count) || 0;
        var trend = '';
        var trendClass = '';

        if (prev === 0 && info.count > 0) {
            trend = 'NEW';
            trendClass = 'trend-up';
        } else if (info.count > prev) {
            trend = '\u2191 Up';
            trendClass = 'trend-up';
        } else if (info.count < prev) {
            trend = '\u2193 Down';
            trendClass = 'trend-down';
        } else {
            trend = '\u2192 Stable';
            trendClass = 'trend-stable';
        }

        return '<tr>' +
            '<td>' + name + '</td>' +
            '<td>' + info.count + '</td>' +
            '<td>' + info.revenue.toLocaleString('en-IN') + '</td>' +
            '<td><span class="' + trendClass + '">' + trend + '</span></td>' +
            '</tr>';
    }).join('');
}

function storeAnalyticsSummary(totalRevenue, totalOrders, totalItems, topItem, itemData) {
    var database = getDatabase();
    if (!database || !currentRestaurantId) return;

    var summary = {
        totalRevenue: totalRevenue,
        totalOrders: totalOrders,
        totalItems: totalItems,
        topItem: topItem,
        filterDays: analyticsFilterDays,
        updatedAt: new Date().toISOString()
    };

    // Store top items
    var topItems = {};
    Object.entries(itemData).sort(function (a, b) { return b[1].count - a[1].count; }).slice(0, 20).forEach(function (entry) {
        var safeName = entry[0].replace(/[.#$/\[\]]/g, '_');
        topItems[safeName] = { name: entry[0], count: entry[1].count, revenue: entry[1].revenue };
    });
    summary.items = topItems;

    database.ref('analytics/' + currentRestaurantId + '/summary').set(summary).catch(function (err) {
        debugLog('[Analytics] Failed to store summary:', err);
    });
}

function downloadAnalyticsReport() {
    var now = new Date();
    var filterMs = analyticsFilterDays * 24 * 60 * 60 * 1000;
    var startDate = new Date(now.getTime() - filterMs);

    var filteredOrders = analyticsAllOrders.filter(function (order) {
        var d = new Date(order.createdAt || 0);
        return d >= startDate && d <= now;
    });

    var totalRevenue = 0;
    var totalOrders = filteredOrders.length;
    var itemData = {};

    filteredOrders.forEach(function (order) {
        totalRevenue += Number(order.total) || 0;
        (order.items || []).forEach(function (item) {
            if (!item || !item.name) return;
            var qty = Number(item.quantity) || 1;
            var price = Number(item.price) || 0;
            if (!itemData[item.name]) itemData[item.name] = { count: 0, revenue: 0 };
            itemData[item.name].count += qty;
            itemData[item.name].revenue += price * qty;
        });
    });

    var report = {
        generatedAt: now.toISOString(),
        restaurantId: currentRestaurantId,
        filterDays: analyticsFilterDays,
        periodStart: startDate.toISOString(),
        periodEnd: now.toISOString(),
        summary: {
            totalRevenue: totalRevenue,
            totalOrders: totalOrders,
            avgOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
        },
        items: Object.entries(itemData).sort(function (a, b) { return b[1].count - a[1].count; }).map(function (e) {
            return { name: e[0], count: e[1].count, revenue: e[1].revenue };
        }),
        orders: filteredOrders.map(function (o) {
            return {
                total: o.total,
                status: o.status,
                createdAt: o.createdAt,
                tableNumber: o.tableNumber,
                items: (o.items || []).map(function (i) {
                    return { name: i.name, quantity: i.quantity, price: i.price };
                })
            };
        })
    };

    try {
        var blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'analytics-report-' + analyticsFilterDays + 'days-' + now.toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Export error:', e);
        alert('Failed to export report.');
    }
}

/* ─── TAB NAVIGATION ────────────────────────────────── */
function switchTab(tabName) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    const section = document.getElementById(tabName + '-section');
    if (section) section.classList.add('active');

    const tab = document.querySelector('.nav-tab[data-tab="' + tabName + '"]');
    if (tab) tab.classList.add('active');
}

/* ─── COUNTRY CODE / PHONE UI ───────────────────────── */
function populateCountryOptions() {
    ['ownerCountryCode','settingsOwnerCountryCode','forgotCountryCode'].forEach(selectId => {
        const sel = document.getElementById(selectId);
        if (!sel || sel.options.length > 0) return;
        COUNTRY_PHONE_DATA.forEach(c => {
            const opt = document.createElement('option');
            opt.value       = c.code;
            opt.textContent = c.flag + ' ' + c.code + ' ' + c.name;
            sel.appendChild(opt);
        });
        sel.value = '+91';
    });
    updateDialCodeBadge();
}

function updateDialCodeBadge() {
    const sel   = document.getElementById('ownerCountryCode');
    const badge = document.getElementById('selectedDialCode');
    if (sel && badge) badge.textContent = sel.value || '+91';
}

/* ─── IMAGE UPLOAD PREVIEW (ADD FORM) ───────────────── */
function previewImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const preview = document.getElementById('imagePreview');
        if (preview) { preview.src = e.target.result; preview.classList.add('show'); }
    };
    reader.readAsDataURL(file);
}

/* ─── MODAL CLOSE ON BACKDROP ───────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.addEventListener('click', function (e) {
            if (e.target === this) closeEditModal();
        });
    }

    // Country codes
    populateCountryOptions();
    const sel = document.getElementById('ownerCountryCode');
    if (sel) sel.addEventListener('change', updateDialCodeBadge);

    ['signupVerificationCode','loginVerificationCode','resetVerificationCode','ownerPhoneNumber','forgotPhoneNumber','settingsOwnerPhoneNumber'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', function () {
            if (id.includes('VerificationCode')) {
                this.value = this.value.replace(/\D/g,'').slice(0,6);
            } else {
                this.value = this.value.replace(/[^\d\s()+-]/g,'');
            }
        });
    });

    // Check session
    loadApp();
});

/* ─── APP BOOTSTRAP ─────────────────────────────────── */
function loadApp() {
    const database = getDatabase();
    const savedOwner = appStorage.get('currentOwner');
    if (savedOwner) {
        debugLog('[Auth] Session found', savedOwner);
        if (!database) {
            currentOwnerId      = savedOwner;
            currentRestaurantId = savedOwner;
            openDashboard();
            return;
        }
        database.ref('restaurants/' + savedOwner).once('value').then(snap => {
            if (snap.exists()) {
                currentOwnerId      = savedOwner;
                currentRestaurantId = savedOwner;
                openDashboard();
            } else {
                // Account was deleted from Firebase — clear stale session
                appStorage.remove('currentOwner');
                appStorage.remove('currentRestaurant');
                showAuthScreen();
            }
        }).catch(() => {
            // Offline — trust the session cache
            currentOwnerId      = savedOwner;
            currentRestaurantId = savedOwner;
            openDashboard();
        });
    } else {
        showAuthScreen();
    }
}

function showAuthScreen() {
    document.getElementById('ownerAuth').style.display  = 'flex';
    document.getElementById('dashboard').style.display  = 'none';
    debugLog('[Auth] Showing auth screen');
    showLogin();
}

window.showSignup = showSignup;
window.showLogin = showLogin;
window.showForgotPassword = showForgotPassword;
window.handleSignup = handleSignup;
window.verifySignupCode = verifySignupCode;
window.resendSignupCode = resendSignupCode;
window.backToSignupFromVerification = backToSignupFromVerification;
window.handleLogin = handleLogin;
window.verifyLoginCode = verifyLoginCode;
window.resendLoginCode = resendLoginCode;
window.backToLoginFromVerification = backToLoginFromVerification;
window.handleForgotPassword = handleForgotPassword;
window.verifyResetCode = verifyResetCode;
window.resendResetCode = resendResetCode;
window.completePasswordReset = completePasswordReset;
window.handleLogout = handleLogout;
window.switchTab = switchTab;
window.addMenuItem = addMenuItem;
window.previewImage = previewImage;
window.saveQrBaseUrl = saveQrBaseUrl;
window.generateQR = generateQR;
window.saveSettings = saveSettings;
window.toggleAvailability = toggleAvailability;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveEdit = saveEdit;
window.deleteMenuItem = deleteMenuItem;
window.changeImage = changeImage;
window.handleImageChange = handleImageChange;
window.confirmOrderItem = confirmOrderItem;
window.deliverOrderItem = deliverOrderItem;
window.markAsPaid = markAsPaid;
window.viewBill = viewBill;
window.printBill = printBill;
window.addTable = addTable;
window.deleteTable = deleteTable;
window.markTableFree = markTableFree;
window.loadAnalytics = loadAnalytics;
window.onAnalyticsFilterChange = onAnalyticsFilterChange;
window.downloadAnalyticsReport = downloadAnalyticsReport;

