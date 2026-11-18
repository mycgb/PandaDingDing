import { test } from 'node:test'
import assert from 'node:assert/strict'
import { num } from './types.ts'

assert.equal(num(1441.68), 1441.68)
assert.equal(num('-'), null)
assert.equal(num(''), null)
assert.equal(num(null), null)
assert.equal(num(undefined), null)
assert.equal(num('2.333'), 2.333)
assert.equal(num('abc'), null)
assert.equal(num(NaN), null)

console.log('num-guard: all tests passed')
