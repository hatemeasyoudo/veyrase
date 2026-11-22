import { Pool } from 'pg';

let database;

export function connectDatabase(connectionString) {
  if (!connectionString) return null;
  if (database) return database;
  const uri = new URL(connectionString);
  uri.searchParams.set('sslmode', 'verify-full');
  const pool = new Pool({
    connectionString: uri.href,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', error => console.error('Idle database connection error:', error.name));
  database = {
    query: (text, values) => pool.query(text, values),
    async transaction(operation) {
      const client = await pool.connect();
      let discard;
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
        throw error;
      } finally {
        client.release(discard);
      }
    }
  };
  return database;
}
