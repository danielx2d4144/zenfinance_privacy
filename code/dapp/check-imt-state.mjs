import { openDB } from 'idb';

const db = await openDB('zenfinance-vault', 1);
const tx = db.transaction(['supply-imt-leaves'], 'readonly');
const store = tx.objectStore('supply-imt-leaves');
const allKeys = await store.getAllKeys();
console.log('Supply IMT leaf count:', allKeys.length);
console.log('Leaf indices:', allKeys.slice(0, 10));
await db.close();
