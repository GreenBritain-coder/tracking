import { pool } from './connection';

async function migrate() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create boxes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tracking_numbers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_numbers (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(255) UNIQUE NOT NULL,
        box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL,
        current_status VARCHAR(20) DEFAULT 'not_scanned' CHECK (current_status IN ('not_scanned', 'scanned', 'delivered')),
        status_details TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add status_details column if it doesn't exist (for existing databases)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='status_details'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN status_details TEXT;
        END IF;
      END $$;
    `);

    // Create status_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS status_history (
        id SERIAL PRIMARY KEY,
        tracking_number_id INTEGER NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL CHECK (status IN ('not_scanned', 'scanned', 'delivered')),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_box_id ON tracking_numbers(box_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_status ON tracking_numbers(current_status);
      CREATE INDEX IF NOT EXISTS idx_status_history_tracking_id ON status_history(tracking_number_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_timestamp ON status_history(timestamp);
    `);

    console.log('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();

