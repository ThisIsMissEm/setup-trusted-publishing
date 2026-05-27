import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccess, AccessConflictError } from '../src/access.ts';

describe('resolveAccess', () => {

  // Row 9: no private, no publishConfig, no flag → public, inferred-default
  test('plain new package → public inferred-default', () => {
    const r = resolveAccess({ isPrivate: undefined, existingAccess: undefined, flagAccess: undefined, force: false });
    assert.deepStrictEqual(r, { value: 'public', reason: 'inferred-default', changed: true });
  });

  // Row 8: private: true, no publishConfig, no flag → restricted, inferred-private
  test('private:true no publishConfig → restricted inferred-private', () => {
    const r = resolveAccess({ isPrivate: true, existingAccess: undefined, flagAccess: undefined, force: false });
    assert.deepStrictEqual(r, { value: 'restricted', reason: 'inferred-private', changed: true });
  });

  // Row 7: existing public, no flag → no change
  test('existing publishConfig.access public, no flag → no change', () => {
    const r = resolveAccess({ isPrivate: undefined, existingAccess: 'public', flagAccess: undefined, force: false });
    assert.deepStrictEqual(r, { value: 'public', reason: 'existing', changed: false });
  });

  // Row 5: no existing, --access restricted → restricted, cli-flag
  test('no publishConfig, --access restricted → restricted cli-flag', () => {
    const r = resolveAccess({ isPrivate: undefined, existingAccess: undefined, flagAccess: 'restricted', force: false });
    assert.deepStrictEqual(r, { value: 'restricted', reason: 'cli-flag', changed: true });
  });

  // Row 3: private:true, --access public, no force → throws flag-vs-private
  test('private:true --access public no force → throws flag-vs-private', () => {
    assert.throws(
      () => resolveAccess({ isPrivate: true, existingAccess: undefined, flagAccess: 'public', force: false }),
      (err: unknown) => {
        assert.ok(err instanceof AccessConflictError);
        assert.strictEqual(err.conflict, 'flag-vs-private');
        return true;
      }
    );
  });

  // Row 4: private:true, --access public, force → public, cli-flag
  test('private:true --access public --force → public cli-flag', () => {
    const r = resolveAccess({ isPrivate: true, existingAccess: undefined, flagAccess: 'public', force: true });
    assert.deepStrictEqual(r, { value: 'public', reason: 'cli-flag', changed: true });
  });

  // Row 5 variant: private:true, --access restricted → ok, no conflict
  test('private:true --access restricted → restricted cli-flag (no conflict)', () => {
    const r = resolveAccess({ isPrivate: true, existingAccess: undefined, flagAccess: 'restricted', force: false });
    assert.deepStrictEqual(r, { value: 'restricted', reason: 'cli-flag', changed: true });
  });

  // Row 1: existing public, --access restricted, no force → throws flag-vs-existing
  test('existing public --access restricted no force → throws flag-vs-existing', () => {
    assert.throws(
      () => resolveAccess({ isPrivate: undefined, existingAccess: 'public', flagAccess: 'restricted', force: false }),
      (err: unknown) => {
        assert.ok(err instanceof AccessConflictError);
        assert.strictEqual(err.conflict, 'flag-vs-existing');
        return true;
      }
    );
  });

  // Row 2: existing public, --access restricted, force → restricted, overwrote
  test('existing public --access restricted --force → restricted overwrote:public', () => {
    const r = resolveAccess({ isPrivate: undefined, existingAccess: 'public', flagAccess: 'restricted', force: true });
    assert.deepStrictEqual(r, { value: 'restricted', reason: 'cli-flag', changed: true, overwrote: 'public' });
  });

  // Row 6: existing public, --access public → no change (matches)
  test('existing public --access public → no change (matches)', () => {
    const r = resolveAccess({ isPrivate: undefined, existingAccess: 'public', flagAccess: 'public', force: false });
    assert.deepStrictEqual(r, { value: 'public', reason: 'existing', changed: false });
  });

});
