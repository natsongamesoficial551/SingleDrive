const { test } = require('node:test')
const assert = require('node:assert/strict')
const { migrationDatabaseUrl } = require('../dist/scripts/deploy-migrations.js')

test('migração Neon usa endpoint direto preservando autenticação e TLS', () => {
  const pooled = 'postgresql://u:p@ep-example-123-pooler.c-6.us-east-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true'
  const result = new URL(migrationDatabaseUrl(pooled))
  assert.equal(result.hostname, 'ep-example-123.c-6.us-east-2.aws.neon.tech')
  assert.equal(result.username, 'u')
  assert.equal(result.password, 'p')
  assert.equal(result.searchParams.get('sslmode'), 'require')
  assert.equal(result.searchParams.has('pgbouncer'), false)
})
test('URL direta explícita tem prioridade e outros hosts não são alterados', () => {
  const local = 'postgresql://test@localhost:5432/test'
  assert.equal(migrationDatabaseUrl(local), local)
  assert.equal(migrationDatabaseUrl(local, 'postgresql://other/db'), 'postgresql://other/db')
  const other = 'postgresql://u:p@ep-name-pooler.attacker.example/db'
  assert.equal(migrationDatabaseUrl(other), other)
})
