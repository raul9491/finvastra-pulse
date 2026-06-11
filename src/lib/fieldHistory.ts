import {
  doc, collection, writeBatch, serverTimestamp,
  type DocumentReference, type WriteBatch,
} from 'firebase/firestore';
import { db } from './firebase';

// Phase P — field-level audit diffs.
// Schema: {parentDoc}/field_history/{fieldName}/changes/{changeId}
// ALWAYS written in the SAME WriteBatch as the parent field update, so the
// diff can never drift from the data.

export interface FieldHistoryActor {
  uid: string;
  name: string;
}

/** Append one field change to the batch (call once per changed field). */
export function appendFieldHistory(
  batch: WriteBatch,
  parentRef: DocumentReference,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  actor: FieldHistoryActor,
  context?: string,
): void {
  // Skip no-ops so the history stays meaningful.
  if (JSON.stringify(oldValue ?? null) === JSON.stringify(newValue ?? null)) return;
  const changeRef = doc(collection(parentRef, 'field_history', field, 'changes'));
  batch.set(changeRef, {
    field,
    oldValue:      oldValue ?? null,
    newValue:      newValue ?? null,
    changedBy:     actor.uid,
    changedByName: actor.name,
    changedAt:     serverTimestamp(),
    context:       context ?? null,
  });
}

/**
 * Convenience: update parent fields + write their history entries atomically.
 * `changes` maps fieldName → { old, new }. Extra (untracked) update keys can be
 * passed via `alsoUpdate` (e.g. updatedAt).
 */
export async function updateWithHistory(
  parentRef: DocumentReference,
  changes: Record<string, { old: unknown; new: unknown }>,
  actor: FieldHistoryActor,
  context?: string,
  alsoUpdate: Record<string, unknown> = {},
): Promise<void> {
  const batch = writeBatch(db);
  const update: Record<string, unknown> = { ...alsoUpdate };
  for (const [field, { old, new: next }] of Object.entries(changes)) {
    update[field] = next;
    appendFieldHistory(batch, parentRef, field, old, next, actor, context);
  }
  batch.update(parentRef, update);
  await batch.commit();
}
