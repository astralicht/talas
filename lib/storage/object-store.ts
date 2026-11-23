/**
 * Object storage seam (TODO step 11). Every blob operation in the app goes
 * through these six functions so the backing store can change without
 * touching call sites: keys keep their `materials/{userId}/{materialId}`
 * shape, sizes are bounded by the maxBytes arguments, and deletions return
 * the number of objects removed for prefix sweeps.
 *
 * The active driver is GridFS (blob bytes live in the app database — see
 * `./gridfs`); there is no other driver.
 */
export {
  putObject,
  headObject,
  getObjectBytes,
  getObjectPrefixBytes,
  deleteObject,
  deleteObjectPrefix,
} from './gridfs';
