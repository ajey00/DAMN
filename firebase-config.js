(function initializeSharedFirebase() {
    const firebaseConfig = {
        apiKey: "AIzaSyCbTJiRIFQeucMAw7FU8SpL4DJYLo1Ra3w",
        authDomain: "smart-resturant-d143c.firebaseapp.com",
        databaseURL: "https://smart-resturant-d143c-default-rtdb.firebaseio.com",
        projectId: "smart-resturant-d143c",
        storageBucket: "smart-resturant-d143c.firebasestorage.app",
        messagingSenderId: "104077753150",
        appId: "1:104077753150:web:21e0e7ae677e9042c9ca6f",
        measurementId: "G-ZETV2PHCF5"
    };

    if (!window.firebase) {
        console.error("[Firebase] SDK not loaded. Make sure firebase-app.js and firebase-database.js load before firebase-config.js.");
        return;
    }

    const app = firebase.apps && firebase.apps.length
        ? firebase.app()
        : firebase.initializeApp(firebaseConfig);

    window.firebaseConfig = firebaseConfig;
    window.firebaseApp = app;
    window.db = firebase.database();

    console.log("[Firebase] Connected to Realtime Database");
})();
