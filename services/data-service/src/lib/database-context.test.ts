import {test} from 'node:test';
import assert from 'node:assert/strict';
import prisma from './prisma';
import {withDatabase} from './database-context';
test('production singleton can be used as a scoped database without recursive proxy access',async()=>{
 await withDatabase(prisma,async()=>{assert.equal(typeof prisma.user.findMany,'function');assert.equal(typeof prisma.$transaction,'function');});
});
