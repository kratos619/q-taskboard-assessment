import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/jwt";
import { loginSchema } from "@/schemas/auth";
import { badRequest, unauthorized } from "@/lib/auth";
import { rateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit";

// 10 attempts per IP per 15 minutes — throttles brute force / credential stuffing.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export async function POST(req: NextRequest) {
  if (!rateLimit(`login:${clientIp(req)}`, MAX_ATTEMPTS, WINDOW_MS)) {
    return tooManyRequests("too many login attempts, try again later");
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("invalid input", parsed.error.flatten());
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) return unauthorized("invalid credentials");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return unauthorized("invalid credentials");

  const token = signToken({ userId: user.id, email: user.email });
  return NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
    token,
  });
}
