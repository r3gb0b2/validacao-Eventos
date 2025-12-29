
import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence, Firestore } from "firebase/firestore";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDsi6VpfhLQW8UWgAp5c4TRV7vqOkDyauU",
  authDomain: "stingressos-e0a5f.firebaseapp.com",
  projectId: "stingressos-e0a5f",
  storageBucket: "stingressos-e0a5f.firebasestorage.app",
  messagingSenderId: "424186734009",
  appId: "1:424186734009:web:c4f601ce043761cd784268",
  measurementId: "G-M30E0D9TP2"
};

// Inicializa Firebase
const app: FirebaseApp = initializeApp(firebaseConfig);

// Inicializa Firestore
const firestoreInstance: Firestore = getFirestore(app);

let dbInstance: Firestore | null = null;
let dbInitializationPromise: Promise<Firestore> | null = null;

/**
 * Garante que o Firebase seja inicializado apenas uma vez e com persistência offline.
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
                console.warn('Persistência falhou: multiplas abas abertas.');
            } else if (err.code === 'unimplemented') {
                console.warn('O navegador não suporta persistência offline.');
            }
            dbInstance = firestoreInstance;
            return dbInstance;
        });
    
    return dbInitializationPromise;
};
