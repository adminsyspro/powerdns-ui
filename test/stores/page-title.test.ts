import assert from 'node:assert';
import { usePageTitleStore } from '../../src/stores/page-title';

assert.equal(usePageTitleStore.getState().title, '', 'default empty');
usePageTitleStore.getState().setTitle('Zones');
assert.equal(usePageTitleStore.getState().title, 'Zones', 'setTitle updates');
usePageTitleStore.getState().setTitle('');
assert.equal(usePageTitleStore.getState().title, '', 'can clear');
console.log('usePageTitleStore: ALL PASSED');
