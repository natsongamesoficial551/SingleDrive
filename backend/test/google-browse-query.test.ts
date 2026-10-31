import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGoogleBrowseQuery } from '../src/modules/google/browse-query.js'

test('Google Drive browsing selects the requested folder and excludes trash', () => {
  assert.equal(parseGoogleBrowseQuery({}).driveQuery, "'root' in parents and trashed = false")
  assert.equal(parseGoogleBrowseQuery({ folderId: 'folder-123_ab' }).driveQuery, "'folder-123_ab' in parents and trashed = false")
  assert.equal(parseGoogleBrowseQuery({ shared: 'true' }).driveQuery, 'sharedWithMe = true and trashed = false')
  assert.equal(parseGoogleBrowseQuery({ shared: 'true', folderId: 'folder-123' }).driveQuery, "'folder-123' in parents and trashed = false")
})

test('Google Drive browsing rejects query injection and invalid pagination', () => {
  assert.throws(() => parseGoogleBrowseQuery({ folderId: "root' or trashed = true or 'x" }))
  assert.throws(() => parseGoogleBrowseQuery({ shared: 'anything' }))
  assert.throws(() => parseGoogleBrowseQuery({ pageToken: 'x'.repeat(2049) }))
})
