
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

// Inicializa o App de forma segura
let app: FirebaseApp;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

const firestoreInstance: Firestore = getFirestore(app);

// Exporta funções de forma que não quebrem se o módulo não carregar
export const getFunctionsInstance = (): Functions | null => {
    try {
        return getFunctions(app, "us-central1");
    } catch (e) {
        console.error("Firebase Functions não disponível:", e);
        return null;
    }
};

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

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
                console.warn('Persistence falhou: múltiplas abas abertas.');
            } else if (err.code === 'unimplemented') {
                console.warn('Navegador não suporta persistence.');
            }
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};
