
import { initializeApp, FirebaseApp, getApp, getApps } from "firebase/app";
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

console.log("[FIREBASE] Iniciando configuração...");

let app: FirebaseApp;
try {
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
        console.log("[FIREBASE] App inicializado com sucesso.");
    } else {
        app = getApp();
        console.log("[FIREBASE] App existente recuperado.");
    }
} catch (e) {
    console.error("[FIREBASE] Falha fatal na inicialização:", e);
    // Tenta recuperar qualquer instância se falhar
    app = getApp();
}

const firestoreInstance: Firestore = getFirestore(app);

export const getFunctionsInstance = (): Functions | null => {
    try {
        return getFunctions(app, "us-central1");
    } catch (e) {
        console.warn("[FIREBASE] Functions indisponível no WebView atual.");
        return null;
    }
};

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

export const getDb = (): Promise<Firestore> => {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbInitializationPromise) return dbInitializationPromise;

    console.log("[FIREBASE] Ativando persistência offline...");
    dbInitializationPromise = enableIndexedDbPersistence(firestoreInstance)
        .then(() => {
            console.log("[FIREBASE] Persistência OK.");
            dbInstance = firestoreInstance;
            return dbInstance;
        })
        .catch((err: any) => {
            console.warn("[FIREBASE] Persistência falhou (esperado em WebViews limitados):", err.code);
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};
