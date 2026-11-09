import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export interface IPasswordResetToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  requestedIpHash: string;
  createdAt: Date;
}

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    requestedIpHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

passwordResetTokenSchema.index({ tokenHash: 1 }, { unique: true });
passwordResetTokenSchema.index({ userId: 1, consumedAt: 1 });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type PasswordResetTokenDocument = HydratedDocument<IPasswordResetToken>;

export const PasswordResetToken: Model<IPasswordResetToken> =
  (mongoose.models.PasswordResetToken as Model<IPasswordResetToken> | undefined) ??
  mongoose.model<IPasswordResetToken>('PasswordResetToken', passwordResetTokenSchema);
