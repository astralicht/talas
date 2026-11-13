import mongoose, { Schema, type Model, type HydratedDocument } from 'mongoose';

export interface IMaterialAsset {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  materialId: mongoose.Types.ObjectId;
  /** Server-owned S3 key: materials/{userId}/{materialId}/images/{assetId}. */
  assetKey: string;
  contentType: string;
  byteSize: number;
  /** 1-based source page for PDFs; null for DOCX. */
  pageNumber: number | null;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

const assetSchema = new Schema<IMaterialAsset>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    materialId: { type: Schema.Types.ObjectId, ref: 'Material', required: true },
    assetKey: { type: String, required: true, maxlength: 512 },
    contentType: { type: String, required: true, maxlength: 100 },
    byteSize: { type: Number, required: true, min: 1 },
    pageNumber: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
  },
  { timestamps: true },
);

assetSchema.index({ assetKey: 1 }, { unique: true });
assetSchema.index({ userId: 1, materialId: 1 });

export type MaterialAssetDocument = HydratedDocument<IMaterialAsset>;

export const MaterialAsset: Model<IMaterialAsset> =
  (mongoose.models.MaterialAsset as Model<IMaterialAsset> | undefined) ??
  mongoose.model<IMaterialAsset>('MaterialAsset', assetSchema);
