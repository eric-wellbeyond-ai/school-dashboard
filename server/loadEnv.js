/**
 * Load school-dashboard/.env from this file's location, not process.cwd().
 * Existing process.env (Vercel) is left alone — dotenv does not override.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });
