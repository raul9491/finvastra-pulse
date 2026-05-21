import {
  collection, getDocs, writeBatch, doc,
  query, limit,
} from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { SEED_OPPORTUNITY_TYPES, SEED_PROVIDERS } from './seedData';
import { seedDocumentTypes } from './seedDocumentTypes';

export async function seedCrmConfig(): Promise<{ typed: number; providers: number; documentTypes: number }> {
  // document_types seeding is always attempted — the function checks its own guard
  const documentTypes = await seedDocumentTypes();

  // Only seed opportunity_types and providers if both collections are empty
  const existingTypes     = await getDocs(query(collection(db, 'opportunity_types'), limit(1)));
  const existingProviders = await getDocs(query(collection(db, 'providers'),         limit(1)));

  if (!existingTypes.empty && !existingProviders.empty) {
    return { typed: 0, providers: 0, documentTypes };
  }

  const batch = writeBatch(db);

  let typed = 0;
  if (existingTypes.empty) {
    for (const t of SEED_OPPORTUNITY_TYPES) {
      batch.set(doc(collection(db, 'opportunity_types')), t);
      typed++;
    }
  }

  let providers = 0;
  if (existingProviders.empty) {
    for (const p of SEED_PROVIDERS) {
      batch.set(doc(collection(db, 'providers')), p);
      providers++;
    }
  }

  await batch.commit();
  return { typed, providers, documentTypes };
}
