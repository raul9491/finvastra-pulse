import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  CACHE_SIZE_UNLIMITED,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  addDoc,
  writeBatch,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { useState, useEffect } from 'react';
import firebaseConfig from '@/firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const auth = getAuth(app);

// Emulators use the default database (no persistence — emulator data is ephemeral anyway).
// Production uses the named database with IndexedDB persistence so reads survive offline
// and writes are queued and replayed on reconnect.
const useEmulator = import.meta.env['VITE_USE_EMULATOR'] === 'true';
export const db = useEmulator
  ? getFirestore(app)
  : initializeFirestore(
      app,
      { localCache: persistentLocalCache({ cacheSizeBytes: CACHE_SIZE_UNLIMITED, tabManager: persistentMultipleTabManager() }) },
      firebaseConfig.firestoreDatabaseId,
    );

if (useEmulator) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// Error handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  // Intentionally not logging PII — errInfo is surfaced to error tracking only
  throw new Error(JSON.stringify(errInfo));
}

// Re-export Firestore helpers so callers don't need a second firebase import
export {
  doc, getDoc, setDoc, serverTimestamp, collection, query, where,
  getDocs, onSnapshot, updateDoc, deleteDoc, addDoc, writeBatch,
};

// ─── Online / offline status hook ────────────────────────────────────────────
// Returns true when the browser reports network connectivity. Components can
// use this to show an "offline" badge without polling Firestore.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleOnline  = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return online;
}
