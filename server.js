require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8110;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/assessments', require('./routes/assessment'));
app.use('/api/submissions', require('./routes/submission'));
app.use('/api/files', require('./routes/files'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));

app.get('/', (req, res) => {
  res.send('AI Teaching Assistant API is running');
});

// Start Server with graceful error handling
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Handle EADDRINUSE — port already in use (e.g. old nodemon zombie process)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Attempting to kill the process...`);
    try {
        const { execSync } = require('child_process');
        execSync(`node utils/kill-port.cjs ${PORT}`);
        console.log(`✅ Process on port ${PORT} killed. Retrying in 1 second...`);
    } catch (kErr) {
        console.error(`❌ Failed to kill process on port ${PORT}:`, kErr.message);
    }
    
    setTimeout(() => {
      server.close();
      server.listen(PORT);
    }, 1000);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

// Graceful shutdown so nodemon can cleanly restart without zombie processes
const shutdown = (signal) => {
  console.log(`\n🛑 ${signal} received. Closing server gracefully...`);
  server.close(() => {
    console.log('✅ Server closed. Exiting.');
    process.exit(0);
  });
  // Force exit if server doesn't close in 3 seconds
  setTimeout(() => process.exit(0), 3000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

