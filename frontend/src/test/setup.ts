import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);

// jsdom does not implement the native dialog lifecycle.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
