import { Types, type ClientSession } from 'mongoose';
import { withTransaction } from '@/lib/db/connection';
import { RefreshToken } from '@/lib/db/models/refresh-token';
import { AppError, errors } from '@/lib/http/errors';
import { hashIdentifier } from '@/lib/logging/correlation';
import { generateOpaqueToken, hashToken, refreshTokenExpiry } from './tokens';

export interface RefreshTokenMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
  id: Types.ObjectId;
}

export class RefreshTokenReuseError extends AppError {
  readonly reusedTokenId: string;

  constructor(reusedTokenId: string) {
    super('unauthorized', 401, 'Your session has expired. Sign in again.');
    this.name = 'RefreshTokenReuseError';
    this.reusedTokenId = reusedTokenId;
  }
}

export async function issueRefreshToken(
  userId: string | Types.ObjectId,
  meta: RefreshTokenMeta = {},
  session?: ClientSession,
): Promise<IssuedRefreshToken> {
  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = refreshTokenExpiry();
  const [record] = await RefreshToken.create(
    [
      {
        userId: new Types.ObjectId(userId),
        tokenHash,
        expiresAt,
        ipHash: hashIdentifier(meta.ip ?? ''),
        userAgentHash: hashIdentifier(meta.userAgent ?? ''),
      },
    ],
    session ? { session } : undefined,
  );
  if (!record) throw new Error('Refresh token could not be created');
  return { token, tokenHash, expiresAt, id: record._id };
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

export async function rotateRefreshToken(
  rawToken: string,
  meta: RefreshTokenMeta = {},
): Promise<RotatedRefreshToken> {
  const presentedHash = hashToken(rawToken);
  let reuseFamilyUserId: Types.ObjectId | null = null;

  try {
    return await withTransaction(async (session) => {
      const existing = await RefreshToken.findOne({ tokenHash: presentedHash })
        .session(session)
        .exec();

      if (!existing) {
        throw errors.unauthorized('Your session has expired. Sign in again.');
      }

      if (existing.revokedAt) {
        // Detected reuse of an already-revoked token: the whole token family
        // for this user must be revoked. The revocation itself MUST happen
        // outside the rotation transaction — throwing from inside aborts the
        // transaction and would roll its own revocation back, letting the
        // stolen token family survive (constitution v2.0.0 reuse-detection).
        reuseFamilyUserId = existing.userId;
        throw new RefreshTokenReuseError(existing._id.toHexString());
      }

      if (existing.expiresAt.getTime() <= Date.now()) {
        throw errors.unauthorized('Your session has expired. Sign in again.');
      }

      const next = await issueRefreshToken(existing.userId, meta, session);
      existing.revokedAt = new Date();
      existing.replacedByTokenId = next.id;
      await existing.save({ session });

      return { ...next, userId: existing.userId.toHexString() };
    });
  } catch (error) {
    // Runs after the transaction has aborted, so the revocation can never be
    // rolled back by the reuse error that triggered it.
    if (reuseFamilyUserId) {
      await RefreshToken.updateMany(
        { userId: reuseFamilyUserId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
    }
    if (error instanceof RefreshTokenReuseError) throw error;
    if (error instanceof AppError) throw error;
    throw errors.unauthorized('Your session has expired. Sign in again.');
  }
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  ).exec();
}

export async function revokeAllForUser(
  userId: string | Types.ObjectId,
  session?: ClientSession,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { userId: new Types.ObjectId(userId), revokedAt: null },
    { $set: { revokedAt: new Date() } },
    session ? { session } : undefined,
  ).exec();
  return result.modifiedCount ?? 0;
}
