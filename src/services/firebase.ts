import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};
if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) throw new Error('Firebase is not configured. Copy .env.example to .env and add the Firebase web configuration.');
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true' && import.meta.env.VITE_USE_EMULATORS !== 'true') {
    void import('firebase/analytics').then(async ({ getAnalytics, isSupported }) => {
        if (await isSupported()) getAnalytics(app);
    }).catch(() => console.warn('Analytics is unavailable in this browser.'));
}
export default app;
