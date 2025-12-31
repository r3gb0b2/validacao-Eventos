
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

// Singleton para o Firebase App
let app: FirebaseApp;
try {
    if (!getApps().length) {
        app = initializeApp(firebaseConfig);
    } else {
        app = getApp();
    }
} catch (e) {
    console.error("Erro ao inicializar Firebase App:", e);
    app = getApp(); // Fallback se já existir mas falhou a detecção
}

const firestoreInstance: Firestore = getFirestore(app);

// Exporta funções de forma que não quebrem se o módulo não carregar (segurança APK)
export const getFunctionsInstance = (): Functions | null => {
    try {
        const currentApp = getApp();
        return getFunctions(currentApp, "us-central1");
    } catch (e) {
        console.error("Firebase Functions não disponível no WebView:", e);
        return null;
    }
};

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

export const getDb = (): Promise<Firestore> => {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbInitializationPromise) return dbInitializationPromise;

    dbInitializationPromise = enableIndexedDbPersistence(firestoreInstance)
        .then(() => {
            dbInstance = firestoreInstance;
            return dbInstance;
        })
        .catch((err: any) => {
            console.warn('Persistence falhou, operando em modo apenas online ou memória:', err.code);
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};
