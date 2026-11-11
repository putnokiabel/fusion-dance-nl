import { defineCollection, z } from 'astro:content';

const OFFSET_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  timeZoneName: 'longOffset',
});

// Europe/Amsterdam UTC offset at the given instant, as "+01:00" or "+02:00".
const amsterdamOffset = (d: Date) =>
  OFFSET_FMT.formatToParts(d).find((p) => p.type === 'timeZoneName')!.value.replace('GMT', '');

// Event times must be quoted ISO strings in Amsterdam local time with the offset that
// applies on that date. Unquoted YAML timestamps are parsed into Date objects (offset lost),
// and UTC values written with the wrong DST offset silently shift the displayed time.
const amsterdamDateTime = z
  .custom<string>((v) => typeof v === 'string', {
    message: "must be a quoted string in Amsterdam local time, e.g. '2026-11-13T18:45:00+01:00'",
  })
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:\d{2}$/, {
    message: "must use an explicit offset (+01:00 or +02:00), not Z, e.g. '2026-11-13T18:45:00+01:00'",
  }))
  .superRefine((s, ctx) => {
    const expected = amsterdamOffset(new Date(s));
    if (!s.endsWith(expected)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `offset does not match Europe/Amsterdam on that date (expected ${expected})`,
      });
    }
  })
  .transform((s) => new Date(s));

const events = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    start: amsterdamDateTime,
    end: amsterdamDateTime.nullish(),
    location: z.object({
      name: z.string(),
      address: z.string().nullish(),
      mapsUrl: z.string().url().nullish(),
    }),
    summary: z.string().max(400).nullish(),
    description: z.string().nullish(),
    link: z.string().url().nullish(),
    image: z.string().nullish(),
    cancelled: z.boolean().default(false),
  }),
});

export const collections = { events };
