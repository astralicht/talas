import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export interface IEmailVerificationToken {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

const emailVerificationTokenSchema = new Schema<IEmailVerificationToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

emailVerificationTokenSchema.index({ tokenHash: 1 }, { unique: true });
emailVerificationTokenSchema.index({ userId: 1, consumedAt: 1 });
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailVerificationTokenDocument = HydratedDocument<IEmailVerificationToken>;

export const EmailVerificationToken: Model<IEmailVerificationToken> =
  (mongoose.models.EmailVerificationToken as Model<IEmailVerificationToken> | undefined) ??
  mongoose.model<IEmailVerificationToken>(
    'EmailVerificationToken',
    emailVerificationTokenSchema,
  );
