import { unstable_dev } from 'wrangler';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { UnstableDevWorker } from 'wrangler';
import crypto from 'crypto';

describe('GitHub App Worker', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('should handle a pull request review comment webhook', async () => {
    const mockWebhookPayload = {
      action: 'created',
      comment: {
        body: 'This function could be simplified.',
        path: 'src/example.ts',
        position: 5,
        start_line: 10,
        end_line: 15,
      },
      pull_request: {
        number: 1,
        head: { sha: 'abc123' },
        base: { repo: { owner: { login: 'octocat' }, name: 'Hello-World' } },
      },
      installation: { id: 12345 },
    };

    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('WEBHOOK_SECRET environment variable is not set');
    }

    const payload = JSON.stringify(mockWebhookPayload);
    const signature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    const response = await worker.fetch('/api/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request_review_comment',
        'x-hub-signature-256': `sha256=${signature}`,
        'x-github-delivery': crypto.randomBytes(16).toString('hex'),
      },
      body: payload,
    });

    expect(response.status).toBe(200);
  });
});
