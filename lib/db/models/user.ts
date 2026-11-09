import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export const USER_STATUSES = ['active', 'disabled', 'deleting', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  _id: mongoose.Types.ObjectId;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  status: UserStatus;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ status: 1, deletedAt: 1 });

export type UserDocument = HydratedDocument<IUser>;

export const User: Model<IUser> =
  (mongoose.models.User as Model<IUser> | undefined) ??
  mongoose.model<IUser>('User', userSchema);
