import { pool } from '../db/connection';

export interface Box {
  id: number;
  name: string;
  created_at: Date;
}

export async function createBox(name: string): Promise<Box> {
  const result = await pool.query(
    'INSERT INTO boxes (name) VALUES ($1) RETURNING *',
    [name]
  );
  return result.rows[0];
}

export async function getAllBoxes(): Promise<Box[]> {
  const result = await pool.query('SELECT * FROM boxes ORDER BY created_at DESC');
  return result.rows;
}

export async function getBoxById(id: number): Promise<Box | null> {
  const result = await pool.query('SELECT * FROM boxes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function deleteBox(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM boxes WHERE id = $1', [id]);
  return result.rowCount > 0;
}

