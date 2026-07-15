import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import {
  initializeFirestore,
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
export const storage = getStorage(app);

// Cache: the DEFAULT in-memory cache (no IndexedDB persistence).
// We previously used persistentLocalCache + persistentMultipleTabManager (offline +
// multi-tab), but that exact config is the documented trigger for Firestore's
// "INTERNAL ASSERTION FAILED: Unexpected state (b815)" crash in the offline-cache /
// listener layer — it surfaced as a wall of red on forms (e.g. Apply for Leave).
// The memory cache never touches IndexedDB, so that assertion can't occur. Trade-off:
// no offline Firestore reads — acceptable for an online internal tool on the uncapped
// `pulse` DB (the PWA shell + live listeners still work; reads just aren't disk-cached).
const useEmulator = import.meta.env['VITE_USE_EMULATOR'] === 'true';
export const db = useEmulator
  ? initializeFirestore(app, { ignoreUndefinedProperties: true })
  : initializeFirestore(
      app,
      // Strip `undefined` field values instead of throwing — many forms build
      // patch objects with `value || undefined` for optional fields.
      { ignoreUndefinedProperties: true },
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
