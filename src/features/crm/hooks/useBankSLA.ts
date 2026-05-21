import { useMemo } from 'react';
import type { BankSubmission, BankSubmissionStatus } from '../../../types';

interface SLAConfig {
  submitted_to_in_review: number;
  in_review_to_sanctioned: number;
  sanctioned_to_disbursed: number;
}

const DEFAULT_SLA: SLAConfig = {
  submitted_to_in_review: 3,
  in_review_to_sanctioned: 7,
  sanctioned_to_disbursed: 5,
};

// Maps the *current* status to the SLA window that applies.
// e.g. if the submission is now "in_review", the clock we care about is
// how long it took to get from "submitted" to "in_review".
const TRANSITION_MAP: Partial<Record<BankSubmissionStatus, keyof SLAConfig>> = {
  in_review:  'submitted_to_in_review',
  sanctioned: 'in_review_to_sanctioned',
  disbursed:  'sanctioned_to_disbursed',
};

export function useBankSLA(
  submission: BankSubmission,
  providerSLA?: Partial<SLAConfig>,
): {
  daysInCurrentStatus: number;
  maxDays: number;
  isBreached: boolean;
  tooltip: string;
} {
  return useMemo(() => {
    const sla: SLAConfig = { ...DEFAULT_SLA, ...providerSLA };
    const transitionKey = TRANSITION_MAP[submission.status];

    // Statuses with no tracked window (preparing, rejected) return neutral values
    if (!transitionKey) {
      return { daysInCurrentStatus: 0, maxDays: 0, isBreached: false, tooltip: '' };
    }

    const maxDays = sla[transitionKey];
    const history = submission.statusHistory ?? [];

    // Most recent entry that transitioned INTO the current status
    const entry = history
      .filter((h) => h.to === submission.status)
      .sort((a, b) => b.at.localeCompare(a.at))[0];

    if (!entry) {
      return { daysInCurrentStatus: 0, maxDays, isBreached: false, tooltip: '' };
    }

    const daysInCurrentStatus = (Date.now() - new Date(entry.at).getTime()) / 86400000;
    const isBreached = daysInCurrentStatus > maxDays;
    const tooltip = `In "${submission.status}" for ${Math.floor(daysInCurrentStatus)} days. Typical: ${maxDays} days.`;

    return {
      daysInCurrentStatus: Math.floor(daysInCurrentStatus),
      maxDays,
      isBreached,
      tooltip,
    };
  }, [submission, providerSLA]);
}
