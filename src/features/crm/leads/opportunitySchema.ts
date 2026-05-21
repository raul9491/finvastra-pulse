import { z } from 'zod';

export const opportunitySchema = z.object({
  dealSize: z.number().min(1, 'Enter a deal size greater than 0'),
  ownerId: z.string().min(1, 'Assign this opportunity to an RM'),
  expectedCloseDate: z.string().optional(),
  notes: z.string().max(2000, 'Notes must be under 2000 characters').optional(),
});

export type OpportunityFormValues = z.infer<typeof opportunitySchema>;
