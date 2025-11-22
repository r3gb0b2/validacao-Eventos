import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence, Firestore } from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDsi6VpfhLQW8UWgAp5c4TRV7vqOkDyauU",
  authDomain: "stingressos-e0a5f.firebaseapp.com",
  projectId: "stingressos-e0a5f",
  storageBucket: "stingressos-e0a5f.firebasestorage.app",
  messagingSenderId: "424186734009",
  appId: "1:424186734009:web:c4f601ce043761cd784268",
  measurementId: "G-M30E0D9TP2"
};

// Initialize Firebase
const app: FirebaseApp = initializeApp(firebaseConfig);

// Initialize Firestore
const firestoreInstance: Firestore = getFirestore(app);

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

/**
 * Ensures Firebase is initialized only once and returns a promise that resolves with the Firestore instance.
 * This pattern prevents race conditions by making sure persistence is enabled before the app uses Firestore.
 */
export const getDb = (): Promise<Firestore> => {
    if (dbInstance) {
        return Promise.resolve(dbInstance);
    }
    if (dbInitializationPromise) {
        return dbInitializationPromise;
    }

    dbInitializationPromise = enableIndexedDbPersistence(firestoreInstance)
        .then(() => {
            dbInstance = firestoreInstance;
            return dbInstance;
        })
        .catch((err: any) => {
            if (err.code === 'failed-precondition') {
                console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
            } else if (err.code === 'unimplemented') {
                console.warn('The current browser does not support all of the features required to enable persistence.');
            }
            // Still resolve with the instance even if persistence fails.
            // The app can function, just without full offline support.
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};