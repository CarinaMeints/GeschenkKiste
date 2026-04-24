const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✅ MongoDB verbunden`);
    
    mongoose.connection.on('error', err => {
      console.error('❌ MongoDB Fehler:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('❌ MongoDB Verbindung getrennt');
    });
    
  } catch (error) {
    console.error('❌ Fehler bei MongoDB Verbindung:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
