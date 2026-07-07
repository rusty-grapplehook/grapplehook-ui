// Copies the static renderer (html/css/js) into dist so `electron .` and
// electron-builder only ever need the dist folder.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'src', 'renderer');
const dest = path.join(root, 'dist', 'renderer');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied renderer -> ${path.relative(root, dest)}`);
