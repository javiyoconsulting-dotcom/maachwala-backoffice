require('./env').loadEnv();

const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('./db');

async function migrate() {
  const migrationPath = path.resolve(process.cwd(), 'migrations', '001_create_organizations.sql');
  const sql = await fs.readFile(migrationPath, 'utf8');

  await db.query(sql);
  await db.closePool();

  console.log('Migration completed: organizations table is ready');
}

migrate().catch(async (error) => {
  await db.closePool().catch(() => {});
  console.error(error.message);
  process.exitCode = 1;
});
