'use strict';
const applyRestore = async ({ plan, User, mongoose }) => {
  if (!plan || !Array.isArray(plan.accounts) || !User || !mongoose) {
    throw new TypeError('A valid restore plan, User model, and mongoose instance are required.');
  }

  const session = await mongoose.startSession();
  let restored = 0;

  try {
    await session.withTransaction(async () => {
      restored = 0;

      for (const entry of plan.accounts) {
        const result = await User.updateOne(
          { _id: entry.id },
          { $set: { points: entry.points, returns: entry.returns } },
          { session }
        );

        if (result.matchedCount !== 1) {
          throw new Error(`Account ${entry.id} was not found; restore aborted.`);
        }

        restored += 1;
      }
    });

    return restored;
  } finally {
    await session.endSession();
  }
};
module.exports = { applyRestore };