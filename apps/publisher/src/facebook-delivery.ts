import { requiredEnv } from './required-env';
import type { GitCommitter } from './git';
import { contentRawBaseUrl, contentRawPhotoUrl } from './instagram-delivery';

/**
 * Facebook Page publishing wiring (T26b): Meta pulls the photos from
 * public raw-GitHub URLs, exactly like Instagram (T26a3), but Facebook
 * accepts the original aspect ratios — no 4:5 framing, no committed
 * copies. The photos were committed with the item, so the opted-in
 * CONTENT_PUSH_BEFORE_DELIVERY push is what makes the fresh URLs resolve
 * when Meta fetches them.
 */

export interface PrepareFacebookDeliveryDeps {
  env: NodeJS.ProcessEnv;
  git: GitCommitter;
  /** Repo-relative item directory (e.g. content/posts/<folder>), aligned with the caller's git paths. */
  repoDir: string;
  /** Photo file names aligned with the URL build; the URLs are index-aligned with the photos. */
  fileNames: string[];
  ops: Array<{ kind: string }>;
  /** Ledger resume point: ops before it are already delivered. */
  startAt: number;
  /**
   * Set by the caller when an earlier Meta preparation in this run already
   * pushed (a second push would be a no-op): the push is skipped.
   */
  contentAlreadyPushed?: boolean;
  logger?: (line: string) => void;
}

export interface PreparedFacebookDelivery {
  /** Public URL of each photo, aligned with the caller's photo bytes. */
  photoUrls: string[];
  /** True when this preparation ran the opted-in content push. */
  pushed: boolean;
}

/**
 * Everything the Facebook delivery needs before any network side effect:
 * public photo URLs aligned with the photos and the opted-in content push
 * (so Meta can fetch fresh URLs). Throws when no raw base URL is
 * available — the caller records the channel failure. Nothing is written
 * or committed here: the photos are the item's own committed files.
 */
export async function prepareFacebookDelivery(
  deps: PrepareFacebookDeliveryDeps,
): Promise<PreparedFacebookDelivery> {
  const log = deps.logger ?? (() => {});
  const base = contentRawBaseUrl(deps.env);
  if (base === undefined) {
    throw new Error(
      'Facebook delivery needs public photo URLs: set CONTENT_RAW_BASE_URL ' +
        'or run in GitHub Actions (GITHUB_REPOSITORY and GITHUB_REF_NAME)',
    );
  }
  const urls = deps.fileNames.map((fileName) => contentRawPhotoUrl(base, deps.repoDir, fileName));

  // Nothing left to deliver (e.g. an announcement renders to zero ops): no
  // push — Meta is never asked to fetch URLs.
  const remaining = deps.ops.slice(deps.startAt);
  if (remaining.length === 0) return { photoUrls: urls, pushed: false };

  if (deps.env['CONTENT_PUSH_BEFORE_DELIVERY'] === 'true' && !deps.contentAlreadyPushed) {
    await deps.git.push(requiredEnv('GITHUB_REF_NAME', deps.env));
    log('pushed content before Facebook delivery');
    return { photoUrls: urls, pushed: true };
  }
  return { photoUrls: urls, pushed: false };
}
