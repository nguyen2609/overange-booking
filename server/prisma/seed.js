import prisma from '../src/db.js';

const schedulingTimezone = process.env.SCHEDULING_TIMEZONE || 'Asia/Ho_Chi_Minh';

const weeksToSeed = 4;
const dailySlots = [
  { startTime: '09:00', endTime: '10:00' },
  { startTime: '10:00', endTime: '11:00' },
  { startTime: '11:00', endTime: '12:00' },
];

function getToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedulingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const getPart = (type) => parts.find((part) => part.type === type).value;
  return `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
}

function parseDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== value) {
    throw new Error('Use a valid date in YYYY-MM-DD format.');
  }

  return date;
}

async function main() {
  // Optionally pass a Monday: npm.cmd run db:seed -- 2026-09-14
  const requestedStart = process.argv[2];
  const monday = parseDate(requestedStart || getToday());

  if (requestedStart && monday.getUTCDay() !== 1) {
    throw new Error('The seed start date must be a Monday.');
  }

  // UTC arithmetic treats YYYY-MM-DD as a calendar date, without shifting it
  // according to the computer timezone. getToday() uses the scheduling timezone.
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);

  const operations = [];

  for (let day = 0; day < weeksToSeed * 7; day += 1) {
    const slotDate = new Date(monday);
    slotDate.setUTCDate(monday.getUTCDate() + day);
    const date = slotDate.toISOString().slice(0, 10);

    for (const times of dailySlots) {
      operations.push(prisma.slot.upsert({
        where: { date_startTime: { date, startTime: times.startTime } },
        update: {}, // Preserve an existing slot, including any future bookings.
        create: { date, ...times },
      }));
    }
  }

  await prisma.$transaction(operations);
  console.log(`Prepared ${operations.length} slots across ${weeksToSeed} weeks starting ${monday.toISOString().slice(0, 10)} (${schedulingTimezone}).`);
  console.log(`Total slots in database: ${await prisma.slot.count()}`);
}

main()
  .catch((error) => {
    console.error(`Seeding failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
