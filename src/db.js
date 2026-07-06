let pool;

function getPool() {
  if (pool) {
    return pool;
  }

  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error('DATABASE_URL is not configured'), { statusCode: 500 });
  }

  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch (error) {
    throw Object.assign(new Error('PostgreSQL dependency is not installed. Run npm install.'), {
      statusCode: 500,
    });
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  query,
  closePool,
};
