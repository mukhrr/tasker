import type { Task, UserStatus, TaskStatusGroup, Proposal } from '../shared/types';
import type {
  MessageRequest,
  MessageResponse,
  TaskResponse,
  StatusesResponse,
  UpdateResponse,
  CreateTaskResponse,
  TasksBatchResponse,
  IssueLabelsResponse,
  ProposalResponse,
  AutoPostResponse,
} from '../shared/messages';
import { COLOR_HEX, STATUS_GROUP_LABELS, STATUS_GROUP_ORDER } from '../shared/constants';

const PROPOSAL_REQUIRED_LABELS = ['bug', 'daily'];
const PROPOSAL_READY_LABEL = 'help wanted';
const PROPOSAL_POLL_INTERVAL_MS = 2000;

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

type WidgetMode = 'issue' | 'pr';

export class StatusWidget {
  private container: HTMLDivElement;
  private shadow: ShadowRoot;
  private root: HTMLDivElement;
  private task: Task | null = null;
  private linkedTasks: Task[] = [];
  private statuses: UserStatus[] = [];
  private dropdownOpen = false;
  private loading = true;
  private error: string | null = null;
  private owner: string;
  private repo: string;
  private number: number;
  private mode: WidgetMode;
  private linkedIssueNumbers: number[];
  private labels: string[] = [];
  private proposal: Proposal | null = null;
  private proposalDraftBody = '';
  private proposalBusy = false;
  private proposalPollHandle: ReturnType<typeof setInterval> | null = null;
  private proposalNotice: string | null = null;
  private destroyed = false;
  private autoPostEnabled = true;

  constructor(owner: string, repo: string, number: number, mode: WidgetMode = 'issue', linkedIssueNumbers: number[] = []) {
    this.owner = owner;
    this.repo = repo;
    this.number = number;
    this.mode = mode;
    this.linkedIssueNumbers = linkedIssueNumbers;

    this.container = document.createElement('div');
    this.container.id = 'tasker-status-widget';
    if (mode === 'pr') {
      this.container.style.display = 'inline-flex';
      this.container.style.alignItems = 'center';
      this.container.style.flexShrink = '0';
      this.container.style.alignSelf = 'start';
      this.container.style.position = 'relative';
    }
    this.shadow = this.container.attachShadow({ mode: 'closed' });
    this.root = document.createElement('div');
    this.shadow.appendChild(this.root);

    const style = document.createElement('style');
    style.textContent = this.mode === 'pr' ? this.getHeaderStyles() : this.getSidebarStyles();
    this.shadow.appendChild(style);

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
      const sessionRes = await sendMessage<{ ok: boolean; data?: { userId: string } | null }>({ type: 'GET_SESSION' });
      if (!sessionRes.ok || !sessionRes.data) {
        this.loading = false;
        this.error = 'Not signed in to Tasker';
        this.render();
        return;
      }

      if (this.mode === 'pr') {
        await this.initPr();
      } else {
        await this.initIssue();
      }
    } catch (err) {
      this.error = (err as Error).message ?? 'Connection error';
    }

    this.loading = false;
    this.render();
  }

  private async initIssue() {
    const [taskRes, statusesRes, labelsRes, proposalRes, autoPostRes] = await Promise.all([
      sendMessage<TaskResponse>({ type: 'QUERY_TASK', owner: this.owner, repo: this.repo, number: this.number }),
      sendMessage<StatusesResponse>({ type: 'QUERY_STATUSES' }),
      sendMessage<IssueLabelsResponse>({ type: 'QUERY_ISSUE_LABELS', owner: this.owner, repo: this.repo, number: this.number }),
      sendMessage<ProposalResponse>({ type: 'QUERY_PROPOSAL', owner: this.owner, repo: this.repo, number: this.number }),
      sendMessage<AutoPostResponse>({ type: 'GET_AUTOPOST' }),
    ]);

    if (!taskRes.ok) {
      this.error = taskRes.error ?? 'Failed to load task';
    } else {
      this.task = taskRes.data ?? null;
    }

    if (statusesRes.ok && statusesRes.data) {
      this.statuses = statusesRes.data;
    }

    if (labelsRes.ok && labelsRes.data) {
      this.labels = labelsRes.data;
    }

    if (proposalRes.ok) {
      this.proposal = proposalRes.data ?? null;
      this.proposalDraftBody = this.proposal?.body ?? '';
    }

    if (autoPostRes.ok && autoPostRes.data) {
      this.autoPostEnabled = autoPostRes.data.enabled;
    }

    // Poll while the row is in a transient server-driven state so the widget
    // observes the drafter's queued → drafting → armed → posted progression
    // without a page reload.
    const pollStates = ['queued', 'drafting', 'armed', 'posting'];
    if (this.proposal && pollStates.includes(this.proposal.state)) {
      this.startProposalPoll();
    }

    // If the row says 'posted' but the user deleted the comment on GitHub,
    // revert to draft so the textarea (with the saved body) reappears and
    // they can repost without manual surgery on the DB row.
    if (this.proposal?.state === 'posted' && this.proposal.github_comment_id) {
      void this.verifyPostedComment();
    }
  }

  private async verifyPostedComment(): Promise<void> {
    if (!this.proposal || this.proposal.state !== 'posted') return;
    const proposalId = this.proposal.id;
    const res = await sendMessage<MessageResponse<Proposal>>({
      type: 'VERIFY_POSTED_COMMENT',
      proposalId,
    });
    if (this.destroyed) return;
    if (!res.ok || !res.data) return;
    if (res.data.state !== this.proposal?.state) {
      const reverted = res.data.state === 'draft';
      this.proposal = res.data;
      this.proposalDraftBody = res.data.body ?? '';
      if (reverted) {
        this.proposalNotice = 'Previous comment was deleted on GitHub — reverted to draft.';
        setTimeout(() => {
          if (this.destroyed) return;
          this.proposalNotice = null;
          this.render();
        }, 8000);
      }
      this.render();
    }
  }

  private async initPr() {
    if (this.linkedIssueNumbers.length === 0) {
      this.error = 'No linked issues found';
      return;
    }

    const [batchRes, statusesRes] = await Promise.all([
      sendMessage<TasksBatchResponse>({ type: 'QUERY_TASKS_BATCH', owner: this.owner, repo: this.repo, issueNumbers: this.linkedIssueNumbers }),
      sendMessage<StatusesResponse>({ type: 'QUERY_STATUSES' }),
    ]);

    if (!batchRes.ok) {
      this.error = batchRes.error ?? 'Failed to load tasks';
    } else {
      this.linkedTasks = batchRes.data ?? [];
    }

    if (statusesRes.ok && statusesRes.data) {
      this.statuses = statusesRes.data;
    }
  }

  private render() {
    if (this.mode === 'pr') {
      this.renderPr();
    } else {
      this.renderSidebar();
    }
  }

  // ── PR mode ──

  private renderPr() {
    const dark = isDarkMode();
    this.root.innerHTML = '';
    this.root.className = `tasker-header ${dark ? 'dark' : 'light'}`;

    if (this.loading) {
      this.root.innerHTML = `<button class="tasker-btn" disabled><div class="spinner"></div> Tasker</button>`;
      return;
    }

    if (this.error) {
      // Don't show widget if no linked issues or not signed in
      this.root.innerHTML = '';
      return;
    }

    if (this.linkedTasks.length === 0) {
      // No tracked tasks among linked issues — hide
      return;
    }

    this.renderPrStatusBadge();
  }

  private renderPrStatusBadge() {
    // Determine a common status, or show "Mixed" if they differ
    const statusKeys = new Set(this.linkedTasks.map(t => t.status));
    const isMixed = statusKeys.size > 1;
    let displayStatus: UserStatus | undefined;
    let colorHex: string;
    let label: string;

    if (isMixed) {
      colorHex = COLOR_HEX.purple;
      label = 'Mixed';
    } else {
      const key = this.linkedTasks[0].status;
      displayStatus = this.statuses.find(s => s.key === key);
      colorHex = displayStatus ? getColorHex(displayStatus.color) : getColorHex('gray');
      label = displayStatus?.label ?? key;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tasker-wrapper';

    const btn = document.createElement('button');
    btn.className = 'tasker-btn has-status';
    btn.innerHTML = `
      <span class="tasker-icon">T</span>
      <span class="dot" style="background:${colorHex}"></span>
      <span class="status-label">${this.escapeHtml(label)}</span>
      <span class="linked-count">${this.linkedTasks.length} issue${this.linkedTasks.length > 1 ? 's' : ''}</span>
      <span class="chevron">${this.dropdownOpen ? '&#9650;' : '&#9660;'}</span>
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dropdownOpen = !this.dropdownOpen;
      this.render();
    });

    wrapper.appendChild(btn);
    this.root.appendChild(wrapper);

    if (this.dropdownOpen) {
      this.root.appendChild(this.renderPrDropdown());
    }
  }

  private renderPrDropdown(): HTMLDivElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'dropdown';

    // Show which issues will be updated
    const notice = document.createElement('div');
    notice.className = 'linked-notice';
    notice.innerHTML = `Updating <strong>${this.linkedTasks.length}</strong> tracked issue${this.linkedTasks.length > 1 ? 's' : ''}: ${this.linkedTasks.map(t => `#${t.issue_number}`).join(', ')}`;
    dropdown.appendChild(notice);

    const grouped = this.groupStatuses();

    for (const group of STATUS_GROUP_ORDER) {
      const items = grouped[group];
      if (!items || items.length === 0) continue;

      const groupLabel = document.createElement('div');
      groupLabel.className = 'group-label';
      groupLabel.textContent = STATUS_GROUP_LABELS[group];
      dropdown.appendChild(groupLabel);

      for (const status of items) {
        const allMatch = this.linkedTasks.every(t => t.status === status.key);
        const row = document.createElement('button');
        row.className = `status-row ${allMatch ? 'active' : ''}`;
        row.innerHTML = `
          <span class="dot" style="background:${getColorHex(status.color)}"></span>
          <span class="label">${this.escapeHtml(status.label)}</span>
        `;
        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.updateLinkedStatuses(status.key, status.group_name);
        });
        dropdown.appendChild(row);
      }
    }

    return dropdown;
  }

  private async updateLinkedStatuses(statusKey: string, groupName: TaskStatusGroup) {
    const oldStatuses = this.linkedTasks.map(t => ({ status: t.status, group: t.status_group }));

    // Optimistic update
    for (const t of this.linkedTasks) {
      t.status = statusKey;
      t.status_group = groupName;
    }
    this.dropdownOpen = false;
    this.render();

    const issueNumbers = this.linkedTasks.map(t => t.issue_number).filter((n): n is number => n !== null);

    const res = await sendMessage<UpdateResponse>({
      type: 'UPDATE_LINKED_STATUSES',
      owner: this.owner,
      repo: this.repo,
      issueNumbers,
      status: statusKey,
      statusGroup: groupName,
    });

    if (!res.ok) {
      // Rollback
      this.linkedTasks.forEach((t, i) => {
        t.status = oldStatuses[i].status;
        t.status_group = oldStatuses[i].group;
      });
      this.error = res.error ?? 'Update failed';
      this.render();
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
  }

  // ── Sidebar mode (Issue) ──

  private renderSidebar() {
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

    this.renderProposalPanel();
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

    this.renderProposalPanel();
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
      this.task.status = oldStatus;
      this.task.status_group = oldGroup;
      this.error = res.error ?? 'Update failed';
      this.render();
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
  }

  // ── Proposal panel ──

  private hasReadyLabel(): boolean {
    return this.labels.some((l) => l.toLowerCase() === PROPOSAL_READY_LABEL);
  }

  private hasRequiredDraftLabels(): boolean {
    const lower = this.labels.map((l) => l.toLowerCase());
    return PROPOSAL_REQUIRED_LABELS.every((req) => lower.includes(req));
  }

  private isProposalPanelEligible(): boolean {
    // Always show on issue pages when signed in. Sub-states render hints
    // about label readiness (bug+daily vs already-Help-Wanted vs neither).
    return this.mode === 'issue';
  }

  private renderProposalPanel(): void {
    if (!this.isProposalPanelEligible()) return;

    const section = document.createElement('div');
    section.className = 'section proposal';
    section.innerHTML = `<div class="header">Proposal</div>`;

    const body = document.createElement('div');
    body.className = 'proposal-body';

    const state = this.proposal?.state ?? 'draft';
    const isArmed = state === 'armed' || state === 'posting';
    const isFinal = state === 'posted';
    const isFailed = state === 'failed';
    const isAutoDrafting = state === 'queued' || state === 'drafting';

    if (isAutoDrafting) {
      // Server-owned: the sniper queued this issue and the drafter is writing
      // the body. Show a read-only status; never expose the editable draft UI,
      // which would let a Save clobber the in-flight server state.
      const label = state === 'queued' ? 'Queued for auto-drafting…' : 'Auto-drafting proposal…';
      const statusEl = document.createElement('div');
      statusEl.className = 'proposal-status';
      statusEl.innerHTML = `
        <span class="check">🤖</span>
        <div>
          <div class="proposal-status-line">${this.escapeHtml(label)}</div>
          <div class="proposal-status-sub">A proposal is being written and will arm automatically.</div>
        </div>
      `;
      body.appendChild(statusEl);

      const cancelRow = document.createElement('div');
      cancelRow.className = 'proposal-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'proposal-btn';
      cancelBtn.textContent = this.proposalBusy ? 'Cancelling…' : 'Cancel';
      cancelBtn.disabled = this.proposalBusy;
      cancelBtn.title = 'Stop auto-drafting and keep this as an editable draft.';
      cancelBtn.addEventListener('click', () => void this.cancelAutoDraft());
      cancelRow.appendChild(cancelBtn);
      body.appendChild(cancelRow);

      section.appendChild(body);
      this.root.appendChild(section);
      return;
    }

    if (isFinal) {
      const when = this.proposal?.posted_at
        ? new Date(this.proposal.posted_at).toLocaleString()
        : '';
      body.innerHTML = `
        <div class="proposal-status posted">
          <span class="check">✓</span>
          <div>
            <div class="proposal-status-line">Posted ${this.escapeHtml(when)}</div>
            ${this.proposal?.github_comment_id ? `<a class="comment-link" href="https://github.com/${this.escapeHtml(this.owner)}/${this.escapeHtml(this.repo)}/issues/${this.number}#issuecomment-${this.proposal.github_comment_id}" target="_blank" rel="noopener">View comment →</a>` : ''}
          </div>
        </div>
      `;
      // Clear only removes the Tasker record — the posted GitHub comment stays.
      const clearRow = document.createElement('div');
      clearRow.className = 'proposal-actions';
      const clearBtn = document.createElement('button');
      clearBtn.className = 'proposal-btn';
      clearBtn.textContent = this.proposalBusy ? 'Clearing…' : 'Clear from Tasker';
      clearBtn.disabled = this.proposalBusy;
      clearBtn.title = 'Remove this record from Tasker. The posted GitHub comment is not deleted.';
      clearBtn.addEventListener('click', () => void this.clearProposal());
      clearRow.appendChild(clearBtn);
      body.appendChild(clearRow);
      section.appendChild(body);
      this.root.appendChild(section);
      return;
    }

    // Run Auto-pilot — hand the whole draft→validate→arm→post flow to the
    // server-side drafter. Offered in editable states only (draft/failed/none);
    // armed/posting/posted/queued/drafting rows don't need it.
    if (!isArmed) {
      const autopilotRow = document.createElement('div');
      autopilotRow.className = 'proposal-autopilot';
      const autopilotBtn = document.createElement('button');
      autopilotBtn.className = 'proposal-btn autopilot';
      autopilotBtn.textContent = this.proposalBusy ? 'Starting…' : '🤖 Run Auto-pilot';
      autopilotBtn.disabled = this.proposalBusy;
      autopilotBtn.title = 'Let the server draft, validate, and arm this proposal automatically.';
      autopilotBtn.addEventListener('click', () => void this.enqueueAutoDraft());
      autopilotRow.appendChild(autopilotBtn);
      const hint = document.createElement('div');
      hint.className = 'proposal-status-sub';
      hint.textContent = 'Drafts with Codex, validates, and arms — no typing needed.';
      autopilotRow.appendChild(hint);
      body.appendChild(autopilotRow);
    }

    if (this.proposalNotice) {
      const noticeEl = document.createElement('div');
      noticeEl.className = 'proposal-notice';
      noticeEl.textContent = this.proposalNotice;
      body.appendChild(noticeEl);
    }

    const armedAndDisabled = (state === 'armed' || state === 'posting') && !this.autoPostEnabled;
    if (armedAndDisabled) {
      const notice = document.createElement('div');
      notice.className = 'proposal-notice danger';
      notice.textContent = 'Auto-post is OFF in the Tasker popup — armed drafts are paused. Re-enable to post.';
      body.appendChild(notice);
    }

    const readyAlready = this.hasReadyLabel();
    const hasBugDaily = this.hasRequiredDraftLabels();
    if (readyAlready) {
      const notice = document.createElement('div');
      notice.className = 'proposal-notice';
      notice.textContent = '"Help Wanted" is already on this issue. Use “Post now” for an immediate manual post.';
      body.appendChild(notice);
    } else if (!hasBugDaily) {
      const notice = document.createElement('div');
      notice.className = 'proposal-notice subtle';
      notice.textContent = this.labels.length
        ? 'Labels: ' + this.labels.join(', ') + '. Will arm-and-wait for "Help Wanted".'
        : 'Labels not loaded. Will arm-and-wait for "Help Wanted" once added.';
      body.appendChild(notice);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'proposal-textarea';
    textarea.rows = 6;
    textarea.placeholder = '## Proposal\n\nDescribe your fix...';
    textarea.value = this.proposalDraftBody;
    textarea.disabled = isArmed || this.proposalBusy;
    body.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'proposal-actions';

    const computeDirty = (): boolean =>
      this.proposalDraftBody !== (this.proposal?.body ?? '') &&
      this.proposalDraftBody.trim().length > 0;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'proposal-btn secondary';
    saveBtn.textContent = this.proposalBusy ? 'Saving…' : (this.proposal ? 'Save changes' : 'Save draft');
    saveBtn.disabled = this.proposalBusy || isArmed || !computeDirty();
    saveBtn.addEventListener('click', () => void this.saveProposal());
    actions.appendChild(saveBtn);

    let armBtnRef: HTMLButtonElement | null = null;
    if (isArmed) {
      const disarmBtn = document.createElement('button');
      disarmBtn.className = 'proposal-btn';
      disarmBtn.textContent = state === 'posting' ? 'Posting…' : 'Disarm';
      disarmBtn.disabled = this.proposalBusy || state === 'posting';
      disarmBtn.addEventListener('click', () => void this.setProposalState('draft'));
      actions.appendChild(disarmBtn);
    } else {
      const armBtn = document.createElement('button');
      armBtn.className = 'proposal-btn primary';
      armBtn.textContent = this.proposalBusy ? 'Arming…' : 'Arm auto-post';
      const dirty = computeDirty();
      armBtn.disabled =
        this.proposalBusy ||
        !this.proposalDraftBody.trim() ||
        dirty; // must save first
      armBtn.title = dirty ? 'Save changes before arming' : '';
      armBtn.addEventListener('click', () => void this.setProposalState('armed'));
      actions.appendChild(armBtn);
      armBtnRef = armBtn;
    }

    body.appendChild(actions);

    // Manual "Post now" — bypasses Help-Wanted detection and the kill switch.
    // Visible when the row isn't yet posted/posting, so the user can fire
    // immediately if the label is already there or they just want to test.
    let postNowBtnRef: HTMLButtonElement | null = null;
    if (state !== 'posting') {
      const postRow = document.createElement('div');
      postRow.className = 'proposal-actions';
      const postNowBtn = document.createElement('button');
      postNowBtn.className = 'proposal-btn danger';
      postNowBtn.textContent = this.proposalBusy ? 'Posting…' : 'Post now';
      const trimmedNow = this.proposalDraftBody.trim().length > 0;
      postNowBtn.disabled = this.proposalBusy || !trimmedNow;
      postNowBtn.title = trimmedNow
        ? 'Post the current text as a comment immediately, without waiting for Help Wanted.'
        : 'Type your proposal first.';
      postNowBtn.addEventListener('click', () => void this.postProposalNow());
      postRow.appendChild(postNowBtn);
      body.appendChild(postRow);
      postNowBtnRef = postNowBtn;
    }

    // Clear draft — delete the saved row so the panel returns to its empty state.
    // Shown only when something is actually persisted (there is a row to clear).
    if (this.proposal) {
      const clearRow = document.createElement('div');
      clearRow.className = 'proposal-actions';
      const clearBtn = document.createElement('button');
      clearBtn.className = 'proposal-btn';
      clearBtn.textContent = this.proposalBusy ? 'Clearing…' : 'Clear draft';
      clearBtn.disabled = this.proposalBusy;
      clearBtn.title = 'Delete this saved proposal from Tasker and start over.';
      clearBtn.addEventListener('click', () => void this.clearProposal());
      clearRow.appendChild(clearBtn);
      body.appendChild(clearRow);
    }

    // Update button enable-state live as the user types — without re-rendering
    // the whole panel (which would yank focus out of the textarea on every key).
    textarea.addEventListener('input', () => {
      this.proposalDraftBody = textarea.value;
      const dirty = computeDirty();
      const trimmed = this.proposalDraftBody.trim().length > 0;
      saveBtn.disabled = this.proposalBusy || isArmed || !dirty;
      if (armBtnRef) {
        armBtnRef.disabled = this.proposalBusy || !trimmed || dirty;
        armBtnRef.title = dirty ? 'Save changes before arming' : '';
      }
      if (postNowBtnRef) {
        postNowBtnRef.disabled = this.proposalBusy || !trimmed;
        postNowBtnRef.title = trimmed
          ? 'Post the current text as a comment immediately, without waiting for Help Wanted.'
          : 'Type your proposal first.';
      }
    });

    const statusLine = document.createElement('div');
    statusLine.className = 'proposal-status-line';
    if (isArmed) {
      statusLine.textContent = state === 'posting'
        ? 'Posting now…'
        : 'Armed — waiting for "Help Wanted" label';
    } else if (this.proposal) {
      const at = this.proposal.updated_at
        ? new Date(this.proposal.updated_at).toLocaleString()
        : '';
      statusLine.textContent = `Draft saved · ${at}`;
    } else {
      statusLine.textContent = 'Auto-posts on "Help Wanted" via the poll worker.';
    }
    body.appendChild(statusLine);

    if (isFailed && this.proposal?.last_error) {
      const errEl = document.createElement('div');
      errEl.className = 'proposal-error';
      errEl.textContent = `Last error: ${this.proposal.last_error}`;
      body.appendChild(errEl);
    }

    section.appendChild(body);
    this.root.appendChild(section);
  }

  private async saveProposal(): Promise<void> {
    if (this.proposalBusy) return;
    this.proposalBusy = true;
    this.render();
    const res = await sendMessage<MessageResponse<Proposal>>({
      type: 'SAVE_PROPOSAL',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
      body: this.proposalDraftBody,
    });
    this.proposalBusy = false;
    if (res.ok && res.data) {
      this.proposal = res.data;
      this.proposalDraftBody = res.data.body;
    } else {
      this.error = res.error ?? 'Save failed';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
  }

  private async setProposalState(target: 'armed' | 'draft'): Promise<void> {
    if (this.proposalBusy) return;
    this.proposalBusy = true;
    this.render();
    const res = await sendMessage<MessageResponse<Proposal>>({
      type: target === 'armed' ? 'ARM_PROPOSAL' : 'DISARM_PROPOSAL',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
    });
    this.proposalBusy = false;
    if (res.ok && res.data) {
      this.proposal = res.data;
      if (res.data.state === 'armed' || res.data.state === 'posting') {
        this.startProposalPoll();
      } else {
        this.stopProposalPoll();
      }
    } else {
      this.error = res.error ?? 'Update failed';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
  }

  // "Run Auto-pilot": hand this issue to the server-side drafter, which writes
  // the proposal, validates it, and arms it (posting directly if Help Wanted is
  // already present). The row goes to state='queued'; the widget then shows the
  // read-only auto-drafting status and polls the progression.
  private async enqueueAutoDraft(): Promise<void> {
    if (this.proposalBusy) return;
    this.proposalBusy = true;
    this.render();
    const res = await sendMessage<MessageResponse<Proposal>>({
      type: 'ENQUEUE_AUTO_DRAFT',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
    });
    this.proposalBusy = false;
    if (res.ok && res.data) {
      this.proposal = res.data;
      this.startProposalPoll();
    } else {
      this.error = res.error ?? 'Could not start Auto-pilot';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
  }

  // Cancel an in-flight auto-draft: the row becomes an editable manual draft and
  // the drafter stops. Poll stops; the panel re-renders as the normal editor.
  private async cancelAutoDraft(): Promise<void> {
    if (this.proposalBusy) return;
    this.proposalBusy = true;
    this.render();
    const res = await sendMessage<MessageResponse<Proposal>>({
      type: 'CANCEL_AUTO_DRAFT',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
    });
    this.proposalBusy = false;
    if (res.ok && res.data) {
      this.proposal = res.data;
      this.proposalDraftBody = res.data.body ?? '';
      this.stopProposalPoll();
    } else {
      this.error = res.error ?? 'Could not cancel';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
  }

  // Clear draft: delete the proposals row from the DB and reset the panel to its
  // empty state. Refused server-side while a draft/post is in flight.
  private async clearProposal(): Promise<void> {
    if (this.proposalBusy) return;
    if (!confirm('Clear this proposal? This deletes the saved draft from Tasker.')) return;
    this.proposalBusy = true;
    this.render();
    const res = await sendMessage<MessageResponse<void>>({
      type: 'CLEAR_PROPOSAL',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
    });
    this.proposalBusy = false;
    if (res.ok) {
      this.proposal = null;
      this.proposalDraftBody = '';
      this.proposalNotice = null;
      this.stopProposalPoll();
    } else {
      this.error = res.error ?? 'Could not clear';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
  }

  // Manual "Post now": save the current textarea, then force-post regardless
  // of label state and the auto-post kill switch. Used when the issue already
  // has Help Wanted, or for one-off posting without arming.
  private async postProposalNow(): Promise<void> {
    if (this.proposalBusy) return;
    const body = this.proposalDraftBody.trim();
    if (!body) return;
    if (!confirm('Post this proposal as a comment now?')) return;

    this.proposalBusy = true;
    this.render();

    try {
      // Always save first so the row exists and reflects exactly what we post.
      const saveRes = await sendMessage<MessageResponse<Proposal>>({
        type: 'SAVE_PROPOSAL',
        owner: this.owner,
        repo: this.repo,
        number: this.number,
        body: this.proposalDraftBody,
      });
      if (!saveRes.ok || !saveRes.data) {
        this.error = saveRes.error ?? 'Save failed';
        setTimeout(() => { this.error = null; this.render(); }, 3000);
        return;
      }
      this.proposal = saveRes.data;

      // Optimistically flip to 'posting' AND start polling the row from
      // Supabase. The DB state is the source of truth — even if the
      // sendMessage promise hangs (MV3 can kill the service worker mid-fetch
      // and silently drop the response), the poll loop will catch the row
      // landing in 'posted' or 'failed' and update the UI.
      this.proposal = { ...this.proposal, state: 'posting' };
      this.startProposalPoll();
      this.render();

      // Force-post — bypasses the kill switch and accepts draft|armed|failed.
      const postRes = await sendMessage<MessageResponse<Proposal>>({
        type: 'POST_PROPOSAL_NOW',
        proposalId: saveRes.data.id,
        force: true,
      });

      if (postRes.ok && postRes.data) {
        this.proposal = postRes.data;
        if (postRes.data.state === 'posted' || postRes.data.state === 'failed') {
          this.stopProposalPoll();
        }
      } else {
        this.error = postRes.error ?? 'Post failed';
        setTimeout(() => { this.error = null; this.render(); }, 5000);
        // Pull canonical state — handler may have flipped to 'failed'.
        void this.refreshProposal();
      }
    } catch (e) {
      // Common cause: MV3 service worker died mid-fetch and the message
      // channel closed. The proposal poll started above will catch the
      // eventual DB state and update the UI.
      console.error('[tasker] postProposalNow threw', e);
      this.error = e instanceof Error ? e.message : 'Post failed (channel closed)';
      setTimeout(() => { this.error = null; this.render(); }, 5000);
    } finally {
      this.proposalBusy = false;
      this.render();
    }
  }

  private startProposalPoll(): void {
    this.stopProposalPoll();
    this.proposalPollHandle = setInterval(() => {
      void this.refreshProposal();
    }, PROPOSAL_POLL_INTERVAL_MS);
  }

  private stopProposalPoll(): void {
    if (this.proposalPollHandle !== null) {
      clearInterval(this.proposalPollHandle);
      this.proposalPollHandle = null;
    }
  }

  private async refreshProposal(): Promise<void> {
    if (this.destroyed) return;
    const res = await sendMessage<ProposalResponse>({
      type: 'QUERY_PROPOSAL',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
    });
    if (this.destroyed) return;
    if (!res.ok || !res.data) return;
    const next = res.data;
    if (!this.proposal || next.state !== this.proposal.state || next.posted_at !== this.proposal.posted_at) {
      this.proposal = next;
      if (next.state === 'posted' || next.state === 'failed' || next.state === 'draft') {
        this.stopProposalPoll();
      }
      this.render();
    }
  }

  // ── Shared helpers ──

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
    this.destroyed = true;
    this.stopProposalPoll();
    this.container.remove();
  }

  // ── Header styles (PR pages) ──

  private getHeaderStyles(): string {
    return `
      .tasker-header {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        position: relative;
      }

      .tasker-wrapper {
        display: flex;
        align-items: center;
        gap: 0;
      }

      .tasker-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .tasker-header.light .tasker-btn {
        background: #f6f8fa;
        color: #24292f;
        border-color: #d1d9e0;
      }
      .tasker-header.light .tasker-btn:hover {
        background: #eaeef2;
      }
      .tasker-header.dark .tasker-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-header.dark .tasker-btn:hover {
        background: #292e36;
      }

      .tasker-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .tasker-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        background: #2563eb;
        color: #fff;
        border-radius: 4px;
        font-weight: 800;
        font-size: 11px;
        flex-shrink: 0;
      }

      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .status-label {
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .linked-count {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 10px;
        font-weight: 600;
      }
      .tasker-header.light .linked-count {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-count {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .chevron {
        font-size: 8px;
        opacity: 0.5;
        margin-left: 2px;
      }

      .linked-notice {
        font-size: 11px;
        padding: 6px 10px;
        font-weight: 500;
        border-radius: 4px;
        margin-bottom: 4px;
      }
      .linked-notice strong {
        font-weight: 700;
      }
      .tasker-header.light .linked-notice {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .tasker-header.dark .linked-notice {
        background: #1e3a5f;
        color: #93c5fd;
      }

      .dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        min-width: 220px;
        border-radius: 8px;
        padding: 4px;
        z-index: 100;
        box-shadow: 0 4px 24px rgba(0,0,0,0.16);
        margin-top: 4px;
        max-height: 300px;
        overflow-y: auto;
      }
      .tasker-header.light .dropdown {
        background: #fff;
        border: 1px solid #d1d9e0;
      }
      .tasker-header.dark .dropdown {
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
      .tasker-header.light .status-row:hover { background: #f6f8fa; }
      .tasker-header.dark .status-row:hover { background: #373e47; }
      .status-row.active { font-weight: 600; }

      .label { flex: 1; }

      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid #d1d9e0;
        border-top-color: #2563eb;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    `;
  }

  // ── Sidebar styles (Issue pages) ──

  private getSidebarStyles(): string {
    return `
      .tasker-root {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 16px;
      }

      .tasker-root.dark { color: #e6edf3; }
      .tasker-root.light { color: #1f2328; }

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

      .label { flex: 1; }

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

      .section.proposal { margin-top: 8px; }

      .proposal-textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        font: inherit;
        font-size: 12px;
        line-height: 1.4;
        resize: vertical;
        min-height: 80px;
        margin-bottom: 8px;
      }
      .tasker-root.light .proposal-textarea {
        background: #ffffff;
        color: #1f2328;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-textarea {
        background: #0d1117;
        color: #e6edf3;
        border: 1px solid #3d444d;
      }
      .proposal-textarea:disabled { opacity: 0.7; cursor: not-allowed; }

      .proposal-actions {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
      }
      .proposal-btn {
        flex: 1;
        padding: 5px 10px;
        font-size: 12px;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid transparent;
        font-weight: 500;
      }
      .proposal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .tasker-root.light .proposal-btn {
        background: #f6f8fa;
        color: #1f2328;
        border-color: #d1d9e0;
      }
      .tasker-root.light .proposal-btn:hover:not(:disabled) {
        background: #eaeef2;
      }
      .tasker-root.dark .proposal-btn {
        background: #21262d;
        color: #e6edf3;
        border-color: #3d444d;
      }
      .tasker-root.dark .proposal-btn:hover:not(:disabled) {
        background: #292e36;
      }
      .proposal-btn.primary {
        background: #2563eb;
        color: #ffffff;
        border-color: #2563eb;
      }
      .proposal-btn.primary:hover:not(:disabled) { background: #1d4ed8; }

      .proposal-btn.danger {
        background: #dc2626;
        color: #ffffff;
        border-color: #dc2626;
      }
      .proposal-btn.danger:hover:not(:disabled) { background: #b91c1c; }

      .proposal-autopilot {
        margin-bottom: 8px;
      }
      .proposal-btn.autopilot {
        width: 100%;
        background: linear-gradient(135deg, #7c3aed, #2563eb);
        color: #ffffff;
        border-color: transparent;
        font-weight: 600;
      }
      .proposal-btn.autopilot:hover:not(:disabled) {
        background: linear-gradient(135deg, #6d28d9, #1d4ed8);
      }

      .proposal-status-line {
        font-size: 11px;
        opacity: 0.7;
      }
      .proposal-status-sub {
        font-size: 10px;
        opacity: 0.5;
        margin-top: 2px;
      }

      .proposal-notice {
        font-size: 11px;
        padding: 5px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
      }
      .tasker-root.light .proposal-notice {
        background: #fff8c5;
        color: #633c01;
        border: 1px solid #d4a72c;
      }
      .tasker-root.dark .proposal-notice {
        background: #3a2e00;
        color: #f2cc60;
        border: 1px solid #6e4f00;
      }
      .proposal-notice.subtle {
        opacity: 0.85;
      }
      .tasker-root.light .proposal-notice.danger {
        background: #ffebe9;
        color: #82071e;
        border: 1px solid #ff8182;
      }
      .tasker-root.dark .proposal-notice.danger {
        background: #5a1a1a;
        color: #ffa198;
        border: 1px solid #f85149;
      }
      .tasker-root.light .proposal-notice.subtle {
        background: #f6f8fa;
        color: #57606a;
        border: 1px solid #d1d9e0;
      }
      .tasker-root.dark .proposal-notice.subtle {
        background: #21262d;
        color: #8b949e;
        border: 1px solid #3d444d;
      }

      .proposal-status.posted {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 12px;
      }
      .proposal-status.posted .check {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #1a7f37;
        color: #fff;
        font-size: 12px;
        flex-shrink: 0;
      }
      .proposal-status.posted .comment-link {
        display: block;
        font-size: 11px;
        margin-top: 2px;
        color: inherit;
        opacity: 0.8;
      }

      .proposal-error {
        font-size: 11px;
        margin-top: 4px;
        color: #cf222e;
      }
      .tasker-root.dark .proposal-error { color: #f85149; }
    `;
  }
}
