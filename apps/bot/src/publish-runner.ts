import type { PublishJob, PublishRunner } from '@handmake/core';

/**
 * GitHubActionsRunner (ADR 003): fires `publish.yml` via repository_dispatch.
 * The workflow reads `client_payload` as the publisher's dispatch payload, so
 * the job fields are mirrored 1:1 (`postId` → `draftId`); `kind`, `type` and
 * `poll?` have been part of the payload since T25. Success is HTTP 204 with
 * an empty body. The token is sent as a header and never appears in logs,
 * errors or the payload.
 */

export interface GitHubActionsRunnerOptions {
  /** "owner/repo" the token may access. A plain var, not a secret. */
  repo: string;
  /** Fine-grained PAT: this repo only, contents read/write (H4/H5). */
  token: string;
  /** Routes the dispatch to the live channel; false keeps it on the test
   * channel. From the PUBLISH_LIVE var — flipped only on Volodymyr's go. */
  live: boolean;
  /** Injectable fetch for tests; production uses the Worker's global. */
  fetchImpl?: typeof fetch;
}

export function createGitHubActionsRunner(options: GitHubActionsRunnerOptions): PublishRunner {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async run(job: PublishJob): Promise<void> {
      const response = await fetchImpl(`https://api.github.com/repos/${options.repo}/dispatches`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          // GitHub rejects API calls without a User-Agent (403); Workers' fetch
          // sends none by default.
          'User-Agent': 'handmake-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_type: 'publish-post',
          client_payload: {
            tenantId: job.tenantId,
            draftId: job.postId,
            kind: job.kind,
            type: job.type,
            texts: job.texts,
            fileIds: job.fileIds,
            provenance: job.provenance,
            ...(job.poll !== undefined ? { poll: job.poll } : {}),
            live: options.live,
          },
        }),
      });
      if (response.status !== 204) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `GitHub dispatch failed with HTTP ${response.status}: ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}
