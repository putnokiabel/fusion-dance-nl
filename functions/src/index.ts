import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import crypto from 'node:crypto';

const TALLY_SIGNING_SECRET = defineSecret('TALLY_SIGNING_SECRET');
const GITHUB_PAT = defineSecret('GITHUB_PAT');
const GITHUB_OWNER = defineSecret('GITHUB_OWNER');
const GITHUB_REPO = defineSecret('GITHUB_REPO');

interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
}

interface TallyPayload {
  eventId: string;
  eventType: string;
  formId: string;
  data: {
    fields: TallyField[];
    submissionId: string;
    createdAt: string;
  };
}

interface TallyFileValue {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
}

interface EventSubmission {
  submitterEmail: string;
  title: string;
  start: string;
  end?: string;
  venueName: string;
  address: string;
  mapsUrl?: string;
  summary?: string;
  description?: string;
  link?: string;
  images: TallyFileValue[];
  tallySubmissionId: string;
}

const REQUIRED_LABELS = {
  submitterEmail: 'Submitter email',
  title: 'Title',
  start: 'Start',
  venueName: 'Venue name',
  address: 'Address',
} as const;

const OPTIONAL_LABELS = {
  end: 'End',
  mapsUrl: 'Maps URL',
  summary: 'Summary',
  description: 'Description',
  link: 'Link',
  images: 'Images',
} as const;

function findField(fields: TallyField[], labelPrefix: string): TallyField | undefined {
  const needle = labelPrefix.toLowerCase();
  return fields.find((f) => f.label.toLowerCase().startsWith(needle));
}

function asString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiles(v: unknown): TallyFileValue[] {
  if (!Array.isArray(v)) return [];
  return v.filter((f): f is TallyFileValue => typeof f === 'object' && f !== null && typeof (f as TallyFileValue).url === 'string');
}

function reshape(payload: TallyPayload): { ok: true; submission: EventSubmission } | { ok: false; error: string } {
  const fields = payload.data.fields;

  const required: Partial<Record<keyof typeof REQUIRED_LABELS, string>> = {};
  for (const [key, label] of Object.entries(REQUIRED_LABELS) as Array<[keyof typeof REQUIRED_LABELS, string]>) {
    const f = findField(fields, label);
    const v = asString(f?.value);
    if (!v) return { ok: false, error: `Missing required field: ${label}` };
    required[key] = v;
  }

  if (Number.isNaN(Date.parse(required.start!))) {
    return { ok: false, error: 'Start date is not a valid ISO datetime' };
  }
  const endRaw = asString(findField(fields, OPTIONAL_LABELS.end)?.value);
  if (endRaw && Number.isNaN(Date.parse(endRaw))) {
    return { ok: false, error: 'End date is not a valid ISO datetime' };
  }

  return {
    ok: true,
    submission: {
      submitterEmail: required.submitterEmail!,
      title: required.title!,
      start: required.start!,
      end: endRaw,
      venueName: required.venueName!,
      address: required.address!,
      mapsUrl: asString(findField(fields, OPTIONAL_LABELS.mapsUrl)?.value),
      summary: asString(findField(fields, OPTIONAL_LABELS.summary)?.value),
      description: asString(findField(fields, OPTIONAL_LABELS.description)?.value),
      link: asString(findField(fields, OPTIONAL_LABELS.link)?.value),
      images: asFiles(findField(fields, OPTIONAL_LABELS.images)?.value),
      tallySubmissionId: payload.data.submissionId,
    },
  };
}

function verifyTallySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function dispatchToGithub(submission: EventSubmission, owner: string, repo: string, token: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'fusion-dance-nl-webhook',
    },
    body: JSON.stringify({
      event_type: 'new-event',
      client_payload: submission,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub dispatch failed: ${res.status} ${text}`);
  }
}

export const tallyWebhook = onRequest(
  {
    region: 'europe-west1',
    secrets: [TALLY_SIGNING_SECRET, GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO],
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const rawBody = (req as unknown as { rawBody: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
    const signature = req.header('tally-signature') ?? req.header('Tally-Signature');

    if (!verifyTallySignature(rawBody, signature, TALLY_SIGNING_SECRET.value())) {
      logger.warn('Rejected webhook with invalid signature');
      res.status(401).send('Invalid signature');
      return;
    }

    let payload: TallyPayload;
    try {
      payload = JSON.parse(rawBody) as TallyPayload;
    } catch {
      res.status(400).send('Invalid JSON');
      return;
    }

    const reshaped = reshape(payload);
    if (!reshaped.ok) {
      logger.warn('Rejected submission', { error: reshaped.error });
      res.status(400).send(reshaped.error);
      return;
    }

    try {
      await dispatchToGithub(
        reshaped.submission,
        GITHUB_OWNER.value(),
        GITHUB_REPO.value(),
        GITHUB_PAT.value(),
      );
      logger.info('Dispatched submission to GitHub', { tallySubmissionId: reshaped.submission.tallySubmissionId });
      res.status(200).send('ok');
    } catch (err) {
      logger.error('Failed to dispatch to GitHub', err);
      res.status(502).send('Upstream dispatch failed');
    }
  },
);
