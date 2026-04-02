require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const Interest = require("../src/models/Interest");
const Occasion = require("../src/models/Occasion");
const Gift = require("../src/models/Gift");

async function seedCatalog() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB verbunden\n");

    const interestsFile = path.join(__dirname, "../seed-data/interests.json");
    const interestsData = JSON.parse(fs.readFileSync(interestsFile, "utf8"));

    console.log("📋 Importiere Interessen...");
    const interestMap = {};

    for (const data of interestsData) {
      const interest = await Interest.findOneAndUpdate(
        { name: data.name, isPublic: true },
        { $set: { ...data, isPublic: true } },
        { upsert: true, new: true },
      );

      console.log(`  ✓ ${data.name} (${data.icon})`);
      interestMap[data.name] = interest._id;
    }

    const occasionsFile = path.join(__dirname, "../seed-data/occasions.json");
    const occasionsData = JSON.parse(fs.readFileSync(occasionsFile, "utf8"));

    console.log("\n🎉 Importiere Anlässe...");

    for (const data of occasionsData) {
      await Occasion.findOneAndUpdate(
        { name: data.name, isPublic: true },
        { $set: { ...data, isPublic: true } },
        { upsert: true, new: true },
      );

      console.log(`  ✓ ${data.name} (${data.icon})`);
    }

    const giftsFile = path.join(__dirname, "../seed-data/gift-templates.json");
    const giftsData = JSON.parse(fs.readFileSync(giftsFile, "utf8"));

    console.log("\n🎁 Importiere Geschenk-Templates...");

    for (const data of giftsData) {
      const interestIds = (data.interests || [])
        .map((name) => interestMap[name])
        .filter(Boolean);

      await Gift.findOneAndUpdate(
        { title: data.title, isPublic: true },
        {
          $set: {
            title: data.title,
            description: data.description,
            interests: interestIds,
            isPublic: true,
          },
        },
        { upsert: true, new: true },
      );

      console.log(`  ✓ ${data.title}`);
    }

    console.log("\n✅ Import abgeschlossen!\n");
    console.log("📊 Statistik:");
    console.log(`   Interessen:  ${Object.keys(interestMap).length}`);
    console.log(`   Anlässe:     ${occasionsData.length}`);
    console.log(`   Templates:   ${giftsData.length}\n`);
  } catch (err) {
    console.error("❌ Fehler:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Verbindung getrennt");
  }
}

seedCatalog();
