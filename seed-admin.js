const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

async function createAdmin() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-teaching-assistant');
    console.log('MongoDB connected');

    const email = 'admin@test.com';
    const existingAdmin = await User.findOne({ email });

    if (existingAdmin) {
      console.log('Admin user already exists. Updating password...');
      const salt = await bcrypt.genSalt(10);
      existingAdmin.password = await bcrypt.hash('admin123', salt);
      await existingAdmin.save();
      console.log('Admin password reset to admin123');
    } else {
      console.log('Creating new admin user...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      
      const adminUser = new User({
        name: 'System Admin',
        email: email,
        password: hashedPassword,
        role: 'ADMIN'
      });
      await adminUser.save();
      console.log('Admin user created successfully');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.disconnect();
  }
}

createAdmin();
