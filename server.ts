import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, server } from './src/server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const distPath = path.resolve(__dirname, 'dist');

// Serve static frontend assets if built
app.use(express.static(distPath));

// Fallback all non-API routes to index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('Smart Print Kiosk Server is running.');
    }
  });
});

server.listen(PORT, () => {
  console.log(`[Smart Print Kiosk] Production Server running on port ${PORT}`);
});
