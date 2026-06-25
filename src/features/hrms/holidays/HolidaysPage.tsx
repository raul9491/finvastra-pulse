import { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Trash2 } from 'lucide-react';
import { writeBatch, collection, doc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useHolidays, addHoliday, deleteHoliday, seedHolidays2026, resetHolidays2026 } from '../hooks/useHolidays';
import type { Holiday } from '../../../types';

type HolidayType = Holiday['type'];

const TYPE_STYLES: Record<HolidayType, { label: string; bg: string; text: string }> = {
  national: { label: 'National',  bg: '#DBEAFE', text: '#1D4ED8' },
  regional: { label: 'Regional',  bg: '#FEF3C7', text: '#92400E' },
  optional: { label: 'Optional',  bg: 'var(--shell-hover-hard)', text: 'var(--text-muted)' },
};

const YEAR_OPTIONS = [2025, 2026, 2027];

export function HolidaysPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [selectedYear, setSelectedYear] = useState(2026);
  const { holidays, loading } = useHolidays(selectedYear);

  // Add-holiday form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<HolidayType>('national');
  const [submitting, setSubmitting] = useState(false);

  // Copy-to-next-year state
  const [copying, setCopying] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-seed 2026 data for admins when the component mounts
  useEffect(() => {
    if (isAdmin) {
      seedHolidays2026().catch(() => {
        // Seed failure is non-fatal — collection may already exist
      });
    }
  }, [isAdmin]);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newName.trim()) return;
    setSubmitting(true);
    try {
      await addHoliday({
        date: newDate,
        name: newName.trim(),
        type: newType,
        year: selectedYear,
      });
      setNewDate('');
      setNewName('');
      setNewType('national');
      setShowAddForm(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset2026 = async () => {
    const confirmed = window.confirm(
      'This will delete all existing 2026 holidays and restore the official Finvastra calendar. Continue?',
    );
    if (!confirmed) return;
    setResetting(true);
    try {
      await resetHolidays2026();
    } finally {
      setResetting(false);
    }
  };

  const handleCopyToNextYear = async () => {
    const nextYear = selectedYear + 1;
    const confirmed = window.confirm(
      `Copy all ${holidays.length} holidays to ${nextYear}? You can edit them after.`,
    );
    if (!confirmed) return;

    setCopying(true);
    try {
      const batch = writeBatch(db);
      for (const h of holidays) {
        const newRef = doc(collection(db, 'holidays'));
        // Advance the date by exactly one year — keep month/day
        const [, month, day] = h.date.split('-');
        batch.set(newRef, {
          date: `${nextYear}-${month}-${day}`,
          name: h.name,
          type: h.type,
          year: nextYear,
        });
      }
      await batch.commit();
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2
            className="text-3xl mb-1"
            style={{
              fontFamily: '"Fraunces", Georgia, serif',
              fontStyle: 'italic',
              fontWeight: 300,
              color: 'var(--text-primary)',
            }}
          >
            Holidays
          </h2>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Company and national holiday calendar
          </p>
        </div>

        {/* Year selector */}
        <div className="flex items-center gap-3">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
            style={{
              borderColor: 'var(--shell-border)',
              color: 'var(--text-primary)',
              backgroundColor: 'var(--glass-panel-bg)',
            }}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {isAdmin && (
            <button
              onClick={() => setShowAddForm((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ backgroundColor: '#0B1538', color: '#FFFFFF' }}
            >
              <Plus size={14} />
              Add Holiday
            </button>
          )}
        </div>
      </div>

      {/* Add-holiday form */}
      {isAdmin && showAddForm && (
        <div
          className="rounded-2xl p-5"
          style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
        >
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            New Holiday — {selectedYear}
          </h3>
          <form onSubmit={handleAddHoliday} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Date</label>
              <input
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div className="flex flex-col gap-1 flex-1 min-w-45">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Republic Day"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as HolidayType)}
                className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2"
                style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)', backgroundColor: 'var(--glass-panel-bg)' }}
              >
                <option value="national">National</option>
                <option value="regional">Regional</option>
                <option value="optional">Optional</option>
              </select>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="text-sm font-medium px-4 py-1.5 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: '#C9A961', color: '#0B1538' }}
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-sm px-4 py-1.5 rounded-lg transition-colors hover:bg-(--glass-panel-bg)"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Holiday table */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--glass-panel-bg)', border: '1px solid var(--shell-border)' }}
      >
        {loading ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            Loading holidays…
          </div>
        ) : holidays.length === 0 ? (
          <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            No holidays found for {selectedYear}.
            {isAdmin && ' Click "Add Holiday" to get started.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--shell-border)', backgroundColor: 'var(--glass-panel-bg)' }}>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Date
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Holiday
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Type
                </th>
                {isAdmin && (
                  <th className="px-5 py-3 w-12" />
                )}
              </tr>
            </thead>
            <tbody>
              {holidays.map((h, idx) => {
                const typeStyle = TYPE_STYLES[h.type];
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={h.id}
                    style={{
                      backgroundColor: isEven ? 'transparent' : 'var(--shell-hover-soft)',
                      borderBottom: idx < holidays.length - 1 ? '1px solid var(--shell-border)' : 'none',
                    }}
                  >
                    <td className="px-5 py-3 font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {format(parseISO(h.date), 'dd MMM yyyy')}
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-primary)' }}>
                      {h.name}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: typeStyle.bg, color: typeStyle.text }}
                      >
                        {typeStyle.label}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3">
                        <button
                          onClick={() => deleteHoliday(h.id)}
                          className="transition-opacity hover:opacity-70"
                          style={{ color: 'var(--text-muted)' }}
                          title="Delete holiday"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex justify-between items-center">
          {selectedYear === 2026 && (
            <button
              onClick={handleReset2026}
              disabled={resetting}
              className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors hover:bg-red-50 disabled:opacity-50"
              style={{ borderColor: '#FECACA', color: '#DC2626' }}
            >
              {resetting ? 'Resetting…' : 'Reset to official 2026 calendar'}
            </button>
          )}
          {!selectedYear || selectedYear !== 2026 ? <div /> : null}
          {holidays.length > 0 && (
            <button
              onClick={handleCopyToNextYear}
              disabled={copying}
              className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors hover:bg-(--glass-panel-bg) disabled:opacity-50"
              style={{ borderColor: 'var(--shell-border)', color: 'var(--text-primary)' }}
            >
              {copying ? 'Copying…' : `Copy all to ${selectedYear + 1}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
