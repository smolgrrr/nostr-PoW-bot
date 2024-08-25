import * as Nostr from "nostr-tools";
import dotenv from "dotenv";
import { Event } from "nostr-tools";
import { SimplePool, finalizeEvent } from "nostr-tools";

dotenv.config();

const MySecret = process.env.BOT_SECRET;

function hexStringToUint8Array(hexString: string): Uint8Array {
  if (hexString.length % 2 !== 0) {
      throw new Error('Invalid hex string');
  }

  const array = new Uint8Array(hexString.length / 2);

  for (let i = 0; i < hexString.length; i += 2) {
      array[i / 2] = parseInt(hexString.substr(i, 2), 16);
  }

  return array;
}

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

let timer: NodeJS.Timeout;

const pool = new SimplePool()

const feedRelays = [
  "wss://nostr.bitcoiner.social",
  "wss://nostr.mom",
  "wss://relay.nostr.bg",
  "wss://nos.lol",
  "wss://nostr.mutinywallet.com",
];

const relayConnect = async () => {
  try {
    await pool.subscribeMany(
      [...feedRelays],
      [
        { 
          ids:["0000"],
          kinds: [1],
          since: Math.floor((Date.now() * 0.001) - (6 * 60 * 60)),
        },
      ],
      {
        onevent(event) {
          console.log('we got the event we wanted:', event.id)
          if (filterEvent(event)) {
            repostEvent(event);
          }
        },
        onclose: (reason) => {
          console.log(`relay connection closed at ${Date.now()}:${reason}`);
          clearTimeout(timer);
          timer = setTimeout(async () => {
            relayConnect()
          }, 900000); // Attempt to reconnect after 15 minutes
        },
      }
    );
  } catch (error) {
    console.error('Error with relay connection:', error);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      relayConnect()
    }, 900000); // Attempt to reconnect after 15 minutes if an error occurs
  }
}
relayConnect();

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

    // let metadataTemplate = 
    // {
    //   pubkey: "3ff4b1b836c7e63ee4acf391270d8660e1b7af56ba9474b92838bb079e75287d",
    //   created_at: Math.floor(Date.now() / 1000),
    //   kind: 0,
    //   tags: [],
    //   content: `{"banner":"https://m.primal.net/HPij.jpg","website":"getwired.app","lud06":"","nip05":"","lud16":"smolgrrr@getalby.com","picture":"https://i0.wp.com/drunkenanimeblog.com/wp-content/uploads/2017/07/1473031501_lain.gif","display_name":"Wired Reposts","about":"i repost from the Wired global feed every 30-minutes. current difficulty: ${difficulty}","name":"Wired Reposts"}`,
    // }
    // const metadataEvent = finishEvent(metadataTemplate, MySecret as string)

    // const validateEvent = Nostr.validateEvent(metadataEvent);
    // const verifySignature = Nostr.verifySignature(metadataEvent);
    // console.log(JSON.stringify({ validateEvent, verifySignature, metadataEvent }));
  
    // pool.publish(metadataEvent as Event, feedRelays);
  }

  if (getPow(event.id) > difficulty && !event.tags.some((tag) => tag[0] === "e") && event.tags.some((tag) => tag[0] === "client" && tag[1] === 'getwired.app')) {
    console.log('found PoW event: ', event.id)
    eventCount++;
    return true;
  }

  return false;
}

async function repostEvent(event: Nostr.Event): Promise<void> { // Mark function as async
  const currentTime = Date.now();
  const thirtyMinutesInMilliseconds = 30 * 60 * 1000;

  // Check if 30 minutes have passed since the last repost
  if (currentTime - lastRepostTime < thirtyMinutesInMilliseconds) {
    console.log('Less than 30 minutes have passed since the last repost. Skipping this event.');
    return;
  }
  console.log(JSON.stringify({ event }));

  const template = {
    kind: 6,
    tags: [['e', event.id], ['p', event.pubkey]],
    content: JSON.stringify(event),
    created_at: Math.floor(Date.now() / 1000),
  }
  const repostEvent = finalizeEvent(template, hexStringToUint8Array(MySecret as string))

  try {
    await pool.publish(feedRelays, repostEvent);
  } catch (error) {
    console.error('Error publishing event:', error);
    // Handle the error as needed
  }

  // Update the last repost time
  lastRepostTime = currentTime;
}