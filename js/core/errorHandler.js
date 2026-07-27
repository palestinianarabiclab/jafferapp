// Global Error Handler Module
// Provides centralized error handling and user feedback.

class ErrorHandler {
    constructor() {
        this.errors = [];
        this.lastToast = { message: "", at: 0 };
        this.setupGlobalHandlers();
    }

    setupGlobalHandlers() {
        window.addEventListener("error", (event) => {
            this.handleError(event.error, "Unhandled Error");
        });

        window.addEventListener("unhandledrejection", (event) => {
            this.handleError(event.reason, "Unhandled Promise Rejection");
            event.preventDefault();
        });
    }

    handleError(error, context = "") {
        console.error(`[Error${context ? ` - ${context}` : ""}]:`, error);

        this.errors.push({
            timestamp: new Date().toISOString(),
            error: error?.message || String(error),
            context,
            stack: error?.stack,
        });

        this.showUserMessage(error);
        this.logToService(error, context);
    }

    showUserMessage(error) {
        const message = this.getUserFriendlyMessage(error);
        const now = Date.now();
        if (this.lastToast.message === message && now - this.lastToast.at < 4000) {
            return;
        }
        this.lastToast = { message, at: now };

        if (!document.body) return;

        const toast = document.createElement("div");
        toast.className = "error-toast";
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 9999;
            animation: slideIn 0.3s ease-out;
            max-width: 400px;
        `;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = "slideOut 0.3s ease-out";
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    getUserFriendlyMessage(error) {
        const errorMessages = {
            "Missing or insufficient permissions": "You do not have permission to perform this action.",
            "network-request-failed": "Network error. Please check your internet connection and try again.",
            "auth/invalid-email": "The email address is invalid.",
            "auth/user-not-found": "No account was found for this email address.",
            "auth/wrong-password": "The password is incorrect.",
            "auth/email-already-in-use": "This email address is already in use.",
            "auth/weak-password": "Please choose a stronger password.",
            "Google Calendar not connected": "Please connect Google Calendar first.",
            "No user logged in": "Please sign in first.",
            "Teacher not found": "Teacher account not found.",
            "Failed to fetch": "Network error. Please try again.",
        };

        const errorMessage = error?.message || String(error);
        return errorMessages[errorMessage] || "Something went wrong. Please try again.";
    }

    async logToService(error, context) {
        try {
            const user = window.auth?.currentUser || null;
            if (window.db && user) {
                await window.db.collection("errorLogs").add({
                    timestamp: new Date().toISOString(),
                    error: String(error?.message || error || "").slice(0, 1000),
                    context: String(context || "").slice(0, 200),
                    stack: String(error?.stack || "").slice(0, 4000),
                    userAgent: String(navigator.userAgent || "").slice(0, 500),
                    uid: user.uid,
                    email: user.email || "",
                });
            }
        } catch (e) {
            const code = e?.code || "";
            if (code === "permission-denied" || String(e?.message || "").includes("Missing or insufficient permissions")) {
                return;
            }
            console.error("Failed to log error:", e);
        }
    }

    async withRetry(asyncFn, maxRetries = 3, delay = 1000) {
        let lastError;

        for (let i = 0; i < maxRetries; i += 1) {
            try {
                return await asyncFn();
            } catch (error) {
                lastError = error;
                if (i < maxRetries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
                }
            }
        }

        throw lastError;
    }

    async withTimeout(asyncFn, timeoutMs = 10000, timeoutMessage = "The operation timed out.") {
        const task = typeof asyncFn === "function" ? asyncFn() : asyncFn;
        return Promise.race([
            Promise.resolve(task),
            new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
        ]);
    }

    getErrorStats() {
        return {
            total: this.errors.length,
            recent: this.errors.slice(-10),
            byContext: this.errors.reduce((acc, err) => {
                acc[err.context] = (acc[err.context] || 0) + 1;
                return acc;
            }, {}),
        };
    }
}

const errorHandler = new ErrorHandler();

if (typeof module !== "undefined" && module.exports) {
    module.exports = errorHandler;
} else {
    window.errorHandler = errorHandler;
}

const style = document.createElement("style");
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
