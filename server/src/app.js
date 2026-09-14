import express from 'express';
import prisma from './db.js';
import authRoutes from './routes/auth.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import { createCorsMiddleware } from './middleware/cors.js';

const app = express();

app.use(createCorsMiddleware());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/schedule', scheduleRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'The Express backend is running!',
  });
});

app.get('/api/slots', async (req, res) => {
  try {
    const slots = await prisma.slot.findMany({
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
      },
    });

    res.json(slots);
  } catch (error) {
    console.error('Failed to load slots:', error);
    res.status(500).json({ error: 'Unable to load slots. Please try again later.' });
  }
});

// Return JSON for parser errors instead of Express's default HTML error page.
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.' });
  }

  console.error('Request failed:', error);
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
});

export default app;
