
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence, Firestore } from "firebase/firestore";
import { getFunctions, Functions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyDsi6VpfhLQW8UWgAp5c4TRV7vqOkDyauU",
  authDomain: "stingressos-e0a5f.firebaseapp.com",
  projectId: "stingressos-e0a5f",
  storageBucket: "stingressos-e0a5f.firebasestorage.app",
  messagingSenderId: "424186734009",
  appId: "1:424186734009:web:c4f601ce043761cd784268",
  measurementId: "G-M30E0D9TP2"
};

// Inicialização direta e segura
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const firestoreInstance = getFirestore(app);

export const getFunctionsInstance = (): Functions | null => {
    try {
        return getFunctions(app, "us-central1");
    } catch (e) {
        return null;
    }
};

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

export const getDb = (): Promise<Firestore> => {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbInitializationPromise) return dbInitializationPromise;

    // Tenta persistência mas não trava se falhar (comum em APKs)
    dbInitializationPromise = enableIndexedDbPersistence(firestoreInstance)
        .then(() => {
            dbInstance = firestoreInstance;
            return dbInstance;
        })
        .catch(() => {
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};
