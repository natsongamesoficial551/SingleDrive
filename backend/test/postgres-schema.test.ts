import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('PostgreSQL schema preserves the local MySQL data model', async () => {
  const mysql = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
  const postgres = await readFile(new URL('../prisma-postgres/schema.prisma', import.meta.url), 'utf8')
  assert.equal(postgres.replace('provider = "postgresql"', 'provider = "mysql"').replace(/\r\n/g, '\n'), mysql.replace(/\r\n/g, '\n'))
})
