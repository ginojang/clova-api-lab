import {setTimeout as delay} from 'node:timers/promises';

/** Recheck the clock: a timer may wake just before its requested deadline. */
export async function waitForRequestSlot(previous, interval, now=Date.now, sleep=delay) {
  let remaining;
  while ((remaining = previous + interval - now()) > 0) await sleep(remaining);
}
