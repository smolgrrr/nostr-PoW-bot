import * as Nostr from "nostr-tools";
import { RelayPool } from "nostr-relaypool";
import dotenv from "dotenv";
import { Event, finishEvent } from "nostr-tools";
import { EventEmitter } from 'events';

const eventEmitter = new EventEmitter();

dotenv.config();

const MyPubkey = process.env.BOT_PUBKEY;
const MySecret = process.env.BOT_SECRET;

/** Get POW difficulty from a Nostr hex ID. */
function getPow(hex: string): number {
  let count = 0

  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16)
    if (nibble === 0) {
      count += 4
    } else {
      count += Math.clz32(nibble) - 28
      break
    }
  }

  return count
}

type RepostEventTemplate = {
  /**
   * Pass only non-nip18 tags if you have to.
   * Nip18 tags ('e' and 'p' tags pointing to the reposted event) will be added automatically.
   */
  tags?: string[][]

  /**
   * Pass an empty string to NOT include the stringified JSON of the reposted event.
   * Any other content will be ignored and replaced with the stringified JSON of the reposted event.
   * @default Stringified JSON of the reposted event
   */
  content?: ''

  created_at: number
}

function finishRepostEvent(
  t: RepostEventTemplate,
  reposted: Event<number>,
  relayUrl: string,
  privateKey: string,
): Event {
  return finishEvent(
    {
      kind: 6,
      tags: [...(t.tags ?? []), ['e', reposted.id, relayUrl], ['p', reposted.pubkey]],
      content: t.content === '' ? '' : JSON.stringify(reposted),
      created_at: t.created_at,
    },
    privateKey,
  )
}

const pool = new RelayPool(undefined, {
  autoReconnect: true,
  logErrorsAndNotices: true,
});

const feedRelays = [
  "wss://relay.snort.social",
  "wss://nostr.bitcoiner.social",
  "wss://nostr.mom",
  "wss://relay.nostr.bg",
  "wss://nos.lol",
  "wss://powrelay.xyz"
];

pool.subscribe(
  [
    {
      kinds: [1],
      since: Math.floor((Date.now() * 0.001) - (60 * 60)),
    },
  ],
  feedRelays,
  (event, _isAfterEose, _relayURL) => {
    if (filterEvent(event)) {
      repostEvent(event);
    }
  }
);

let lastRepostTime = 0;
let difficulty = 20;
let eventCount = 0;
let lastAdjustmentTime = Date.now();

function filterEvent(event: Nostr.Event): boolean {
  const currentTime = Date.now();
  const twelveHoursInMilliseconds = 12 * 60 * 60 * 1000;

  // Check if 12 hours have passed since the last difficulty adjustment
  if (currentTime - lastAdjustmentTime >= twelveHoursInMilliseconds) {
    // Adjust difficulty based on the number of events in the last 12 hours
    // We want approximately 24 events per 12 hours
    if (eventCount > 24) {
      difficulty++;
    } else if (eventCount < 24) {
      difficulty = Math.max(0, difficulty - 1); // Ensure difficulty doesn't go below 0
    }

    // Reset event count and last adjustment time
    eventCount = 0;
    lastAdjustmentTime = currentTime;
    console.log('Current difficulty: ', difficulty);
  }

  if (getPow(event.id) > difficulty && !event.tags.some((tag) => tag[0] === "e")) {
    console.log('found PoW event: ', event.id)
    eventCount++;
    return true;
  }

  return false;
}

function repostEvent(event: Nostr.Event): void {
  const currentTime = Date.now();
  const thirtyMinutesInMilliseconds = 30 * 60 * 1000;

  // Check if 30 minutes have passed since the last repost
  if (currentTime - lastRepostTime < thirtyMinutesInMilliseconds) {
    console.log('Less than 30 minutes have passed since the last repost. Skipping this event.');
    return;
  }
  console.log(JSON.stringify({ event }));

  const template = {
    created_at: Math.floor(Date.now() / 1000),
  }
  const repostEvent = finishRepostEvent(template, event, feedRelays[feedRelays.length - 1], MySecret as string)

  const validateEvent = Nostr.validateEvent(repostEvent);
  const verifySignature = Nostr.verifySignature(repostEvent);
  console.log(JSON.stringify({ validateEvent, verifySignature, repostEvent }));

  pool.publish(repostEvent as Event, feedRelays);

  // Update the last repost time
  lastRepostTime = currentTime;
}