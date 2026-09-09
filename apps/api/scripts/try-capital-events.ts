import 'reflect-metadata';
import postgres from '../../../packages/database/node_modules/postgres/src/index.js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { CapitalEventsService } from '../src/addon/account-context';

const client = postgres(process.env.DATABASE_URL!, { max: 2 });
const db = drizzle(client) as never;
try {
  const rows = await new CapitalEventsService(db).get('9f34e10b-27d1-457a-bcdc-590f2eb9fa4a', 90, 5);
  console.log('  OK,', rows.length, 'rows');
  for (const r of rows) console.log('   ', r.customer, '|', r.subject.slice(0, 42), '|', r.daysAgo + 'd |', r.owner);
} catch (e) {
  console.log('  ERROR:', (e as Error).message);
}
await client.end();
