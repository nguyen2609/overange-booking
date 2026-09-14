import { Router } from 'express';
import prisma from '../db.js';
import authenticate from '../middleware/authenticate.js';

const router = Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const schedule = await prisma.slot.findMany({
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        bookings: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    return res.json(schedule);
  } catch (error) {
    console.error('Failed to load shared schedule:', error);
    return res.status(500).json({ error: 'Unable to load shared schedule. Please try again later.' });
  }
});

export default router;
