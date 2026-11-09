import { Types } from 'mongoose';
import { hashPassword } from '@/lib/auth/password';

export type UserStatus = 'active' | 'disabled' | 'deleting' | 'deleted';

export interface TestUserInput {
  id?: Types.ObjectId;
  email?: string;
  password?: string;
  emailVerifiedAt?: Date | null;
  status?: UserStatus;
}

export interface TestUser {
  id: Types.ObjectId;
  email: string;
  password: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  status: UserStatus;
}

export async function makeUser(input: TestUserInput = {}): Promise<TestUser> {
  const email = (input.email ?? `user-${new Types.ObjectId().toHexString()}@example.com`).toLowerCase();
  const password = input.password ?? 'correct horse battery staple';
  return {
    id: input.id ?? new Types.ObjectId(),
    email,
    password,
    passwordHash: await hashPassword(password),
    emailVerifiedAt:
      input.emailVerifiedAt === undefined ? new Date() : input.emailVerifiedAt,
    status: input.status ?? 'active',
  };
}

export function makeUnverifiedUser(input: TestUserInput = {}): Promise<TestUser> {
  return makeUser({ ...input, emailVerifiedAt: null });
}
