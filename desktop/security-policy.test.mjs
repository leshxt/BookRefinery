import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAllowedExternalLink,
  isAllowedRendererRequest,
  isValidSaveRequest,
  safeSaveFilename,
} from './security-policy.mjs'

describe('desktop security policy', () => {
  it('allows only packaged renderer resources', () => {
    assert.equal(isAllowedRendererRequest('bookrefinery://app/index.html'), true)
    assert.equal(isAllowedRendererRequest('blob:bookrefinery://app/local-worker'), true)
    assert.equal(isAllowedRendererRequest('https://github.com/leshxt'), false)
    assert.equal(isAllowedRendererRequest('file:///C:/secret.txt'), false)
    assert.equal(isAllowedRendererRequest('data:text/plain,hello'), false)
  })

  it('allows only exact user-facing GitHub destinations', () => {
    assert.equal(isAllowedExternalLink('https://github.com/leshxt'), true)
    assert.equal(isAllowedExternalLink('https://github.com/leshxt/BookRefinery/releases'), true)
    assert.equal(isAllowedExternalLink('https://github.com/leshxt/BookRefinery/issues'), false)
    assert.equal(isAllowedExternalLink('https://github.com.evil.invalid/leshxt'), false)
  })

  it('accepts only bounded ZIP saves with a basename', () => {
    assert.equal(safeSaveFilename('book-refined.zip'), 'book-refined.zip')
    assert.equal(safeSaveFilename('../book.zip'), null)
    assert.equal(safeSaveFilename('book.pdf'), null)
    assert.equal(isValidSaveRequest({
      suggestedName: 'book.zip',
      mimeType: 'application/zip',
      data: new ArrayBuffer(4),
    }), true)
  })
})
