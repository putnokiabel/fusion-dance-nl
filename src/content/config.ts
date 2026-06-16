import { defineCollection, z } from 'astro:content';

const events = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().nullish(),
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
