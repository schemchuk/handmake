import type { ShowModel } from '../show-config';

/** Adapter inputs are already resolved bytes; opaque references stay outside the provider. */
export interface ShowSourceImage {
  bytes: Uint8Array;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface ShowCall {
  tenantId: string;
  showId: string;
  /** Persist before the call; use to reconcile an uncertain outcome, never blindly retry. */
  attemptId: string;
  providerModel: string;
  promptVersion: string;
}

type Persona = { model: ShowModel; reference: ShowSourceImage };

export type ShowImageRequest = ShowCall & {
  originals: [ShowSourceImage, ...ShowSourceImage[]];
} & (
    { template: 'interior'; persona?: Persona } | { template: 'worn' | 'closeup'; persona: Persona }
  );

export interface ShowVideoRequest extends ShowCall {
  image: ShowSourceImage;
  durationSeconds: number;
}

export interface ShowCallResult<MediaType extends string> {
  /** Provider identity for durable per-call accounting, including rejected output. */
  callId: string;
  model: string;
  promptVersion: string;
  costEur: number;
  bytes: Uint8Array;
  mimeType: MediaType;
}

/** One paid call at a time: the application checkpoints and books each result separately.
 * Results are unmarked raw media; marking and validation must finish before show approval.
 * A failed call with unknown billing/result must be reconciled by attemptId before retry.
 */
export interface ShowGenerator {
  generateImage(request: ShowImageRequest): Promise<ShowCallResult<ShowSourceImage['mimeType']>>;
  generateVideo(request: ShowVideoRequest): Promise<ShowCallResult<'video/mp4'>>;
}

/** Durable attempt-indexed storage of raw bytes AND the provider receipt, before accounting.
 * put must be immutable/idempotent and get must return the same result across restarts.
 * References must be usable by ShowMediaSource after marking/ingestion (T44d).
 */
export interface ShowResultStore {
  put(
    tenantId: string,
    showId: string,
    attemptId: string,
    result: ShowCallResult<ShowSourceImage['mimeType'] | 'video/mp4'>,
  ): Promise<void>;
  get(
    tenantId: string,
    showId: string,
    attemptId: string,
  ): Promise<
    | {
        ref: string;
        result: ShowCallResult<ShowSourceImage['mimeType'] | 'video/mp4'>;
      }
    | undefined
  >;
}
