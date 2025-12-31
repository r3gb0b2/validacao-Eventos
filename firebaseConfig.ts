
import { initializeApp, getApp, getApps } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
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

// Inicialização ultra-simples
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const firestoreInstance = getFirestore(app);

export const getFunctionsInstance = (): Functions | null => {
    try {
        return getFunctions(app, "us-central1");
    } catch (e) {
        return null;
    }
};

// DESATIVADO: enableIndexedDbPersistence (Causa crash em muitos WebViews Android via protocolo file://)
export const getDb = (): Promise<Firestore> => {
    return Promise.resolve(firestoreInstance);
};
