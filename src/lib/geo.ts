import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

// ─── Geolocation helpers (field ops: geofenced attendance + meeting capture) ──

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

/** Promise wrapper over the browser geolocation API with readable errors. */
export function getCurrentPosition(timeoutMs = 15000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not supported on this device/browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Location permission denied. Allow location access for Pulse in your browser settings and try again.'));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('Could not get your location in time. Move to an open area and try again.'));
        } else {
          reject(new Error('Could not determine your location. Check that GPS/location is on.'));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/** Great-circle distance in metres (haversine — deterministic math). */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

export function mapsLink(p: { lat: number; lng: number }): string {
  return `https://maps.google.com/?q=${p.lat},${p.lng}`;
}

// ─── Attendance geofence config (/app_config/attendance_geofence) ─────────────
// Admin/HR-set office location + radius. When enabled, clock in/out is only
// allowed within radiusMeters of the office.

export interface GeofenceConfig {
  enabled: boolean;
  lat: number;
  lng: number;
  radiusMeters: number;
  label?: string;            // e.g. "Finvastra HQ, Hyderabad"
  // Field RMs / telecallers who work outside the office. They can clock in/out
  // from anywhere, but their GPS point is REQUIRED and stored on the record so
  // managers can see where each field clock-in happened.
  exemptUids?: string[];
  updatedBy?: string;
  updatedAt?: unknown;
}

const GEOFENCE_REF = () => doc(db, 'app_config', 'attendance_geofence');

export function useGeofenceConfig(): { config: GeofenceConfig | null; loading: boolean } {
  const [config, setConfig] = useState<GeofenceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    return onSnapshot(GEOFENCE_REF(), (snap) => {
      setConfig(snap.exists() ? (snap.data() as GeofenceConfig) : null);
      setLoading(false);
    }, () => { setConfig(null); setLoading(false); });
  }, []);
  return { config, loading };
}

export async function saveGeofenceConfig(
  cfg: Omit<GeofenceConfig, 'updatedAt'>,
): Promise<void> {
  await setDoc(GEOFENCE_REF(), { ...cfg, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Enforce the geofence for a clock action. Returns the captured position
 * (to store on the attendance record) or throws a human-readable error.
 *
 * - Geofence disabled/unset → best-effort capture, never blocks.
 * - Enabled + uid in exemptUids (field RM) → no distance check, but the GPS
 *   point is REQUIRED (location denied = blocked) so the manager always sees
 *   where the field clock-in happened.
 * - Enabled + everyone else → must be within radiusMeters of the office.
 */
export async function enforceGeofence(
  config: GeofenceConfig | null,
  uid?: string,
): Promise<GeoPoint | null> {
  if (!config?.enabled) {
    try { return await getCurrentPosition(6000); } catch { return null; }
  }
  const pos = await getCurrentPosition(); // throws readable errors (denied/timeout)
  if (uid && (config.exemptUids ?? []).includes(uid)) {
    return pos; // field worker — clock anywhere, location recorded
  }
  const dist = haversineMeters(pos, config);
  if (dist > config.radiusMeters) {
    throw new Error(
      `You are ${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + ' m'} from ${config.label || 'the office'} — clock in/out only works within ${config.radiusMeters} m of the office.`,
    );
  }
  return pos;
}
