import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const target of ['mobile/assets/icon.png', 'mobile/assets/favicon.png', 'frontend/public/images/brand/fortuna.png', 'frontend/src/app/icon.png', 'frontend/src/app/apple-icon.png']) {
  const destination = path.join(root, target);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, 'branding/fortuna.png'), destination);
}
console.log('Fortuna logo synchronized across web and mobile.');
