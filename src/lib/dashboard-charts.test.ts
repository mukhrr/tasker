import { describe, expect, it } from 'vitest';
import {
  assignedPerDay,
  assignedToPaid,
  cleanTitle,
  payoutsDue,
  unpaidByStatus,
} from './dashboard-charts';

const now = new Date(2026, 10, 24, 12);
let n = 0;
const task = (over: object) => ({
  id: String(++n),
  status: 'assigned',
  status_group: 'todo' as const,
  amount: 250,
  payment_date: null,
  assigned_date: null,
  is_reviewer: null,
  archived: false,
  issue_url: 'https://github.com/Expensify/App/issues/1',
  issue_number: 1,
  issue_title: null,
  ...over,
});

describe('assignedPerDay', () => {
  it('counts each role per day and compares with the window before', () => {
    const tasks = [
      task({ assigned_date: '2026-11-24' }),
      task({ assigned_date: '2026-11-24', is_reviewer: true }),
      task({ assigned_date: '2026-11-12' }),
      task({ assigned_date: '2026-10-01' }),
    ];
    const r = assignedPerDay(tasks, now);
    expect(r.days).toHaveLength(10);
    expect(r.days[0].date).toBe('2026-11-15');
    expect(r.days.at(-1)).toMatchObject({ committer: 1, reviewer: 1 });
    expect(r).toMatchObject({ total: 2, reviewer: 1, previous: 1 });
    expect(assignedPerDay(tasks, now, 90).total).toBe(4);
  });
});

describe('payoutsDue', () => {
  it('splits pending tasks by a past payment date and skips the rest', () => {
    const r = payoutsDue(
      [
        task({ status_group: 'pending', payment_date: '2026-11-02' }),
        task({ status_group: 'pending', payment_date: '2026-11-25' }),
        task({ status_group: 'pending' }),
        task({
          status_group: 'pending',
          payment_date: '2026-11-01',
          archived: true,
        }),
        task({ status_group: 'in_progress', payment_date: '2026-11-01' }),
      ],
      now
    );
    expect(r.overdue.map((o) => o.daysLate)).toEqual([22]);
    expect(r.upcoming.map((u) => u.paymentDate)).toEqual(['2026-11-25', null]);
    expect(r.total).toBe(750);
  });

  it('drops the bracketed tags from a title', () => {
    expect(
      cleanTitle('[Due for payment 2026-11-02] [$250] Chat - Doc file')
    ).toBe('Chat - Doc file');
  });
});

describe('unpaidByStatus', () => {
  it('groups open money by status, closest to payout first', () => {
    const r = unpaidByStatus(
      [
        task({ status: 'merged', status_group: 'in_progress', amount: 175 }),
        task({
          status: 'merged',
          status_group: 'in_progress',
          is_reviewer: true,
        }),
        task({ status: 'submit', status_group: 'pending' }),
        task({ status: 'paid', status_group: 'complete' }),
        task({ status: 'hold', status_group: 'in_progress', amount: 100 }),
      ],
      [
        { key: 'merged', label: 'Merged', group_name: 'in_progress' },
        { key: 'submit', label: 'Submit in ND', group_name: 'pending' },
        { key: 'hold', label: 'HOLD', group_name: 'todo' },
      ]
    );
    expect(r.groups.map((g) => g.group)).toEqual([
      'pending',
      'in_progress',
      'todo',
    ]);
    expect(r.groups[1].rows[0]).toMatchObject({
      label: 'Merged',
      committer: 175,
      reviewer: 250,
      count: 2,
    });
    expect(r).toMatchObject({ total: 775, count: 4 });
  });
});

describe('assignedToPaid', () => {
  it('buckets paid tasks and takes the median', () => {
    const paid = (assigned: string, paidOn: string) =>
      task({
        status_group: 'complete',
        assigned_date: assigned,
        payment_date: paidOn,
      });
    const r = assignedToPaid([
      paid('2026-10-01', '2026-10-05'),
      paid('2026-10-01', '2026-10-22'),
      paid('2026-08-01', '2026-10-01'),
      task({
        status_group: 'complete',
        amount: 0,
        assigned_date: '2026-10-01',
        payment_date: '2026-10-02',
      }),
    ]);
    expect(r.buckets.map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 1]);
    expect(r).toMatchObject({ median: 21, count: 3 });
  });
});
