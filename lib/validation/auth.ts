import { z } from 'zod';
import {
  emailSchema,
  objectIdSchema,
  passwordSchema,
  shortTokenSchema,
  strictObject,
} from './common';

export const registerSchema = strictObject({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const emailRequestSchema = strictObject({
  email: emailSchema,
});

export const verifyEmailSchema = strictObject({
  token: shortTokenSchema,
});

export const resetPasswordSchema = strictObject({
  token: shortTokenSchema,
  password: passwordSchema,
});

export const materialIdSchema = strictObject({
  materialId: objectIdSchema,
});

export const lessonIdSchema = strictObject({
  lessonId: objectIdSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type EmailRequestInput = z.infer<typeof emailRequestSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export function publicUser(user: {
  _id: { toHexString: () => string } | string;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: typeof user._id === 'string' ? user._id : user._id.toHexString(),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt,
  };
}
