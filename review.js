const REVIEW_DEBUG = true;

function reviewLog(...args) {
    if (REVIEW_DEBUG) {
        console.log(...args);
    }
}

const reviewStorage = (() => {
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

let selectedReviewRating = 0;
let autoOrderId = "";
let autoTableNumber = "";
let reviewRestaurantId = "";

const RATING_LABELS = ["", "Terrible", "Poor", "Average", "Good", "Excellent"];

function getReviewDatabase() {
    return window.db || null;
}

function showReviewToast(message, type) {
    const toast = document.getElementById("reviewToast");
    if (!toast) {
        return;
    }

    toast.textContent = message;
    toast.className = "review-toast" + (type === "error" ? " error" : "");
    toast.classList.add("show");

    window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

function highlightReviewStars(count) {
    document.querySelectorAll("#starRating .star").forEach((star) => {
        const value = parseInt(star.getAttribute("data-value"), 10);
        star.classList.toggle("active", value <= count);
    });
}

function setReviewRating(value) {
    selectedReviewRating = value;
    highlightReviewStars(value);
    const ratingText = document.getElementById("ratingText");
    if (ratingText) {
        ratingText.textContent = RATING_LABELS[value] || "Tap a star to rate";
    }
}

function hoverStars(count) {
    highlightReviewStars(count);
    const ratingText = document.getElementById("ratingText");
    if (ratingText) {
        ratingText.textContent = RATING_LABELS[count] || "Tap a star to rate";
    }
}

function resetStarHover() {
    highlightReviewStars(selectedReviewRating);
    const ratingText = document.getElementById("ratingText");
    if (ratingText) {
        ratingText.textContent = selectedReviewRating > 0
            ? (RATING_LABELS[selectedReviewRating] || "Tap a star to rate")
            : "Tap a star to rate";
    }
}

function autoFillFromLastOrder() {
    try {
        const lastOrder = JSON.parse(reviewStorage.get("lastOrder") || "null");

        if (!lastOrder) {
            return;
        }

        if (lastOrder.restaurantId && !reviewRestaurantId) {
            reviewRestaurantId = lastOrder.restaurantId;
            reviewStorage.set("currentRestaurant", reviewRestaurantId);
        }

        if (lastOrder.tableNumber) {
            autoTableNumber = String(lastOrder.tableNumber);
            const reviewTable = document.getElementById("reviewTable");
            if (reviewTable) {
                reviewTable.value = autoTableNumber;
                reviewTable.setAttribute("readonly", "readonly");
            }
        }

        if (lastOrder.orderId) {
            autoOrderId = String(lastOrder.orderId);
        }
    } catch (error) {
        console.warn("[Review] Unable to read lastOrder from sessionStorage.", error);
    }
}

function resetReviewForm() {
    const reviewName = document.getElementById("reviewName");
    const reviewTable = document.getElementById("reviewTable");
    const reviewFeedback = document.getElementById("reviewFeedback");
    const ratingText = document.getElementById("ratingText");

    if (reviewName) {
        reviewName.value = "";
    }

    if (reviewFeedback) {
        reviewFeedback.value = "";
    }

    if (reviewTable) {
        reviewTable.value = "";
        reviewTable.removeAttribute("readonly");
    }

    selectedReviewRating = 0;
    highlightReviewStars(0);

    if (ratingText) {
        ratingText.textContent = "Tap a star to rate";
    }
}

function submitReview() {
    const database = getReviewDatabase();
    const name = (document.getElementById("reviewName")?.value || "").trim();
    const table = (document.getElementById("reviewTable")?.value || "").trim();
    const message = (document.getElementById("reviewFeedback")?.value || "").trim();
    const rating = selectedReviewRating;
    const submitButton = document.getElementById("reviewSubmitBtn");

    if (!database) {
        console.error("[Review] Firebase database is not ready.");
        showReviewToast("Database connection is not ready. Please refresh the page.", "error");
        return;
    }

    if (!reviewRestaurantId) {
        console.error("[Review] Missing restaurant ID while submitting feedback.");
        showReviewToast("Restaurant not identified. Please return to the menu and try again.", "error");
        return;
    }

    if (rating === 0 && !message) {
        showReviewToast("Please provide a rating or feedback.", "error");
        return;
    }

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "Submitting...";
    }

    const feedbackEntry = {
        rating,
        message,
        name: name || "Anonymous",
        tableNumber: table || autoTableNumber || "",
        orderId: autoOrderId || "",
        createdAt: new Date().toISOString()
    };

    reviewLog("[Review] Submitting feedback", feedbackEntry);

    database.ref("feedbacks/" + reviewRestaurantId).push(feedbackEntry)
        .then(() => {
            showReviewToast("Feedback submitted successfully. Thank you!");
            reviewStorage.remove("lastOrder");
            autoOrderId = "";
            autoTableNumber = "";
            resetReviewForm();

            window.setTimeout(() => {
                window.location.href = "index.html" + (reviewRestaurantId ? "?restaurant=" + encodeURIComponent(reviewRestaurantId) : "");
            }, 1500);
        })
        .catch((error) => {
            console.error("[Review] Feedback submission failed.", error);
            showReviewToast("Submission failed. Please try again.", "error");

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Submit Feedback";
            }
        });
}

document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(window.location.search);
    reviewRestaurantId = params.get("restaurant") || reviewStorage.get("currentRestaurant") || "";

    if (reviewRestaurantId) {
        reviewStorage.set("currentRestaurant", reviewRestaurantId);
    }

    reviewLog("[Review] Restaurant ID:", reviewRestaurantId || "not set");
    autoFillFromLastOrder();
    resetStarHover();
});

window.setReviewRating = setReviewRating;
window.hoverStars = hoverStars;
window.resetStarHover = resetStarHover;
window.submitReview = submitReview;
