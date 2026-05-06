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
  IssueLabelsEtagResponse,
  AutoPostResponse,
} from '../shared/messages';
import { COLOR_HEX, STATUS_GROUP_LABELS, STATUS_GROUP_ORDER } from '../shared/constants';

const PROPOSAL_REQUIRED_LABELS = ['bug', 'daily'];
const PROPOSAL_READY_LABEL = 'help wanted';
const PROPOSAL_POLL_INTERVAL_MS = 2000;
// Tab-side fast-path: ETag-cached label fetch interval. 304 responses cost
// no GitHub rate-limit quota, so this can run aggressively without burning
// the 5,000/hr authenticated budget.
const FAST_LABEL_POLL_MS = 1500;
// Selectors for the labels container — covers both the classic Rails issue
// page and the React rewrite. Observer attaches to whichever is found.
const LABELS_CONTAINER_SELECTORS = [
  '.js-issue-labels',
  '[data-testid="issue-labels"]',
  '[aria-label="Labels"]',
];

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
  private destroyed = false;
  // Fast-path state: tab-side detection of the Help Wanted label.
  private autoPostEnabled = true;
  private fastPathHandle: ReturnType<typeof setInterval> | null = null;
  private fastPathObservers: MutationObserver[] = [];
  private fastPathEtag: string | null = null;
  private fastPathTriggered = false;
  private fastPathVisibilityListener: (() => void) | null = null;

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

    if (this.proposal?.state === 'armed' || this.proposal?.state === 'posting') {
      this.startProposalPoll();
      this.startFastPath();
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
      section.appendChild(body);
      this.root.appendChild(section);
      return;
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
      notice.textContent = state === 'armed'
        ? '"Help Wanted" already added — posting on next poll cycle.'
        : '"Help Wanted" is already on this issue. Arm to post immediately.';
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
    textarea.addEventListener('input', () => {
      this.proposalDraftBody = textarea.value;
    });
    body.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'proposal-actions';

    const dirty =
      this.proposalDraftBody !== (this.proposal?.body ?? '') &&
      this.proposalDraftBody.trim().length > 0;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'proposal-btn secondary';
    saveBtn.textContent = this.proposalBusy ? 'Saving…' : (this.proposal ? 'Save changes' : 'Save draft');
    saveBtn.disabled = this.proposalBusy || isArmed || !dirty;
    saveBtn.addEventListener('click', () => void this.saveProposal());
    actions.appendChild(saveBtn);

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
      armBtn.disabled =
        this.proposalBusy ||
        !this.proposalDraftBody.trim() ||
        dirty; // must save first
      armBtn.title = dirty ? 'Save changes before arming' : '';
      armBtn.addEventListener('click', () => void this.setProposalState('armed'));
      actions.appendChild(armBtn);
    }

    body.appendChild(actions);

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
        this.startFastPath();
      } else {
        this.stopProposalPoll();
        this.stopFastPath();
      }
    } else {
      this.error = res.error ?? 'Update failed';
      setTimeout(() => { this.error = null; this.render(); }, 3000);
    }
    this.render();
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
        this.stopFastPath();
      }
      this.render();
    }
  }

  // ── Tab-side fast-path: detect "Help Wanted" the moment it appears ──

  private startFastPath(): void {
    if (!this.autoPostEnabled) return;
    if (!this.proposal || this.proposal.state !== 'armed') return;
    if (this.fastPathTriggered) return;

    // If the label is already on the issue (we just loaded it), fire immediately.
    if (this.hasReadyLabel()) {
      void this.tryFastPost('initial-labels');
      return;
    }

    this.attachFastPathObservers();
    this.startFastPathPoll();

    // Pause the ETag poll while the tab is hidden to be a polite citizen;
    // resume on focus. The MutationObserver still runs (free) in case GitHub
    // pushes a label update via their own live channel.
    if (!this.fastPathVisibilityListener) {
      this.fastPathVisibilityListener = () => {
        if (document.visibilityState === 'visible' && this.proposal?.state === 'armed') {
          this.startFastPathPoll();
        } else {
          this.stopFastPathPoll();
        }
      };
      document.addEventListener('visibilitychange', this.fastPathVisibilityListener);
    }
  }

  private stopFastPath(): void {
    this.stopFastPathPoll();
    for (const obs of this.fastPathObservers) obs.disconnect();
    this.fastPathObservers = [];
    if (this.fastPathVisibilityListener) {
      document.removeEventListener('visibilitychange', this.fastPathVisibilityListener);
      this.fastPathVisibilityListener = null;
    }
    this.fastPathEtag = null;
  }

  private attachFastPathObservers(): void {
    // Walk through every known labels-container selector. Some pages have
    // both classic and React variants in flight during navigation.
    const seen = new Set<Element>();
    for (const sel of LABELS_CONTAINER_SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        const obs = new MutationObserver(() => this.checkLabelsContainer(el as HTMLElement));
        obs.observe(el, { childList: true, subtree: true, characterData: true });
        this.fastPathObservers.push(obs);
        // Run an initial pass — the container may already contain the label
        // when GitHub renders it via Turbo navigation.
        this.checkLabelsContainer(el as HTMLElement);
      });
    }
  }

  private checkLabelsContainer(el: HTMLElement): void {
    if (this.fastPathTriggered) return;
    const text = (el.innerText || el.textContent || '').toLowerCase();
    if (text.includes(PROPOSAL_READY_LABEL)) {
      void this.tryFastPost('mutation-observer');
    }
  }

  private startFastPathPoll(): void {
    if (this.fastPathHandle !== null) return;
    if (document.visibilityState !== 'visible') return;
    this.fastPathHandle = setInterval(() => {
      void this.fastPollTick();
    }, FAST_LABEL_POLL_MS);
    // Fire one immediate tick so we don't wait for the first interval.
    void this.fastPollTick();
  }

  private stopFastPathPoll(): void {
    if (this.fastPathHandle !== null) {
      clearInterval(this.fastPathHandle);
      this.fastPathHandle = null;
    }
  }

  private async fastPollTick(): Promise<void> {
    if (this.destroyed || this.fastPathTriggered) return;
    if (!this.proposal || this.proposal.state !== 'armed') {
      this.stopFastPath();
      return;
    }
    const res = await sendMessage<IssueLabelsEtagResponse>({
      type: 'QUERY_ISSUE_LABELS_ETAG',
      owner: this.owner,
      repo: this.repo,
      number: this.number,
      etag: this.fastPathEtag,
    });
    if (!res.ok || !res.data) return;
    if (res.data.etag) this.fastPathEtag = res.data.etag;
    if (res.data.notModified || !res.data.labels) return;
    this.labels = res.data.labels;
    if (this.hasReadyLabel()) {
      void this.tryFastPost('etag-poll');
    }
  }

  private async tryFastPost(source: string): Promise<void> {
    console.debug('[tasker] fast-post triggered via', source);
    if (this.fastPathTriggered) return;
    if (!this.autoPostEnabled) return;
    if (!this.proposal || this.proposal.state !== 'armed') return;
    this.fastPathTriggered = true;
    this.stopFastPath();
    const proposalId = this.proposal.id;

    // Optimistic UI: flip to "posting" so the user sees instant feedback.
    this.proposal = { ...this.proposal, state: 'posting' };
    this.render();

    const res = await sendMessage<MessageResponse<Proposal>>({
      type: 'POST_PROPOSAL_NOW',
      proposalId,
    });

    if (this.destroyed) return;
    if (res.ok && res.data) {
      this.proposal = res.data;
      this.stopProposalPoll();
    } else {
      // Reset trigger so a retry is possible if the row went back to armed.
      this.fastPathTriggered = false;
      // Pull canonical state — the row may already be `failed` or back to `armed`.
      void this.refreshProposal();
    }
    this.render();
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
    this.stopFastPath();
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

      .proposal-status-line {
        font-size: 11px;
        opacity: 0.7;
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
