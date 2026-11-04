import { describe, it, expect } from 'vitest';
import { paymentDateToWrite, userSetStatus } from './manual';
import type { Task } from '@/types/database';

const task = (over: Partial<Task>) =>
  ({
    created_at: '2026-09-01T00:00:00Z',
    status_changed_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    last_synced_at: null,
    ...over,
  }) as Task;

describe('userSetStatus', () => {
  it('ignores the trigger stamping updated_at just after the sync wrote', () => {
    expect(
      userSetStatus(
        task({
          last_synced_at: '2026-09-28T06:53:39.380Z',
          status_changed_at: '2026-05-15T17:28:12Z',
          updated_at: '2026-09-28T06:53:39.417Z',
        })
      )
    ).toBe(false);
  });

  it('treats a status the sync itself set as not manual', () => {
    const at = '2026-09-28T06:53:39.380Z';
    expect(
      userSetStatus(task({ last_synced_at: at, status_changed_at: at }))
    ).toBe(false);
  });

  it('sees a status changed by hand after the last sync', () => {
    expect(
      userSetStatus(
        task({
          last_synced_at: '2026-09-28T06:53:39Z',
          status_changed_at: '2026-09-28T09:00:00Z',
        })
      )
    ).toBe(true);
  });

  it('does not treat a note edit as a status edit', () => {
    expect(
      userSetStatus(
        task({
          last_synced_at: '2026-09-28T06:53:39Z',
          updated_at: '2026-09-28T09:00:00Z',
        })
      )
    ).toBe(false);
  });

  it('still protects a status set on a never-synced task', () => {
    expect(
      userSetStatus(task({ status_changed_at: '2026-09-02T00:00:00Z' }))
    ).toBe(true);
  });
});

describe('paymentDateToWrite', () => {
  it('keeps a date already on the task', () => {
    expect(
      paymentDateToWrite({ payment_date: '2026-11-20' }, '2026-05-15')
    ).toBeNull();
  });

  it('fills an empty date', () => {
    expect(paymentDateToWrite({ payment_date: null }, '2026-05-15')).toBe(
      '2026-05-15'
    );
  });

  it('writes nothing without a suggestion', () => {
    expect(paymentDateToWrite({ payment_date: null }, undefined)).toBeNull();
  });
});
