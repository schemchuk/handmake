import type { ContestSubmission } from '../contest';

/** Consented entries only, at most ten in stable submission order; no participant names. */
export interface SubmissionSource {
  listSubmissions(tenantId: string, week: string): Promise<ContestSubmission[]>;
}
