#!/usr/bin/env node
// Reads the Tally submission from the PAYLOAD env var, writes a YAML event file
// under src/content/events/ and any submitted images under public/images/events/<slug>/.
// Outputs slug / title / start / submitter_email for the workflow to consume.

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import yaml from 'js-yaml';
import sharp from 'sharp';

const SubmissionSchema = z.object({
  submitterEmail: z.string().email(),
  title: z.string().min(2).max(160),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }).optional(),
  venueName: z.string().min(1).max(160),
  address: z.string().min(1).max(240),
  mapsUrl: z.string().url().optional(),
  summary: z.string().max(400).optional(),
  description: z.string().max(10000).optional(),
  link: z.string().url().optional(),
  images: z
    .array(
      z.object({
        url: z.string().url(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().optional(),
      }),
    )
    .max(8)
    .default([]),
  tallySubmissionId: z.string().optional(),
});

function slugify(input) {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isoDate(input) {
  return input.slice(0, 10);
}

async function downloadAndResize(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await sharp(buf)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 78, effort: 5 })
    .toFile(destPath);
}

async function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    console.log(`::set-output name=${name}::${value}`);
    return;
  }
  const safeValue = String(value).replace(/\r?\n/g, ' ');
  await appendFile(out, `${name}=${safeValue}\n`);
}

async function main() {
  const raw = process.env.PAYLOAD;
  if (!raw) throw new Error('PAYLOAD env var is empty');

  const parsed = SubmissionSchema.parse(JSON.parse(raw));

  const dateStr = isoDate(parsed.start);
  const slugBase = slugify(parsed.title);
  if (!slugBase) throw new Error('Could not derive a slug from the title');
  const slug = `${dateStr}-${slugBase}`;

  const eventDir = `public/images/events/${slug}`;
  const savedImages = [];
  for (let i = 0; i < parsed.images.length; i++) {
    const file = parsed.images[i];
    const dest = join(eventDir, `${i + 1}.webp`);
    await downloadAndResize(file.url, dest);
    savedImages.push(`/images/events/${slug}/${i + 1}.webp`);
  }

  const eventData = {
    title: parsed.title,
    start: parsed.start,
    ...(parsed.end ? { end: parsed.end } : {}),
    location: {
      name: parsed.venueName,
      address: parsed.address,
      ...(parsed.mapsUrl ? { mapsUrl: parsed.mapsUrl } : {}),
    },
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.link ? { link: parsed.link } : {}),
    ...(savedImages.length > 0 ? { image: savedImages[0] } : {}),
  };

  const yamlPath = `src/content/events/${slug}.yaml`;
  await mkdir(dirname(yamlPath), { recursive: true });
  await writeFile(yamlPath, yaml.dump(eventData, { lineWidth: 100, noRefs: true }), 'utf8');

  await setOutput('slug', slug);
  await setOutput('title', parsed.title);
  await setOutput('start', parsed.start);
  await setOutput('submitter_email', parsed.submitterEmail);
  if (savedImages.length > 0) await setOutput('image_count', String(savedImages.length));

  console.log(`Wrote ${yamlPath} and ${savedImages.length} image(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
