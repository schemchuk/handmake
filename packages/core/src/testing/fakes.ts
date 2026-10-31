import { compareNewestFirst } from '../post';
import type { Post } from '../post';
import type {
  ChannelAdapter,
  ChannelCapabilities,
  DeliverContext,
  DeliverProgress,
  PollResult,
  RemoteId,
  SendOperation,
} from '../ports/channel';
import type {
  Clock,
  MediaSource,
  Notifier,
  NotifyTarget,
  PublishJob,
  PublishRunner,
  SecretResolver,
  TranslationRequest,
  TranslationResult,
  Translator,
} from '../ports/services';
import type { ContentStore, Draft, DraftState, DraftStore, PublishLedger } from '../ports/store';

export interface FakeChannelAdapterOptions {
  key?: string;
  capabilities?: Partial<ChannelCapabilities>;
  renderImpl?: (post: Post, settings: unknown) => SendOperation[];
}

/** In-memory ChannelAdapter. Records what it would send and the idempotency keys. */
export class FakeChannelAdapter implements ChannelAdapter {
  readonly key: string;
  readonly capabilities: ChannelCapabilities;
  readonly renderImpl: (post: Post, settings: unknown) => SendOperation[];

  readonly deliveries: { ops: SendOperation[]; idempotencyKeys: string[] }[] = [];
  readonly progressCalls: { opIndex: number; remoteId: RemoteId }[] = [];
  readonly pollsClosed: RemoteId[] = [];
  /** Preset for the next closePoll result. */
  pollResult: PollResult = { optionVotes: [1], totalVotes: 1 };

  constructor(options: FakeChannelAdapterOptions = {}) {
    this.key = options.key ?? 'fake';
    this.capabilities = {
      maxPhotos: 10,
      captionLimit: 1024,
      messageLimit: 4096,
      polls: true,
      pollMaxOptions: 10,
      pollQuestionLimit: 300,
      pollOptionLimit: 100,
      ...options.capabilities,
    };
    this.renderImpl = options.renderImpl ?? (() => []);
  }

  render(post: Post, settings: unknown): SendOperation[] {
    return this.renderImpl(post, settings);
  }

  async deliver(
    ops: SendOperation[],
    ctx: DeliverContext,
    progress?: DeliverProgress,
  ): Promise<RemoteId[]> {
    const start = progress?.startAt ?? 0;
    const known = progress?.knownIds ?? [];
    if (start > ops.length || known.length !== start) {
      throw new Error('FakeChannelAdapter: progress violates the ledger invariant');
    }
    this.deliveries.push({
      ops,
      idempotencyKeys: ops.map((_, i) => `${ctx.idempotencyBase}:${i}`),
    });
    const newIds: RemoteId[] = [];
    for (let i = start; i < ops.length; i++) {
      const remoteId = `${this.key}-msg-${this.deliveries.length}-${i}`;
      newIds.push(remoteId);
      this.progressCalls.push({ opIndex: i, remoteId });
      await progress?.onDelivered(i, remoteId);
    }
    return [...known, ...newIds];
  }

  async closePoll(pollId: RemoteId): Promise<PollResult> {
    this.pollsClosed.push(pollId);
    return this.pollResult;
  }
}

/** In-memory ContentStore keyed by tenantId/postId. */
export class FakeContentStore implements ContentStore {
  readonly posts = new Map<string, Post>();
  readonly photos = new Map<string, Map<string, Uint8Array>>();
  readonly ledgers = new Map<string, PublishLedger>();

  private static key(tenantId: string, postId: string): string {
    return `${tenantId}/${postId}`;
  }

  async savePost(post: Post, photoFiles: { fileName: string; data: Uint8Array }[]): Promise<void> {
    this.posts.set(FakeContentStore.key(post.tenant, post.id), post);
    this.photos.set(
      FakeContentStore.key(post.tenant, post.id),
      new Map(photoFiles.map((p) => [p.fileName, p.data])),
    );
  }

  async readPost(tenantId: string, postId: string): Promise<Post | undefined> {
    return this.posts.get(FakeContentStore.key(tenantId, postId));
  }

  async listPosts(tenantId: string): Promise<Post[]> {
    return [...this.posts.values()].filter((p) => p.tenant === tenantId).sort(compareNewestFirst);
  }

  async readPostPhoto(
    tenantId: string,
    postId: string,
    fileName: string,
  ): Promise<Uint8Array | undefined> {
    return this.photos.get(FakeContentStore.key(tenantId, postId))?.get(fileName);
  }

  async readLedger(tenantId: string, postId: string): Promise<PublishLedger | undefined> {
    return this.ledgers.get(FakeContentStore.key(tenantId, postId));
  }

  async writeLedger(ledger: PublishLedger): Promise<void> {
    this.ledgers.set(FakeContentStore.key(ledger.tenantId, ledger.postId), structuredClone(ledger));
  }
}

/** In-memory DraftStore. */
export class FakeDraftStore implements DraftStore {
  readonly drafts = new Map<string, Draft>();

  private static key(tenantId: string, draftId: string): string {
    return `${tenantId}/${draftId}`;
  }

  async get(tenantId: string, draftId: string): Promise<Draft | undefined> {
    const draft = this.drafts.get(FakeDraftStore.key(tenantId, draftId));
    return draft ? structuredClone(draft) : undefined;
  }

  async save(draft: Draft): Promise<void> {
    this.drafts.set(FakeDraftStore.key(draft.tenantId, draft.draftId), structuredClone(draft));
  }

  async delete(tenantId: string, draftId: string): Promise<void> {
    this.drafts.delete(FakeDraftStore.key(tenantId, draftId));
  }

  async listByState(tenantId: string, state: DraftState): Promise<Draft[]> {
    return [...this.drafts.values()].filter((d) => d.tenantId === tenantId && d.state === state);
  }
}

/** Records publish jobs instead of running them. */
export class FakePublishRunner implements PublishRunner {
  readonly jobs: PublishJob[] = [];
  failNext: Error | null = null;

  async run(job: PublishJob): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    this.jobs.push(job);
  }
}

/** Deterministic Translator: prefixes the text with the target language. */
export class FakeTranslator implements Translator {
  readonly requests: TranslationRequest[] = [];
  failNext: Error | null = null;

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (request.text.trim() === '') {
      throw new Error('FakeTranslator: empty text');
    }
    this.requests.push(request);
    return { text: `[${request.targetLang}] ${request.text}`, notes: 'fake translation' };
  }
}

/** Serves photos from an in-memory map. */
export class FakeMediaSource implements MediaSource {
  readonly photos = new Map<string, Uint8Array>();

  async fetchPhoto(ref: string): Promise<Uint8Array> {
    const photo = this.photos.get(ref);
    if (!photo) throw new Error(`FakeMediaSource: unknown photo ref "${ref}"`);
    return photo;
  }
}

/** Records notifications per target. */
export class FakeNotifier implements Notifier {
  readonly messages: { target: NotifyTarget; message: string }[] = [];

  async notify(target: NotifyTarget, message: string): Promise<void> {
    this.messages.push({ target, message });
  }
}

/** Resolves secrets from an in-memory map; never logs values. */
export class FakeSecretResolver implements SecretResolver {
  constructor(private readonly secrets: Record<string, string> = {}) {}

  async resolve(name: string): Promise<string> {
    const value = this.secrets[name];
    if (value === undefined) throw new Error(`FakeSecretResolver: unknown secret "${name}"`);
    return value;
  }
}

/** Controllable clock; frozen at the given time, advanceable in tests. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-10-23T12:00:00Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
