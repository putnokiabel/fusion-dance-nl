import { getCollection, type CollectionEntry } from 'astro:content';

export type EventEntry = CollectionEntry<'events'>;

const endOrStart = (e: EventEntry) => e.data.end ?? e.data.start;

export async function getUpcomingEvents(): Promise<EventEntry[]> {
  const now = new Date();
  const all = await getCollection('events', (e) => !e.data.cancelled);
  return all
    .filter((e) => endOrStart(e) >= now)
    .sort((a, b) => a.data.start.getTime() - b.data.start.getTime());
}

export async function getPastEvents(): Promise<EventEntry[]> {
  const now = new Date();
  const all = await getCollection('events');
  return all
    .filter((e) => endOrStart(e) < now)
    .sort((a, b) => b.data.start.getTime() - a.data.start.getTime());
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Europe/Amsterdam',
});

const TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Amsterdam',
});

export function formatEventDate(start: Date, end?: Date): string {
  const startDate = DATE_FMT.format(start);
  if (!end) return startDate;
  const endDate = DATE_FMT.format(end);
  return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
}

export function formatEventTime(start: Date, end?: Date): string {
  const startTime = TIME_FMT.format(start);
  if (!end) return startTime;
  return `${startTime} – ${TIME_FMT.format(end)}`;
}
