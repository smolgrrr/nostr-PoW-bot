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

const checkRepostsPool = new RelayPool(undefined, {
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

let poolEventIds: string[] = [];

checkRepostsPool.subscribe(
  [
    {
      kinds: [6],
      authors: [MyPubkey as string],
    },
  ],
  feedRelays,
  (event, _isAfterEose, _relayURL) => {
    // Add event ID to the list
    poolEventIds.push(event.id);

    // Emit an event when the array is populated
    if (poolEventIds.length > 0) {
      eventEmitter.emit('poolEventIdsPopulated');
    }
  }
);

eventEmitter.on('poolEventIdsPopulated', () => {
  pool.subscribe(
    [
      {
        kinds: [1],
        since: Math.floor((Date.now() * 0.001) - (15 * 60)),
      },
    ],
    feedRelays,
    (event, _isAfterEose, _relayURL) => {
      if (filterEvent(event)) {
        repostEvent(event);
      }
    }
  );
});

function filterEvent(event: Nostr.Event): boolean {
  // Check if event ID exists in the list
  const eTag = event.tags.filter(tag => tag[0] === 'e').map(tag => tag[1]);
  if (poolEventIds.includes(eTag[0])) {
    console.log(event.id + 'REJECTED!?!?!')
    return false;
  }

  if (getPow(event.id) > 20 && !event.tags.some((tag) => tag[0] === "e")) {
    return true;
  }
  return false;
}

let lastRepostTime = 0;

function repostEvent(event: Nostr.Event): void {
  const currentTime = Date.now();
  const fifteenMinutesInMilliseconds = 15 * 60 * 1000;

  // Check if 15 minutes have passed since the last repost
  if (currentTime - lastRepostTime < fifteenMinutesInMilliseconds) {
    console.log('Less than 15 minutes have passed since the last repost. Skipping this event.');
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
