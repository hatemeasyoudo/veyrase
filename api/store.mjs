import { connectDatabase } from '../server/database.mjs';
import { serveStore } from '../server/store.mjs';

export default {
  fetch(request) {
    return serveStore(request, {
      database: () => connectDatabase(process.env.DATABASE_URL),
      adminPassword: process.env.ADMIN_PASSWORD
    });
  }
};
