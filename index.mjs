import { createClient } from "@libsql/client";
import { AppTokenAuthProvider, StaticAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { ChatClient } from '@twurple/chat';
import SqlString from 'sqlstring'
import { Chain } from 'repeat'
import credentials from './credentials.json' assert { type: 'json' }
// https://twitchapps.com/tmi/
const { twitchConfig } = credentials

/*
Info from Fatzke on restreams
German: https://www.twitch.tv/germench
German (Stream 2): https://www.twitch.tv/connectspeedruns
French: https://twitch.tv/nitro_speedrun
French (Stream 2):  https://twitch.tv/nitro_speedrun2
Japanese: https://www.twitch.tv/japanese_restream
Japanese (Stream 2):  https://www.twitch.tv/japanese_restream2
Russian: https://www.twitch.tv/r_u_s_c
*/

// The Twitch channel URL slugs to watch for
const twitch_channels = [
  'esamarathon',
  'esamarathon2',
  'germench',
  'connectspeedruns',
  'nitro_speedrun',
  'nitro_speedrun2',
  'japanese_restream',
  'japanese_restream2',
  'r_u_s_c'
]

let twitchMessageCounts = {}
resetChatmessageCounts() // init the message counts
console.log(twitchMessageCounts)

let db

//async function main() {
await initDatabase()
await initTwitch()

const rs = await db.execute("SELECT COUNT(*)  FROM chats");
console.log(rs);
//}
//await main();

const pushDataInterval = 60 * 1000 // every minute

// Twitch viewer
const authProviderViewerTracking = new AppTokenAuthProvider(twitchConfig.clientId, twitchConfig.clientSecret);
const twitchApi = new ApiClient({ authProvider: authProviderViewerTracking });

let chain = new Chain()

chain.add(
  () => printMessageCounts(),
  async () => await addToTimeseries()
).every(pushDataInterval) // every minute

function printMessageCounts() {
  //console.log(twitchMessageCounts)
}

function resetChatmessageCounts() {
  for (let value of twitch_channels) { 
    twitchMessageCounts[value] = 0
  }
}

async function addToTimeseries() {

  for (let streamName of twitch_channels) { 

    // Retrieve viewer count
    const stream = await twitchApi.streams.getStreamByUserName(streamName);
    let viewerCount = 0
    let messageCount = twitchMessageCounts[streamName];

    if (stream !== null) {
        console.log(`[Twitch] channel ${streamName} is online with ${stream.viewers} viewers, ${messageCount} messages last minute`)
        viewerCount = stream.viewers
    } else {
        console.log(`[Twitch] channel ${streamName} is offline`)
    }

    await db.execute(
      `INSERT INTO timeseries (
          created_at,
          stream,
          num_viewers,
          num_chats,
          num_donations,
          total_donations
        ) VALUES (
          ${getUnixTimeStamp()},
          '${streamName}',
          ${viewerCount},
          ${messageCount},
          0,
          0.0
      )`);
  }
  resetChatmessageCounts()
}

async function initDatabase() {
  const config = {
    url: process.env.URL ?? "file:local.db",
    encryptionKey: process.env.ENCRYPTION_KEY,
  };
  db = createClient(config);
  await db.batch([

    `CREATE TABLE IF NOT EXISTS timeseries (
      created_at INTEGER,
      stream TEXT,
      num_viewers INTEGER,
      num_chats INTEGER,
      num_donations INTEGER,
      total_donations DECIMAL(20, 2)
    )`,
    `CREATE TABLE IF NOT EXISTS donations (
      created_at INTEGER,
      stream TEXT,
      donation_id INTEGER,
      donor_name TEXT,
      donor_id INTEGER,
      has_comment BOOLEAN DEFAULT FALSE
    )`,
    `CREATE TABLE IF NOT EXISTS chats (
      created_at INTEGER,
      stream TEXT,
      username TEXT,
      message TEXT
    )`
  ], "write");
}

async function initTwitch() {

  // Init chat channels
  // const authProviderChatMessages = new StaticAuthProvider(twitchConfig.clientId, twitchConfig.accessToken, ['chat:read']);

  const chatClient = new ChatClient({ authProvider: null, channels: twitch_channels });
  chatClient.connect();

  chatClient.onAuthenticationSuccess(() => {
    console.log("[Twitch] Chat Client authenticated with Twitch successfully")
  })

  chatClient.onAuthenticationFailure((text, retryCount) => {
      console.log(`[Twitch] Chat channel authentication failed. Reason: ${text}, Retry count: ${retryCount}`)
  })

  chatClient.onJoin((channel, user) => {
    console.log(`[Twitch] ${user} joined channel ${channel} successfully`)
  })

  chatClient.onJoinFailure((channel, reason) => {
      console.log(`[Twitch] Failed to join chat channel ${channel} because of ${reason}`)
  })

  chatClient.onMessage(async (channel, user, text, msg) => {

    twitchMessageCounts[channel]++
      //console.log(`[Twitch] Channel ${channel}: Received message: ${text}, MSG ${msg}`)

    await db.execute(
      `INSERT INTO chats (
        created_at,
        stream,
        username,
        message
        ) VALUES (
        ${getUnixTimeStamp()},
        '${channel}',
        '${user}',
        '${text.replace(/\'/g,"''").replace(/([\uE000-\uF8FF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDDFF])/g, '')}'
      )`);
  })
}

function getUnixTimeStamp() {
  return Math.round(new Date() / 1000)
}