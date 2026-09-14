import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('booking migration preserves existing rows and replaces the daily limit', async () => {
  // Test the actual SQL on an in-memory database with old-format bookings.
  const database = new DatabaseSync(':memory:');

  try {
    database.exec(await readFile(new URL('../prisma/migrations/20260912163237_init/migration.sql', import.meta.url), 'utf8'));
    database.exec(`
      INSERT INTO "User" (id, name, email, passwordHash)
      VALUES (7, 'Test Anna', 'anna@example.test', 'test-only'),
             (8, 'Test John', 'john@example.test', 'test-only');
      INSERT INTO "Slot" (id, date, startTime, endTime)
      VALUES (11, '2026-09-14', '09:00', '10:00'),
             (12, '2026-09-14', '10:00', '11:00');
      INSERT INTO "Booking" (id, userId, slotId, date, createdAt)
      VALUES (21, 7, 11, '2026-09-14', '2026-09-01 12:00:00'),
             (22, 8, 11, '2026-09-14', '2026-09-02 12:00:00');
    `);

    const before = database.prepare('SELECT id, userId, slotId, createdAt FROM Booking ORDER BY id').all();
    const usersBefore = database.prepare('SELECT * FROM User ORDER BY id').all();
    const slotsBefore = database.prepare('SELECT * FROM Slot ORDER BY id').all();
    database.exec(await readFile(new URL('../prisma/migrations/20260912165641_allow_multiple_daily_bookings/migration.sql', import.meta.url), 'utf8'));

    assert.deepEqual(database.prepare('SELECT * FROM Booking ORDER BY id').all(), before);
    assert.deepEqual(database.prepare('SELECT * FROM User ORDER BY id').all(), usersBefore);
    assert.deepEqual(database.prepare('SELECT * FROM Slot ORDER BY id').all(), slotsBefore);
    assert.ok(!database.prepare("PRAGMA table_info('Booking')").all().some((column) => column.name === 'date'));
    database.exec('INSERT INTO Booking (userId, slotId) VALUES (7, 12)');
    assert.throws(() => database.exec('INSERT INTO Booking (userId, slotId) VALUES (7, 11)'), /UNIQUE constraint failed/);
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
});
