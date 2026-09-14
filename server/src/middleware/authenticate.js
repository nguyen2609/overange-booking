import jwt from 'jsonwebtoken';
import prisma from '../db.js';

export default async function authenticate(req, res, next) {
  const authorization = req.get('Authorization');
  const match = typeof authorization === 'string'
    ? /^Bearer +(\S+)$/i.exec(authorization)
    : null;

  if (!match) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret || !secret.trim()) {
      throw new Error('JWT_SECRET is not configured in server/.env.');
    }

    const payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });

    // Prisma User IDs are positive 32-bit integers. Do not trust arbitrary
    // payload values, even if a token has a valid signature.
    if (typeof payload !== 'object' || payload === null
      || !Number.isInteger(payload.userId)
      || payload.userId < 1 || payload.userId > 2147483647) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    // Only safe fields are attached; passwordHash is never loaded here.
    req.user = user;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError
      || error instanceof jwt.TokenExpiredError
      || error instanceof jwt.NotBeforeError) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }

    console.error('Authentication failed:', error);
    return res.status(500).json({ error: 'Unable to authenticate. Please try again later.' });
  }
}
