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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add updated_at column to boxes if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='updated_at'
        ) THEN
          ALTER TABLE boxes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add parent_box_id column for king box hierarchy if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='parent_box_id'
        ) THEN
          ALTER TABLE boxes ADD COLUMN parent_box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS idx_boxes_parent_box_id ON boxes(parent_box_id);
        END IF;
      END $$;
    `);

    // Add is_king_box column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='is_king_box'
        ) THEN
          ALTER TABLE boxes ADD COLUMN is_king_box BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Create postboxes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS postboxes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tracking_numbers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_numbers (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(255) UNIQUE NOT NULL,
        box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL,
        postbox_id INTEGER REFERENCES postboxes(id) ON DELETE SET NULL,
        current_status VARCHAR(20) DEFAULT 'not_scanned' CHECK (current_status IN ('not_scanned', 'scanned', 'delivered')),
        status_details TEXT,
        custom_timestamp TIMESTAMP,
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

    // Add postbox_id column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='postbox_id'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN postbox_id INTEGER REFERENCES postboxes(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add custom_timestamp column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='custom_timestamp'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN custom_timestamp TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add is_manual_status column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='is_manual_status'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN is_manual_status BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Add trackingmore_status column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='trackingmore_status'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN trackingmore_status VARCHAR(100);
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

    // Create tracking_events table for detailed event timeline
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        tracking_number_id INTEGER NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
        event_date TIMESTAMP NOT NULL,
        location VARCHAR(255),
        status VARCHAR(100),
        description TEXT,
        checkpoint_status VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_box_id ON tracking_numbers(box_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_postbox_id ON tracking_numbers(postbox_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_status ON tracking_numbers(current_status);
      CREATE INDEX IF NOT EXISTS idx_status_history_tracking_id ON status_history(tracking_number_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_timestamp ON status_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking_id ON tracking_events(tracking_number_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_date ON tracking_events(event_date);
    `);

    // Nullify postbox_id in tracking_numbers (migrate away from postboxes)
    await pool.query(`
      UPDATE tracking_numbers 
      SET postbox_id = NULL 
      WHERE postbox_id IS NOT NULL
    `);

    console.log('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();

