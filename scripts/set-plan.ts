import { connectDb, disconnectDb } from '../lib/db/connection';
import { User } from '../lib/db/models/user';
import { PLAN_IDS } from '../lib/plans';

/**
 * Switches a user's plan tier (Step 9 — plan-based feature limits). Billing is
 * out of scope: tiers change through this script or direct DB edits.
 *
 *   pnpm db:set-plan alice@talas.local plus
 */
async function main(): Promise<void> {
  const [email, plan] = process.argv.slice(2);
  if (!email || !plan) {
    console.error('Usage: pnpm db:set-plan <email> <' + PLAN_IDS.join('|') + '>');
    process.exit(1);
  }
  if (!(PLAN_IDS as readonly string[]).includes(plan)) {
    console.error(`Unknown plan "${plan}". Valid plans: ${PLAN_IDS.join(', ')}`);
    process.exit(1);
  }

  await connectDb();
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: { plan } },
    { new: true },
  ).exec();
  if (!user) {
    console.error(`No user found with email ${email}`);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  }
  console.log(`Updated ${user.email}: plan = ${user.plan}`);
  await disconnectDb();
}

main().catch(async (error: unknown) => {
  console.error('set-plan failed', error);
  await disconnectDb().catch(() => undefined);
  process.exit(1);
});
