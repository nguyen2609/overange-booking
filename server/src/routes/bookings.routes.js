import { Router } from 'express';
import prisma from '../db.js';
import authenticate from '../middleware/authenticate.js';

const router = Router();

router.get('/me', authenticate, async (req, res) => {
  try {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, slotId: true, createdAt: true },
    });
    return res.json(bookings);
  } catch (error) {
    console.error('Failed to load current user bookings:', error);
    return res.status(500).json({ error: 'Unable to load your bookings. Please try again later.' });
  }
});

router.delete('/:bookingId', authenticate, async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (!/^[1-9]\d*$/.test(req.params.bookingId)
    || !Number.isInteger(bookingId) || bookingId > 2147483647) {
    return res.status(400).json({ error: 'bookingId must be a positive 32-bit integer.' });
  }

  try {
    // Check ownership and delete in one query, so another user's row is never deleted.
    const result = await prisma.booking.deleteMany({
      where: { id: bookingId, userId: req.user.id },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    return res.status(204).end();
  } catch (error) {
    console.error('Booking cancellation failed:', error);
    return res.status(500).json({ error: 'Unable to cancel booking. Please try again later.' });
  }
});

router.post('/', authenticate, async (req, res) => {
  const { slotId } = req.body || {};

  if (!Number.isInteger(slotId) || slotId < 1 || slotId > 2147483647) {
    return res.status(400).json({ error: 'slotId must be a positive 32-bit integer.' });
  }

  try {
    const slot = await prisma.slot.findUnique({
      where: { id: slotId },
      select: { id: true },
    });

    if (!slot) {
      return res.status(404).json({ error: 'Slot not found.' });
    }

    const booking = await prisma.booking.create({
      data: {
        // Never use a userId supplied in the body. The middleware verifies it.
        userId: req.user.id,
        slotId,
      },
      select: { id: true, userId: true, slotId: true, createdAt: true },
    });

    return res.status(201).json(booking);
  } catch (error) {
    // The database unique constraint also catches simultaneous duplicate requests.
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'You have already booked this slot.' });
    }

    console.error('Booking failed:', error);
    return res.status(500).json({ error: 'Unable to create booking. Please try again later.' });
  }
});

export default router;
