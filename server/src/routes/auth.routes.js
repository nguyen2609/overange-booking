import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import authenticate from '../middleware/authenticate.js';

const router = Router();
const saltRounds = 10;

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // bcrypt uses only the first 72 UTF-8 bytes. Reject longer passwords instead
  // of silently accepting passwords that would be truncated during hashing.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must not exceed 72 UTF-8 bytes.' });
  }

  try {
    // Do not trim or change the password before hashing it.
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
      },
      // Only these fields can be returned to the client.
      select: { id: true, name: true, email: true, createdAt: true },
    });

    return res.status(201).json({ user });
  } catch (error) {
    // The database unique constraint also protects simultaneous registrations.
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Email is already registered.' });
    }

    console.error('Registration failed:', error);
    return res.status(500).json({ error: 'Unable to register. Please try again later.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required.' });
  }
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must not exceed 72 UTF-8 bytes.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, name: true, email: true, passwordHash: true },
    });

    // Use the same response for an unknown email and an incorrect password.
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret || !secret.trim()) {
      throw new Error('JWT_SECRET is not configured in server/.env.');
    }

    const token = jwt.sign({ userId: user.id }, secret, {
      algorithm: 'HS256',
      expiresIn: '1d',
    });

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Unable to log in. Please try again later.' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

export default router;
