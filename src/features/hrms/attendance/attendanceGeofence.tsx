/**
 * The Geofence tab - office location, radius and the field-mode exemption list.
 * 
 * Config lives in app_config/attendance_geofence. Exempt employees (field RMs)
 * clock in from anywhere but their GPS point is still REQUIRED and recorded.
 * 
 * Extracted verbatim from AdminAttendancePage.tsx (2026-07-23).
 */
import { useState, useEffect } from 'react';
import { MultiSearchableSelect } from '../../../components/ui/SearchableSelect';
import { useAllEmployees } from '../../../lib/hooks/useProfile';
import { useGeofenceConfig, saveGeofenceConfig, getCurrentPosition } from '../../../lib/geo';

// ─── Geofence settings — lock clock in/out to the office radius ───────────────
export function GeofenceTab({ adminUid }: { adminUid: string }) {
  const { config, loading } = useGeofenceConfig();
  const { employees } = useAllEmployees();
  const [enabled, setEnabled] = useState(false);
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const [label, setLabel] = useState('');
  const [exemptUids, setExemptUids] = useState<string[]>([]);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Hydrate the form once the config doc arrives
  useEffect(() => {
    if (!config) return;
    setEnabled(config.enabled);
    setLat(String(config.lat ?? ''));
    setLng(String(config.lng ?? ''));
    setRadius(String(config.radiusMeters ?? 200));
    setLabel(config.label ?? '');
    setExemptUids(config.exemptUids ?? []);
  }, [config]);

  const handleUseCurrentLocation = async () => {
    setGettingLoc(true);
    setMessage(null);
    try {
      const pos = await getCurrentPosition();
      setLat(pos.lat.toFixed(6));
      setLng(pos.lng.toFixed(6));
      setMessage({ kind: 'ok', text: `Location captured (±${Math.round(pos.accuracy ?? 0)} m accuracy). Save to apply.` });
    } catch (e) {
      setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Could not get location.' });
    } finally {
      setGettingLoc(false);
    }
  };

  const handleSave = async () => {
    const nLat = parseFloat(lat);
    const nLng = parseFloat(lng);
    const nRadius = parseInt(radius, 10);
    if (enabled && (Number.isNaN(nLat) || Number.isNaN(nLng))) {
      setMessage({ kind: 'err', text: 'Set the office location first — use "Use my current location" while at the office.' });
      return;
    }
    if (enabled && (Number.isNaN(nRadius) || nRadius < 50)) {
      setMessage({ kind: 'err', text: 'Radius must be at least 50 metres (GPS accuracy varies).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await saveGeofenceConfig({
        enabled,
        lat: Number.isNaN(nLat) ? 0 : nLat,
        lng: Number.isNaN(nLng) ? 0 : nLng,
        radiusMeters: Number.isNaN(nRadius) ? 200 : nRadius,
        label: label.trim(),
        exemptUids,
        updatedBy: adminUid,
      });
      setMessage({ kind: 'ok', text: enabled ? 'Geofence saved — clock in/out is now locked to the office.' : 'Saved. Geofence is OFF — employees can clock in from anywhere.' });
    } catch {
      setMessage({ kind: 'err', text: 'Failed to save. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-40 rounded-2xl animate-pulse" style={{ backgroundColor: 'var(--glass-panel-bg)' }} />;
  }

  return (
    <div className="max-w-xl bg-(--glass-panel-bg) rounded-2xl border border-(--shell-border) p-6 space-y-5">
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Office Geofence</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          When enabled, employees can only clock in/out within the set radius of the office.
          The captured GPS point is stored on each attendance record for audit.
        </p>
      </div>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-4 h-4" />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          Lock clock in/out to the office location
        </span>
      </label>

      {/* Office point */}
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Office location</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleUseCurrentLocation}
            disabled={gettingLoc}
            className="text-sm px-4 py-2.5 rounded-lg border font-medium transition-colors hover:bg-(--shell-hover-soft) disabled:opacity-50"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--shell-border-mid)' }}
          >
            {gettingLoc ? 'Getting location…' : '📍 Use my current location'}
          </button>
          {lat && lng && (
            <a
              href={`https://maps.google.com/?q=${lat},${lng}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs no-underline hover:underline"
              style={{ color: '#C9A961' }}
            >
              View on map →
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude"
            className="text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg) font-mono"
            style={{ color: 'var(--text-primary)' }} />
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="Longitude"
            className="text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg) font-mono"
            style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Radius + label */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Radius (metres)</p>
          <input type="number" min={50} value={radius} onChange={(e) => setRadius(e.target.value)}
            className="w-full text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg)"
            style={{ color: 'var(--text-primary)' }} />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Label</p>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Finvastra HQ"
            className="w-full text-sm border border-(--shell-border) rounded-xl px-3 py-2 bg-(--glass-panel-bg)"
            style={{ color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Field RMs — exempt from the radius, location still recorded */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
          Field employees (exempt from radius)
        </p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          RMs who work outside the office can clock in/out from anywhere. Their GPS
          location is still required and recorded on every clock action.
        </p>
        <MultiSearchableSelect
          options={employees
            .filter((e) => e.employeeStatus !== 'inactive')
            .map((e) => ({ value: e.userId, label: e.displayName }))}
          value={exemptUids}
          onChange={setExemptUids}
          placeholder="Select field employees…"
          label="Field employees"
        />
      </div>

      {message && (
        <p className="text-xs px-3 py-2 rounded-lg" style={{
          backgroundColor: message.kind === 'ok' ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)',
          color: message.kind === 'ok' ? '#34d399' : '#f87171',
          border: `1px solid ${message.kind === 'ok' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
        }}>
          {message.text}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: '#0B1538', color: '#C9A961' }}
      >
        {saving ? 'Saving…' : 'Save Geofence'}
      </button>
    </div>
  );
}
