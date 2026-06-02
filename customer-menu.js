const DEFAULT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23ddd' width='200' height='200'/%3E%3Ctext fill='%23999' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-size='20'%3ENo Image%3C/text%3E%3C/svg%3E";
const CUSTOMER_DEBUG = true;

function customerLog(...args) {
    if (CUSTOMER_DEBUG) {
        console.log(...args);
    }
}

const appStorage = (() => {
    const memory = {};

    function getStore() {
        try {
            return window.sessionStorage;
        } catch (error) {
            return null;
        }
    }

    return {
        get(key) {
            const store = getStore();
            return store ? store.getItem(key) : (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null);
        },
        set(key, value) {
            const store = getStore();
            if (store) {
                store.setItem(key, value);
            } else {
                memory[key] = String(value);
            }
        },
        remove(key) {
            const store = getStore();
            if (store) {
                store.removeItem(key);
            } else {
                delete memory[key];
            }
        }
    };
})();

let menuItems = [];
let cart = [];
let currentOrderId = null;
let currentFilter = "all";
let restaurantId = "";
let restaurantName = "Restaurant Menu";
let menuListenerRef = null;
let orderStatusRef = null;
let tablesListenerRef = null;
let validTables = [];

const CATEGORIES = [
    { id: "Starters", name: "Starters" },
    { id: "Main Course", name: "Main Course" },
    { id: "Indian Breads", name: "Indian Breads" },
    { id: "Rice", name: "Rice" },
    { id: "Snacks", name: "Snacks" },
    { id: "Desserts", name: "Desserts" },
    { id: "Drinks", name: "Drinks" }
];

function getDatabase() {
    return window.db || null;
}

function getCurrentRestaurantId() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("restaurant") || appStorage.get("currentRestaurant") || "";

    if (id) {
        appStorage.set("currentRestaurant", id);
    }

    customerLog("[Customer] Active restaurant:", id || "not set");
    return id;
}

function applyRestaurantName() {
    const menuHeader = document.querySelector("#menuPage .logo h1");
    const checkoutHeader = document.querySelector("#checkoutPage .logo h1");

    if (menuHeader) {
        menuHeader.textContent = restaurantName;
    }

    if (checkoutHeader) {
        checkoutHeader.textContent = restaurantName;
    }

    document.querySelectorAll("footer p:first-child").forEach((element) => {
        element.textContent = "\u00A9 2025 " + restaurantName + ". All rights reserved.";
    });
}

function loadRestaurantName() {
    const database = getDatabase();

    if (!database || !restaurantId) {
        applyRestaurantName();
        return;
    }

    database.ref("restaurants/" + restaurantId).once("value")
        .then((snapshot) => {
            if (!snapshot.exists()) {
                applyRestaurantName();
                return;
            }

            const restaurant = snapshot.val() || {};
            restaurantName = restaurant.name || restaurant.restaurantName || "Restaurant Menu";
            applyRestaurantName();
        })
        .catch((error) => {
            console.error("[Customer] Failed to load restaurant name.", error);
            applyRestaurantName();
        });
}

function showNoRestaurantError() {
    const container = document.getElementById("menuContainer");
    if (!container) {
        return;
    }

    container.innerHTML = "<div class='empty-cart'><h3>Restaurant not found</h3><p>Please scan the correct QR code provided by the restaurant.</p></div>";
}

function normalizeMenuItems(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .filter((item) => item && item.name && item.price !== undefined && item.price !== null)
        .map((item, index) => ({
            id: item.id ?? (index + 1),
            name: String(item.name).trim(),
            price: Number(item.price) || 0,
            description: item.description || "",
            category: item.category || "Main Course",
            type: item.type === "nonveg" ? "nonveg" : "veg",
            image: item.image || DEFAULT_IMAGE,
            available: typeof item.available === "boolean" ? item.available : true
        }))
        .filter((item) => item.name && item.price > 0);
}

function seedDefaultMenu(database) {
    if (!database || !restaurantId || typeof DEFAULT_MENU === "undefined") {
        return Promise.resolve([]);
    }

    const seededMenu = normalizeMenuItems(DEFAULT_MENU);
    if (seededMenu.length === 0) {
        return Promise.resolve([]);
    }

    customerLog("[Customer] Seeding default menu for", restaurantId);
    return database.ref("menus/" + restaurantId + "/items").set(seededMenu)
        .then(() => seededMenu)
        .catch((error) => {
            console.error("[Customer] Failed to seed default menu.", error);
            return seededMenu;
        });
}

function setupMenuListener() {
    const database = getDatabase();

    if (!restaurantId) {
        showNoRestaurantError();
        return;
    }

    if (!database) {
        console.error("[Customer] Firebase database is not ready.");
        showNoRestaurantError();
        return;
    }

    if (menuListenerRef) {
        menuListenerRef.off();
    }

    menuListenerRef = database.ref("menus/" + restaurantId + "/items");
    customerLog("[Customer] Listening for menu changes:", menuListenerRef.toString());

    menuListenerRef.on("value", (snapshot) => {
        const rawMenu = snapshot.val();

        if (rawMenu && (Array.isArray(rawMenu) ? rawMenu.length : Object.keys(rawMenu).length)) {
            const arrayMenu = Array.isArray(rawMenu) ? rawMenu : Object.values(rawMenu);
            menuItems = normalizeMenuItems(arrayMenu);
            displayMenu();
            return;
        }

        seedDefaultMenu(database).then((seededMenu) => {
            menuItems = seededMenu;
            displayMenu();
        });
    }, (error) => {
        console.error("[Customer] Menu listener failed.", error);
        menuItems = [];
        displayMenu();
    });
}

function loadCart() {
    try {
        cart = JSON.parse(appStorage.get("cart") || "[]");
    } catch (error) {
        cart = [];
    }

    if (!Array.isArray(cart)) {
        cart = [];
    }

    cart = cart
        .filter((item) => item && item.name)
        .map((item) => ({
            id: item.id,
            name: item.name,
            price: Number(item.price) || 0,
            image: item.image || DEFAULT_IMAGE,
            quantity: Math.max(1, Number(item.quantity) || 1)
        }));

    updateCartCount();
}

function saveCart() {
    appStorage.set("cart", JSON.stringify(cart));
    updateCartCount();
}

function updateCartCount() {
    const cartCount = document.getElementById("cartCount");
    if (!cartCount) {
        return;
    }

    cartCount.textContent = String(cart.reduce((total, item) => total + (Number(item.quantity) || 0), 0));
}

function showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.className = type === "notification" ? "toast notification show" : "toast show";

    window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function filterMenuGlobal(filter, event) {
    currentFilter = filter;
    document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));

    const activeButton = event?.currentTarget || event?.target;
    if (activeButton) {
        activeButton.classList.add("active");
    }

    displayMenu();
}

function displayMenu() {
    const container = document.getElementById("menuContainer");
    if (!container) {
        return;
    }

    container.innerHTML = "";

    if (menuItems.length === 0) {
        container.innerHTML = "<div class='empty-cart'><h3>Menu is being set up</h3><p>Please check back soon.</p></div>";
        return;
    }

    let filteredItems = menuItems;
    if (currentFilter === "veg") {
        filteredItems = menuItems.filter((item) => item.type === "veg");
    }
    if (currentFilter === "nonveg") {
        filteredItems = menuItems.filter((item) => item.type === "nonveg");
    }

    let hasVisibleItems = false;

    CATEGORIES.forEach((category) => {
        const categoryItems = filteredItems.filter((item) => item.category === category.id && item.available);
        if (categoryItems.length === 0) {
            return;
        }

        hasVisibleItems = true;

        const section = document.createElement("div");
        section.className = "category-section";
        section.innerHTML = `
            <h2 class="category-header">${category.name}</h2>
            <div class="menu-grid">
                ${categoryItems.map((item) => `
                    <div class="menu-item ${!item.available ? "unavailable" : ""}">
                        <div class="veg-indicator ${item.type}"></div>
                        <img
                            src="${item.image || DEFAULT_IMAGE}"
                            alt="${item.name}"
                            class="menu-item-image"
                            onerror="this.src='${DEFAULT_IMAGE}'"
                        >
                        <div class="menu-item-content">
                            <h3 class="menu-item-name">${item.name}</h3>
                            <p class="menu-item-description">${item.description || ""}</p>
                            <div class="menu-item-footer">
                                <span class="menu-item-price">&#8377;${item.price}</span>
                                <button
                                    class="add-to-cart-btn"
                                    onclick="addToCart(${JSON.stringify(item.id)})"
                                    ${!item.available ? "disabled" : ""}
                                >
                                    ${item.available ? "Add to Cart" : "Unavailable"}
                                </button>
                            </div>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
        container.appendChild(section);
    });

    if (!hasVisibleItems) {
        container.innerHTML = "<div class='empty-cart'><h3>No items found</h3><p>Try a different filter.</p></div>";
    }
}

function addToCart(itemId) {
    const item = menuItems.find((entry) => String(entry.id) === String(itemId));

    if (!item) {
        showToast("Item not found.", "notification");
        return;
    }

    if (!item.available) {
        showToast("This item is currently unavailable.", "notification");
        return;
    }

    const existingItem = cart.find((entry) => String(entry.id) === String(itemId));
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({
            id: item.id,
            name: item.name,
            price: item.price,
            image: item.image || DEFAULT_IMAGE,
            quantity: 1
        });
    }

    saveCart();
    showToast(item.name + " added to cart.");
}

function goToCheckout() {
    if (cart.length === 0) {
        showToast("Your cart is empty. Add some items first.", "notification");
        return;
    }

    const menuPage = document.getElementById("menuPage");
    const checkoutPage = document.getElementById("checkoutPage");

    if (menuPage) {
        menuPage.style.display = "none";
    }

    if (checkoutPage) {
        checkoutPage.style.display = "block";
    }

    applyRestaurantName();
    displayCart();
    updateSummary();
    updateTableHint();
}

function loadTables() {
    const database = getDatabase();
    if (!database || !restaurantId) return;

    if (tablesListenerRef) {
        tablesListenerRef.off();
    }

    tablesListenerRef = database.ref("tables/" + restaurantId);
    tablesListenerRef.on("value", (snapshot) => {
        const data = snapshot.val() || {};
        validTables = Object.keys(data).map(String);
        customerLog("[Customer] Valid tables loaded:", validTables);
        updateTableHint();
    }, (error) => {
        console.error("[Customer] Failed to load tables.", error);
        validTables = [];
    });
}

function updateTableHint() {
    const hintEl = document.getElementById("tableHint");
    if (!hintEl) return;

    if (validTables.length > 0) {
        hintEl.textContent = "Available tables: " + validTables.sort((a, b) => Number(a) - Number(b)).join(", ");
        hintEl.style.color = "#28a745";
    } else {
        hintEl.textContent = "Loading available tables...";
        hintEl.style.color = "#888";
    }
}

function goBackToMenu() {
    const menuPage = document.getElementById("menuPage");
    const checkoutPage = document.getElementById("checkoutPage");

    if (checkoutPage) {
        checkoutPage.style.display = "none";
    }

    if (menuPage) {
        menuPage.style.display = "block";
    }

    applyRestaurantName();
}

function goBackToMenuFromModal() {
    const successModal = document.getElementById("successModal");
    if (successModal) {
        successModal.classList.remove("show");
    }

    currentOrderId = null;
    goBackToMenu();
}

function displayCart() {
    const container = document.getElementById("cartItems");
    if (!container) {
        return;
    }

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-cart">
                <div class="empty-cart-icon">Cart</div>
                <h3>Your cart is empty.</h3>
                <p>Add some delicious items from our menu.</p>
                <br>
                <a onclick="goBackToMenu()" class="back-button">Browse Menu</a>
            </div>
        `;
        return;
    }

    container.innerHTML = cart.map((item, index) => `
        <div class="cart-item">
            <img src="${item.image || DEFAULT_IMAGE}" alt="${item.name}" class="cart-item-image" onerror="this.src='${DEFAULT_IMAGE}'">
            <div class="cart-item-details">
                <h3 class="cart-item-name">${item.name}</h3>
                <p class="cart-item-price">&#8377;${item.price} &times; ${item.quantity} = &#8377;${item.price * item.quantity}</p>
                <div class="cart-item-controls">
                    <div class="quantity-control">
                        <button class="quantity-btn" onclick="decreaseQuantity(${index})">-</button>
                        <span class="quantity-display">${item.quantity}</span>
                        <button class="quantity-btn" onclick="increaseQuantity(${index})">+</button>
                    </div>
                    <button class="remove-btn" onclick="removeItem(${index})">Remove</button>
                </div>
            </div>
        </div>
    `).join("");
}

function increaseQuantity(index) {
    if (!cart[index]) {
        return;
    }

    cart[index].quantity += 1;
    saveCart();
    displayCart();
    updateSummary();
}

function decreaseQuantity(index) {
    if (!cart[index]) {
        return;
    }

    if (cart[index].quantity > 1) {
        cart[index].quantity -= 1;
        saveCart();
        displayCart();
        updateSummary();
    }
}

function removeItem(index) {
    if (index < 0 || index >= cart.length) {
        return;
    }

    cart.splice(index, 1);
    saveCart();
    displayCart();
    updateSummary();
}

function calculateOrderTotals(items = cart) {
    const subtotal = items.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0);
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    return { subtotal, tax, total };
}

function updateSummary() {
    const totals = calculateOrderTotals();

    const subtotalElement = document.getElementById("subtotal");
    const taxElement = document.getElementById("tax");
    const totalElement = document.getElementById("total");

    if (subtotalElement) {
        subtotalElement.textContent = "\u20B9" + totals.subtotal;
    }

    if (taxElement) {
        taxElement.textContent = "\u20B9" + totals.tax;
    }

    if (totalElement) {
        totalElement.textContent = "\u20B9" + totals.total;
    }
}

function stopOrderTracking() {
    if (orderStatusRef) {
        orderStatusRef.off();
        orderStatusRef = null;
    }
}

function startOrderTracking() {
    const database = getDatabase();

    if (!database || !restaurantId || !currentOrderId) {
        return;
    }

    stopOrderTracking();

    let lastStatus = "pending";
    orderStatusRef = database.ref("orders/" + restaurantId + "/" + currentOrderId);
    customerLog("[Customer] Tracking order:", currentOrderId);

    orderStatusRef.on("value", (snapshot) => {
        if (!snapshot.exists()) {
            return;
        }

        const order = snapshot.val() || {};
        const status = order.status || "pending";

        if (status === lastStatus) {
            return;
        }

        if (status === "confirmed") {
            showToast("Your order has been confirmed. Preparing your food now.", "notification");
        } else if (status === "delivered") {
            showToast("Your order has been delivered. Enjoy your meal.", "notification");
        } else if (status === "paid") {
            showToast("Your bill has been marked as paid.", "notification");
        }

        lastStatus = status;
    }, (error) => {
        console.error("[Customer] Order tracking failed.", error);
    });
}

function confirmOrder() {
    const database = getDatabase();
    const tableInput = document.getElementById("tableNumber");
    const noteInput = document.getElementById("specialInstructions");
    const confirmButton = document.getElementById("confirmOrderBtn");

    if (!database) {
        console.error("[Customer] Firebase database is not ready.");
        showToast("Database connection is not ready. Please refresh the page.", "notification");
        return;
    }

    if (!restaurantId) {
        showToast("Restaurant not identified. Please scan the QR code again.", "notification");
        return;
    }

    if (cart.length === 0) {
        showToast("Your cart is empty. Please add items first.", "notification");
        return;
    }

    const tableNumberRaw = (tableInput?.value || "").trim();
    const tableNumber = parseInt(tableNumberRaw, 10);

    if (!tableNumberRaw || isNaN(tableNumber)) {
        showToast("Please enter a table number.", "notification");
        tableInput?.focus();
        return;
    }

    if (validTables.length === 0) {
        showToast("Table data not loaded yet. Please wait a moment and try again.", "notification");
        return;
    }

    if (!validTables.includes(String(tableNumber))) {
        showToast("Invalid table number. Available tables: " + validTables.sort((a, b) => Number(a) - Number(b)).join(", "), "notification");
        tableInput?.focus();
        return;
    }

    const note = (noteInput?.value || "").trim();
    const totals = calculateOrderTotals();
    const orderRef = database.ref("orders/" + restaurantId).push();
    currentOrderId = orderRef.key;

    const orderPayload = {
        items: cart.map((item) => ({
            id: item.id,
            name: item.name,
            price: Number(item.price) || 0,
            quantity: Number(item.quantity) || 1
        })),
        total: totals.total,
        subtotal: totals.subtotal,
        tax: totals.tax,
        tableNumber,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        restaurantId
    };

    if (note) {
        orderPayload.note = note;
    }

    if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.textContent = "Placing Order...";
    }

    customerLog("[Customer] Creating order", orderPayload);

    orderRef.set(orderPayload)
        .then(() => {
            appStorage.set("lastOrder", JSON.stringify({
                tableNumber: String(tableNumber),
                orderId: currentOrderId,
                restaurantId
            }));

            cart = [];
            appStorage.remove("cart");
            updateCartCount();

            if (tableInput) {
                tableInput.value = "";
            }

            if (noteInput) {
                noteInput.value = "";
            }

            const successModal = document.getElementById("successModal");
            if (successModal) {
                successModal.classList.add("show");
            }

            displayCart();
            updateSummary();
            startOrderTracking();
            showToast("Order placed successfully.");
        })
        .catch((error) => {
            console.error("[Customer] Failed to place order.", error);
            showToast("Failed to place order. Please try again.", "notification");
        })
        .finally(() => {
            if (confirmButton) {
                confirmButton.disabled = false;
                confirmButton.textContent = "Place Order";
            }
        });
}

document.addEventListener("DOMContentLoaded", () => {
    restaurantId = getCurrentRestaurantId();

    const reviewLink = document.getElementById("reviewLink");
    if (reviewLink) {
        reviewLink.href = restaurantId
            ? ("review.html?restaurant=" + encodeURIComponent(restaurantId))
            : "review.html";
    }

    loadCart();
    loadRestaurantName();
    setupMenuListener();
    loadTables();
});

window.filterMenuGlobal = filterMenuGlobal;
window.goToCheckout = goToCheckout;
window.goBackToMenu = goBackToMenu;
window.goBackToMenuFromModal = goBackToMenuFromModal;
window.addToCart = addToCart;
window.increaseQuantity = increaseQuantity;
window.decreaseQuantity = decreaseQuantity;
window.removeItem = removeItem;
window.confirmOrder = confirmOrder;
window.loadTables = loadTables;
