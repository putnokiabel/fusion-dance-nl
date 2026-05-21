import { defineCollection, z } from 'astro:content';

const events = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string(),
    start: z.coerce.date(),
    end: z.coerce.date().optional(),
    location: z.object({
      name: z.string(),
      address: z.string().optional(),
      mapsUrl: z.string().url().optional(),
    }),
    summary: z.string().max(400).optional(),
    description: z.string().optional(),
    link: z.string().url().optional(),
    image: z.string().optional(),
    cancelled: z.boolean().default(false),
  }),
});

export const collections = { events };
