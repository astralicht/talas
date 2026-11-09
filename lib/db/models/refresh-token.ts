import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export interface IRefreshToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: mongoose.Types.ObjectId | null;
  ipHash: string;
  userAgentHash: string;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByTokenId: { type: Schema.Types.ObjectId, default: null },
    ipHash: { type: String, required: true },
    userAgentHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;

export const RefreshToken: Model<IRefreshToken> =
  (mongoose.models.RefreshToken as Model<IRefreshToken> | undefined) ??
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
