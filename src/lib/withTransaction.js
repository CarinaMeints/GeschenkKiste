const mongoose = require("mongoose");

async function withTransaction(work) {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const result = await work(session);

    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (_) {}

    const msg = String(err?.message || err);
    if (
      msg.includes("Transaction numbers are only allowed") ||
      msg.includes("replica set")
    ) {
      return work(null);
    }

    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { withTransaction };
