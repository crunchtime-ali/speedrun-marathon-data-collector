import { createClient } from "@libsql/client";
import SqlString from 'sqlstring'
import { Chain } from 'repeat'
import pg from 'pg'



import credentials from './credentials.json' with { type: 'json' }
const { dbConfig } = credentials

const { Client } = pg
const client = new Client(dbConfig)
await client.connect()

//async function main() {
//init stuff

//const res = await client.query("SELECT count(*) AS exact_count FROM gdq_schedule");
//console.log(res)
//}
//await main();

const pushDataInterval = 60 * 5000 // every minute

let chain = new Chain()

chain.add(
  async () => await updateGdqSchedule(),
).every(pushDataInterval) // every minute


async function updateGdqSchedule() {
    console.time("updateSchedule");
    const eventID = 48 // SGDQ 2024
    const response = await fetch(`https://gamesdonequick.com/api/schedule/${eventID}`);
    const body = await response.json();
    const { schedule } = body;

    // filter interviews
    const filteredSchedule = schedule.filter(obj => obj.type !== 'interview' && obj.name !== 'The Checkpoint');
    console.log(`${filteredSchedule.length} games in schedule (${schedule.length} without filters)`);

    // Clean the schedule table
    // Tip: For small tables DELETE is often faster and needs less aggressive locking
    await client.query('DELETE FROM gdq_schedule')

    for(const scheduleItem of filteredSchedule){

        // Extract the runner names from the scheduleItem
        const runnerNamesArray = scheduleItem.runners.map(runnerItem => runnerItem.name);
        // Concatenate the names together, separated by ", "
        const runnerNames = runnerNamesArray.join(', ');

        // Extract the host names from the scheduleItem
        const hostNamesArray = scheduleItem.hosts.map(runnerItem => runnerItem.name);
        // Concatenate the names together, separated by ", "
        const hostNames = hostNamesArray.join(', ');

        /// <param name="name">Usually the same as <paramref name="gameName"/>, but if this is a bonus game, <paramref name="name"/> will have a <c>BONUS GAME 1- </c> prefix.</param>
        /// <param name="gameName">Usually the same as <paramref name="name"/>, but if this is a bonus game, <paramref name="gameName"/> won't have the <c>BONUS GAME 1- </c> prefix.</param>
        /// <param name="category">The type or rule set of the run, such as 100% or Any%.</param>
        /// <param name="console">The hardware the game is running on, such as PC or PS5.</param>
        /// <param name="order">The sequence number of this run in its containing event, starting at <c>1</c> for the first run of the even and increasing by <c>1</c> for each run in the event</param>
        /// <param name="runTime">Before a run ends, this is the estimated duration, but after a run ends, this changes to the actual duration. To get the original estimated duration even after the run ends, use <paramref name="endTime"/><c>-</c><paramref name="startTime"/>.</param>
        const scheduleObject = {
            name: scheduleItem.name,
            category: scheduleItem.category,
            start_time: scheduleItem.starttime,
            duration: scheduleItem.run_time,
            runners: runnerNames,
            host: hostNames,
        }

        const queryValues = [
            scheduleObject.name,
            scheduleObject.category,
            convertDateToCET(new Date(scheduleObject.start_time)),
            scheduleObject.duration,
            scheduleObject.runners,
            scheduleObject.host
        ]
        await client.query(
            `INSERT INTO gdq_schedule (
          name,
          category,
          start_time,
          duration,
          runners,
          host
        ) VALUES 
        ($1, $2, $3, $4, $5, $6)`, queryValues);

    }
    console.log("Updated schedule")
    console.timeEnd("updateSchedule");

}

function getUnixTimeStamp(dateString) {
  return Math.round(new Date(dateString) / 1000)
}

function convertDateToCET (date) {
    date = new Date(date)
    // let startTime = date.getTime();
    const cetOffset = -60; // this is the number you get from running
    // `(new Date()).getTimezoneOffset()` if you're on a machine in CET
    const offsetFromCET = (date.getTimezoneOffset() - cetOffset);
    const cetMillsecondOffset = ( cetOffset* 60 * 1000);
    date = new Date( date.getTime() - cetMillsecondOffset )
    // let endTime = date.getTime()
    return date;
}