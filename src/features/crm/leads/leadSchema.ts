import { z } from 'zod';
import { PAN_REGEX } from './panUtils';

export const leadSchema = z.object({
  displayName: z.string().min(2, 'Name must be at least 2 characters').max(200),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number starting with 6–9'),
  email: z
    .string()
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email format'),
  panRaw: z
    .string()
    .refine((v) => v === '' || PAN_REGEX.test(v), 'Invalid PAN — expected format: ABCDE1234F'),
  source: z.enum(['website', 'instagram', 'facebook', 'walkin', 'referral', 'broker']),
  referrerName: z.string().max(200).optional(),
  primaryOwnerId: z.string().min(1, 'Assign a primary relationship manager'),
  consentGiven: z.boolean().refine((v) => v === true, {
    message: 'Customer consent is required to create this record',
  }),
  consentMethod: z.enum(['verbal', 'written', 'digital']),
});

export type LeadFormValues = z.infer<typeof leadSchema>;
