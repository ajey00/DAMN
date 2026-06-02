/*
=======================================================
Smart Restaurant — Order History Module
File: order-history.js
Purpose: Filter and display all past orders by date range.
Data Layer: Firebase Realtime Database
=======================================================
*/

/* ─── STATE ─────────────────────────────────────────── */
let orderHistoryData = [];
let orderHistoryRef = null;

/* ─── HELPERS ───────────────────────────────────────── */
function getOHDatabase() {
    return window.db || null;
}

function getOHRestaurantId() {
    return window.currentRestaurantId || sessionStorage.getItem('currentRestaurant') || null;
}

/* ─── FIREBASE LISTENER ────────────────────────────── */
function setupOrderHistoryListener() {
    const database = getOHDatabase();
    const restaurantId = getOHRestaurantId();
    
    if (!database || !restaurantId) {
        console.debug('[OrderHistory] Database or Restaurant ID not available yet.');
        return;
    }

    if (orderHistoryRef) { 
        orderHistoryRef.off(); 
        orderHistoryRef = null; 
    }

    orderHistoryRef = database.ref('orders/' + restaurantId);
    orderHistoryRef.on('value', snap => {
        orderHistoryData = [];
        if (snap.exists()) {
            snap.forEach(child => {
                const val = child.val();
                
                // Ensure valid createdAt timestamp safely
                const safeCreatedAt = val.createdAt ? val.createdAt : new Date().toISOString();
                
                orderHistoryData.push({
                    ...val,
                    createdAt: safeCreatedAt,
                    _key: child.key,
                    id: child.key
                });
            });
            // Sort newest first
            orderHistoryData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        }

        // Auto-refresh the view if we are already displaying data
        const container = document.getElementById('order-history-results');
        if (container && !container.innerHTML.includes('empty-state')) {
            searchOrderHistory();
        } else if (orderHistoryData.length > 0) {
            // Task 9: Add a fallback to show all orders if no filter is applied at the beginning
            showAllOrderHistory();
        } else if (container) {
            container.innerHTML = '<div class="empty-state"><h3>No orders found</h3><p>No orders exist for the selected criteria</p></div>';
        }
    }, err => console.error('[OrderHistory] Listener error:', err));
}

function detachOrderHistoryListener() {
    if (orderHistoryRef) { 
        orderHistoryRef.off(); 
        orderHistoryRef = null; 
    }
    orderHistoryData = [];
}

/* ─── SEARCH / FILTER ───────────────────────────────── */
function searchOrderHistory() {
    const startDateStr = document.getElementById('ohStartDate')?.value;
    const endDateStr = document.getElementById('ohEndDate')?.value;
    const errorEl = document.getElementById('ohError');

    // Clear previous error
    if (errorEl) { 
        errorEl.textContent = ''; 
        errorEl.style.display = 'none'; 
    }

    // Task 9: Add a fallback to show all orders if no filter is applied.
    if (!startDateStr && !endDateStr) {
        console.debug('[OrderHistory] No filter applied, displaying all orders.');
        showAllOrderHistory();
        return;
    }

    if (!startDateStr || !endDateStr) {
        if (errorEl) { 
            errorEl.textContent = 'Please select both start and end dates'; 
            errorEl.style.display = 'block'; 
        }
        return;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        if (errorEl) { 
            errorEl.textContent = 'Invalid date selected'; 
            errorEl.style.display = 'block'; 
        }
        return;
    }

    // Set start of day for start date and end of day for end date
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    if (startDate > endDate) {
        if (errorEl) { 
            errorEl.textContent = 'Start date cannot be after end date'; 
            errorEl.style.display = 'block'; 
        }
        return;
    }

    const filtered = orderHistoryData.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= startDate && orderDate <= endDate;
    });

    console.debug(`[OrderHistory] Filtering from ${startDateStr} to ${endDateStr}. Found ${filtered.length} orders.`);
    renderOrderHistory(filtered, startDateStr, endDateStr);
}

function clearOrderHistoryFilter() {
    const startEl = document.getElementById('ohStartDate');
    const endEl = document.getElementById('ohEndDate');
    const errorEl = document.getElementById('ohError');

    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';
    if (errorEl) { 
        errorEl.textContent = ''; 
        errorEl.style.display = 'none'; 
    }
    
    // Fallback to show all when cleared
    showAllOrderHistory();
}

function showAllOrderHistory() {
    console.debug('[OrderHistory] Rendering all order history.');
    renderOrderHistory(orderHistoryData, 'All Time', 'Present');
}

/* ─── RENDER ────────────────────────────────────────── */
function renderOrderHistory(orders, startLabel, endLabel) {
    const container = document.getElementById('order-history-results');
    if (!container) return;

    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No orders found</h3><p>No orders exist for the selected criteria</p></div>';
        return;
    }

    // Summary
    let totalRevenue = 0;
    let totalItems = 0;
    orders.forEach(o => {
        totalRevenue += Number(o.total) || 0;
        (o.items || []).forEach(i => { totalItems += Number(i.quantity) || 1; });
    });

    const summaryHTML = `
    <div class="oh-summary">
        <div class="oh-summary-card">
            <span class="oh-summary-label">Orders Found</span>
            <span class="oh-summary-value">${orders.length}</span>
        </div>
        <div class="oh-summary-card">
            <span class="oh-summary-label">Total Revenue</span>
            <span class="oh-summary-value">₹${totalRevenue.toLocaleString('en-IN')}</span>
        </div>
        <div class="oh-summary-card">
            <span class="oh-summary-label">Items Sold</span>
            <span class="oh-summary-value">${totalItems}</span>
        </div>
        <div class="oh-summary-card">
            <span class="oh-summary-label">Avg Order</span>
            <span class="oh-summary-value">₹${orders.length > 0 ? Math.round(totalRevenue / orders.length).toLocaleString('en-IN') : 0}</span>
        </div>
    </div>`;

    const tableRows = orders.map(order => {
        const createdAt = new Date(order.createdAt);
        const dateStr = isNaN(createdAt.getTime()) ? '-' : createdAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
        const tableLabel = order.tableNumber || '-';
        const itemsList = (order.items || []).map(i => i.name + ' ×' + (i.quantity || 1)).join(', ');
        const total = Number(order.total) || 0;
        const statusClass = 'oh-status-' + (order.status || 'pending');

        return `
        <tr>
            <td><strong>${(order.id || '').slice(-8).toUpperCase()}</strong></td>
            <td>${dateStr}</td>
            <td>Table ${tableLabel}</td>
            <td class="oh-items-cell" title="${itemsList}">${itemsList || '-'}</td>
            <td>₹${total.toLocaleString('en-IN')}</td>
            <td><span class="${statusClass}">${(order.status || 'pending').charAt(0).toUpperCase() + (order.status || 'pending').slice(1)}</span></td>
        </tr>`;
    }).join('');

    container.innerHTML = summaryHTML + `
    <table class="oh-table">
        <thead>
            <tr>
                <th>Order ID</th>
                <th>Date & Time</th>
                <th>Table</th>
                <th>Items</th>
                <th>Total</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>${tableRows}</tbody>
    </table>`;
}

/* ─── WINDOW EXPORTS ────────────────────────────────── */
window.setupOrderHistoryListener = setupOrderHistoryListener;
window.detachOrderHistoryListener = detachOrderHistoryListener;
window.searchOrderHistory = searchOrderHistory;
window.clearOrderHistoryFilter = clearOrderHistoryFilter;
window.showAllOrderHistory = showAllOrderHistory;
