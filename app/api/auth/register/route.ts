import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createUser } from '@/lib/db';
import logger from '@/lib/logger';

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(100),
});

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body: unknown = await req.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { email, name, password } = parsed.data;
    const user = createUser(email.toLowerCase().trim(), name.trim(), password);
    logger.info('User registered', { userId: user.id });

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'Email already registered') {
      return Response.json({ error: 'Email already in use' }, { status: 409 });
    }
    logger.error('Register error', { error: msg });
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
