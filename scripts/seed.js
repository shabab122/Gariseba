'use strict';
const { connectDatabase, ensureDefaults } = require('../src/db');
const { samplePricing } = require('../src/defaults');

async function main() {
  const db = await connectDatabase();
  try {
    await ensureDefaults(db);
    if (await db.pricing.countDocuments({ sample: { $ne: true } }, { limit: 1 })) {
      console.log('Business price rules already exist. Sample rules were skipped.');
      return;
    }
    const result = await db.pricing.bulkWrite(samplePricing.map(({ _id, ...row }) => ({
      updateOne: { filter: { _id }, update: { $setOnInsert: row }, upsert: true },
    })));
    console.log(`Added ${result.upsertedCount} sample price rules. Existing rules were kept.`);
  } finally {
    await db.client.close();
  }
}

main().catch((error) => {
  console.error('Seed failed. Check MongoDB and .env.', error.name);
  process.exitCode = 1;
});
