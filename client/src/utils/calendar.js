// Treat YYYY-MM-DD as a calendar date. UTC arithmetic avoids timezone shifts.
export function addDays(date, numberOfDays) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + numberOfDays);
  return result.toISOString().slice(0, 10);
}

export function getWeekStart(date) {
  const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

export function getCurrentWeekStart(now = new Date()) {
  // Use the same default scheduling timezone as the backend seed script.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => parts.find((item) => item.type === type).value;
  return getWeekStart(`${part('year')}-${part('month')}-${part('day')}`);
}

export function formatDate(date, includeYear = false) {
  const [year, month, day] = date.split('-');
  return includeYear ? `${day}/${month}/${year}` : `${day}/${month}`;
}
