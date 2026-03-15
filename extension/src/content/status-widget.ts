import type { Task, UserStatus, TaskStatusGroup } from '../shared/types';
import type { MessageRequest, TaskResponse, StatusesResponse, UpdateResponse, CreateTaskResponse } from '../shared/messages';
import { COLOR_HEX, STATUS_GROUP_LABELS, STATUS_GROUP_ORDER } from '../shared/constants';

function sendMessage<T>(msg: MessageRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

function isDarkMode(): boolean {
  return document.documentElement.getAttribute('data-color-mode') === 'dark' ||
    document.documentElement.getAttribute('data-dark-theme') === 'dark' ||
    document.documentElement.classList.contains('dark');
}

function getColorHex(colorName: string): string {
  return COLOR_HEX[colorName] ?? COLOR_HEX.gray;
}

export class StatusWidget {
  private container: HTMLDivElement;
  private shadow: ShadowRoot;
  private root: HTMLDivElement;
  private task: Task | null = null;
  private statuses: UserStatus[] = [];
  private dropdownOpen = false;
  private loading = true;
  private error: string | null = null;
  private owner: string;
  private repo: string;
  private number: number;

  constructor(owner: string, repo: string, number: number) {
    this.owner = owner;
    this.repo = repo;
    this.number = number;

    this.container = document.createElement('div');
    this.container.id = 'tasker-status-widget';
    this.shadow = this.container.attachShadow({ mode: 'closed' });
    this.root = document.createElement('div');
    this.shadow.appendChild(this.root);

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target as Node) && this.dropdownOpen) {
        this.dropdownOpen = false;
        this.render();
      }
    });
  }

  get element(): HTMLDivElement {
    return this.container;
  }

  async init() {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      // Fetch session first
      const sessionRes = await sendMessage<{ ok: boolean; data?: { userId: string } | null }>({ type: 'GET_SESSION' });
      if (!sessionRes.ok || !sessionRes.data) {
        this.loading = false;
        this.error = 'Not signed in to Tasker';
        this.render();
        return;
      }

      // Fetch task and statuses in parallel
      const [taskRes, statusesRes] = await Promise.all([
        sendMessage<TaskResponse>({ type: 'QUERY_TASK', owner: this.owner, repo: this.repo, number: this.number }),
        sendMessage<StatusesResponse>({ type: 'QUERY_STATUSES' }),
      ]);

      if (!taskRes.ok) {
        this.error = taskRes.error ?? 'Failed to load task';
      } else {
        this.task = taskRes.data ?? null;
      }

      if (statusesRes.ok && statusesRes.data) {
        this.statuses = statusesRes.data;
      }
    } catch (err) {
      this.error = (err as Error).message ?? 'Connection error';
    }

    this.loading = false;
    this.render();
  }

  private render() {
    const dark = isDarkMode();
    this.root.innerHTML = '';
    this.root.className = `tasker-root ${dark ? 'dark' : 'light'}`;

    if (this.loading) {
      this.root.innerHTML = `<div class="section"><div class="header">Tasker</div><div class="spinner-wrap"><div class="spinner"></div></div></div>`;
      return;
    }

    if (this.error) {
      this.root.innerHTML = `
        <div class="section">
          <div class="header">Tasker</div>
          <div class="error-msg">${this.escapeHtml(this.error)}</div>
          <button class="retry-btn">Retry</button>
        </div>`;
      this.root.querySelector('.retry-btn')?.addEventListener('click', () => this.init());
      return;
    }

    if (!this.task) {
      this.renderAddButton();
      return;
    }

    this.renderStatusBadge();
  }

  private renderAddButton() {
    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = `<div class="header">Tasker</div>`;

    const btn = document.createElement('button');
    btn.className = 'add-btn';
    btn.textContent = 'Add to Tasker';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Adding...';

      const res = await sendMessage<CreateTaskResponse>({
        type: 'CREATE_TASK',
        owner: this.owner,
        repo: this.repo,
        number: this.number,
      });

      if (res.ok && res.data) {
        this.task = res.data;
        this.render();
      } else {
        btn.textContent = res.error ?? 'Failed';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Add to Tasker'; }, 2000);
      }
    });

    section.appendChild(btn);
    this.root.appendChild(section);
  }

  private renderStatusBadge() {
    const task = this.task!;
    const currentStatus = this.statuses.find((s) => s.key === task.status);
    const colorHex = currentStatus ? getColorHex(currentStatus.color) : getColorHex('gray');
    const label = currentStatus?.label ?? task.status;

    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = `<div class="header">Tasker</div>`;

    const badge = document.createElement('button');
    badge.className = 'status-badge';
    badge.innerHTML = `
      <span class="dot" style="background:${colorHex}"></span>
      <span class="label">${this.escapeHtml(label)}</span>
      <span class="chevron">${this.dropdownOpen ? '&#9650;' : '&#9660;'}</span>
    `;
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdownOpen = !this.dropdownOpen;
      this.render();
    });

    section.appendChild(badge);

    if (this.dropdownOpen) {
      section.appendChild(this.renderDropdown());
    }

    this.root.appendChild(section);
  }

  private renderDropdown(): HTMLDivElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';

    const grouped = this.groupStatuses();

    for (const group of STATUS_GROUP_ORDER) {
      const items = grouped[group];
      if (!items || items.length === 0) continue;

      const groupLabel = document.createElement('div');
      groupLabel.className = 'group-label';
      groupLabel.textContent = STATUS_GROUP_LABELS[group];
      dropdown.appendChild(groupLabel);

      for (const status of items) {
        const row = document.createElement('button');
        row.className = `status-row ${this.task?.status === status.key ? 'active' : ''}`;
        row.innerHTML = `
          <span class="dot" style="background:${getColorHex(status.color)}"></span>
          <span class="label">${this.escapeHtml(status.label)}</span>
        `;
        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.updateStatus(status.key, status.group_name);
        });
        dropdown.appendChild(row);
      }
    }

    return dropdown;
  }

  private async updateStatus(statusKey: string, groupName: TaskStatusGroup) {
    if (!this.task) return;

    const oldStatus = this.task.status;
    const oldGroup = this.task.status_group;

    // Optimistic update
    this.task.status = statusKey;
    this.task.status_group = groupName;
    this.dropdownOpen = false;
    this.render();

    const res = await sendMessage<UpdateResponse>({
      type: 'UPDATE_STATUS',
      taskId: this.task.id,
      status: statusKey,
      statusGroup: groupName,
    });

    if (!res.ok) {
      // Rollback
      this.task.status = oldStatus;
      this.task.status_group = oldGroup;
      this.error = res.error ?? 'Update failed';
      this.render();
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
  }

  private groupStatuses(): Record<TaskStatusGroup, UserStatus[]> {
    const groups: Record<TaskStatusGroup, UserStatus[]> = {
      todo: [],
      in_progress: [],
      complete: [],
    };
    for (const s of this.statuses) {
      groups[s.group_name]?.push(s);
    }
    for (const group of STATUS_GROUP_ORDER) {
      groups[group].sort((a, b) => a.position - b.position);
    }
    return groups;
  }

  private escapeHtml(str: string): string {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
  }

  destroy() {
    this.container.remove();
  }

  private getStyles(): string {
    return `
      .tasker-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .tasker-root.dark {
        color: #e6edf3;
      }
      .tasker-root.light {
        color: #1f2328;
      }

      .section {
        border-top: 1px solid var(--border);
        padding-top: 16px;
        position: relative;
      }
      .tasker-root.light .section { border-color: #d1d9e0; }
      .tasker-root.dark .section { border-color: #3d444d; }

      .header {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
      }
      .tasker-root.light .header { color: #1f2328; }
      .tasker-root.dark .header { color: #e6edf3; }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
        transition: background 0.1s;
      }
      .tasker-root.light .status-badge:hover { background: #f6f8fa; }
      .tasker-root.dark .status-badge:hover { background: #21262d; }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .label {
        flex: 1;
      }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
      }

      .dropdown {
        position: absolute;
        bottom: 100%;
        left: 0;
        right: 0;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.16);
        max-height: 300px;
        overflow-y: auto;
        margin-bottom: 4px;
      }
      .tasker-root.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .dropdown {
        background: #2d333b;
        border: 1px solid #3d444d;
      }

      .group-label {
        font-size: 11px;
        font-weight: 600;
        padding: 6px 8px 2px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.6;
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: inherit;
      }
      .tasker-root.light .status-row:hover { background: #f6f8fa; }
      .tasker-root.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .add-btn {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: 1px solid #d1d9e0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.1s;
      }
      .tasker-root.dark .add-btn { border-color: #3d444d; }
      .add-btn:hover { background: #f6f8fa; }
      .tasker-root.dark .add-btn:hover { background: #21262d; }
      .add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

      .error-msg {
        font-size: 12px;
        color: #cf222e;
        margin-bottom: 6px;
      }
      .tasker-root.dark .error-msg { color: #f85149; }

      .retry-btn {
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid #d1d9e0;
        border-radius: 4px;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .tasker-root.dark .retry-btn { border-color: #3d444d; }

      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: 8px 0;
      }
      .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #d1d9e0;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
  }
}
