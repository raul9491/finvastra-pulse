import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { useAuth } from '../../../auth/AuthContext';
import { useDocumentTypes } from '../../hooks/useDocumentChecklist';
import { useOpportunityTypes } from '../../hooks/useOpportunities';
import { getMaskedPan } from '../../leads/panUtils';
import { generateApplicationPacket } from '../../../../lib/pdfApplicationPacket';
import type { BankSubmission, Lead, Opportunity, Provider } from '../../../../types';

interface Props {
  lead: Lead;
  opportunity: Opportunity;
  submission: BankSubmission;
  provider: Provider | undefined;
  leadId: string;
  oppId: string;
  subId: string;
  /** Called after a successful PDF generation so the caller can write an activity log entry. */
  onActivityLogged: () => void;
}

export function ApplicationPacketGenerator({
  lead,
  opportunity,
  submission,
  provider,
  subId,
  onActivityLogged,
}: Props) {
  const { user, profile } = useAuth();
  const docTypes = useDocumentTypes();
  const { types } = useOpportunityTypes();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Resolve the opportunity type config that matches the current product
  const typeConfig = useMemo(
    () => types.find((t) => t.name === opportunity.product),
    [types, opportunity.product],
  );

  // Merge required + conditional documents (mirroring useDocumentChecklist logic)
  const resolvedDocs = useMemo(() => {
    const base = typeConfig?.requiredDocuments ?? [];
    const extras: string[] = [];
    for (const rule of typeConfig?.conditionalDocuments ?? []) {
      if (opportunity.customFields?.[rule.when.field] === rule.when.equals) {
        extras.push(...rule.addDocuments);
      }
    }
    return [...new Set([...base, ...extras])];
  }, [typeConfig, opportunity.customFields]);

  const totalDocs = resolvedDocs.length;
  const doneDocs = resolvedDocs.filter((id) => {
    const s = submission.documentStatus?.[id];
    return s === 'collected' || s === 'submitted' || s === 'accepted';
  }).length;

  // When no documents are configured for the product, treat completeness as 100%
  // so the button is still usable (some products may not require docs).
  const completeness = totalDocs > 0 ? doneDocs / totalDocs : 1;
  const canGenerate = completeness >= 0.8;

  const handleGenerate = async () => {
    if (!user) return;
    setGenerating(true);
    setError('');
    try {
      // Build document status rows in the same order as resolvedDocs
      const documentStatuses = resolvedDocs.map((docId) => {
        const dt = docTypes.find((d) => d.id === docId);
        // Find the latest log entry for this document to surface the date
        const log = (submission.documentStatusLog ?? []) as Array<{
          docTypeId: string;
          to: string;
          at: string;
        }>;
        const latest = log
          .filter((e) => e.docTypeId === docId)
          .sort((a, b) => b.at.localeCompare(a.at))[0];

        return {
          label: dt?.label ?? docId,
          status: submission.documentStatus?.[docId] ?? 'pending',
          collectedAt: latest?.at ? format(new Date(latest.at), 'dd MMM yyyy') : undefined,
        };
      });

      await generateApplicationPacket({
        lead: {
          displayName:      lead.displayName,
          phone:            lead.phone,
          email:            lead.email,
          // panRaw goes to the bank PDF — legal requirement for loan processing.
          // getMaskedPan is used in panMasked only as a UI-safe fallback label.
          panRaw:           lead.panRaw,
          panMasked:        getMaskedPan(lead),
          consentMethod:    lead.consentMethod,
          consentTimestamp: lead.consentTimestamp,
        },
        opportunity: {
          product:         opportunity.product,
          dealSize:        opportunity.dealSize,
          customFields:    opportunity.customFields,
          opportunityType: opportunity.opportunityType,
        },
        submission: {
          providerId:       submission.providerId,
          requestedAmount:  submission.requestedAmount,
          sanctionedAmount: submission.sanctionedAmount,
          interestRate:     submission.interestRate,
          tenureMonths:     submission.tenureMonths,
          submittedAt:      submission.submittedAt,
        },
        providerName: provider?.name ?? submission.providerId,
        rmName:       profile?.displayName ?? user.uid,
        documentStatuses,
        generatedBy:  user.uid,
        generatedAt:  new Date(),
        // Use the last 8 chars of the submission ID as a short human-readable ref
        referenceId:  subId.slice(-8).toUpperCase(),
      });

      // Notify the parent so it can write an activity log entry.
      // We don't do Firestore writes here — pdfApplicationPacket.ts is a pure utility.
      onActivityLogged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const pctLabel =
    totalDocs > 0 ? `${doneDocs}/${totalDocs} documents ready` : 'No documents configured';

  return (
    <div>
      {!canGenerate && totalDocs > 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {pctLabel}. Minimum 80% required to generate packet.
        </p>
      )}

      <button
        type="button"
        onClick={handleGenerate}
        disabled={!canGenerate || generating}
        className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg border border-(--shell-border-mid) hover:bg-(--shell-hover-soft) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ color: 'var(--text-primary)' }}
        title={
          !canGenerate && totalDocs > 0
            ? `${pctLabel} — need 80% to generate`
            : 'Download application packet PDF'
        }
      >
        {generating ? '⏳ Generating…' : '📄 Generate Application Packet'}
      </button>

      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
}
