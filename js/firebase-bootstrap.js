if (window.firebaseConfig) {
    window.firebase.initializeApp(window.firebaseConfig);
    window.auth = window.firebase.auth();
    window.db = window.firebase.firestore();
} else {
    console.warn("Firebase runtime config is missing. App initialization was skipped.");
}
