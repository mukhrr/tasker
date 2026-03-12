'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useMediaQuery } from '@/hooks/use-media-query';
import {
  getStatusColor,
  getStatusesByGroup,
  getStatusByKey,
  STATUS_GROUP_LABELS,
  STATUS_GROUP_ORDER,
  COLOR_NAMES,
  STATUS_COLORS,
} from '@/lib/status';
import { Info, Pencil, Trash2, Plus, X, Check } from 'lucide-react';
import type { UserStatus, TaskStatusGroup } from '@/types/database';

interface StatusCellProps {
  value: string;
  statuses: UserStatus[];
  onChange: (status: string) => void;
  onAddStatus: (data: {
    key: string;
    label: string;
    description: string;
    color: string;
    group_name: TaskStatusGroup;
  }) => Promise<{ error: unknown }>;
  onUpdateStatus: (
    id: string,
    updates: Partial<
      Pick<UserStatus, 'label' | 'description' | 'color' | 'group_name' | 'key'>
    >
  ) => Promise<{ error: unknown }>;
  onDeleteStatus: (id: string) => Promise<{ error: unknown }>;
}

type View = 'list' | 'edit' | 'add' | 'confirm-delete';

interface EditState {
  id?: string;
  key: string;
  label: string;
  description: string;
  color: string;
  group_name: TaskStatusGroup;
}

const emptyEdit = (group: TaskStatusGroup): EditState => ({
  key: '',
  label: '',
  description: '',
  color: 'gray',
  group_name: group,
});

export function StatusCell({
  value,
  statuses,
  onChange,
  onAddStatus,
  onUpdateStatus,
  onDeleteStatus,
}: StatusCellProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [editState, setEditState] = useState<EditState>(emptyEdit('todo'));
  const [deleteTarget, setDeleteTarget] = useState<UserStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 640px)');

  const currentStatus = getStatusByKey(statuses, value);
  const colorConfig = getStatusColor(currentStatus?.color ?? 'gray');
  const grouped = getStatusesByGroup(statuses);

  const startEdit = (status: UserStatus) => {
    setEditState({
      id: status.id,
      key: status.key,
      label: status.label,
      description: status.description,
      color: status.color,
      group_name: status.group_name,
    });
    setView('edit');
  };

  const startAdd = (group: TaskStatusGroup) => {
    setEditState(emptyEdit(group));
    setView('add');
  };

  const confirmDelete = (status: UserStatus) => {
    setDeleteTarget(status);
    setView('confirm-delete');
  };

  const handleSave = async () => {
    setSaving(true);
    if (view === 'edit' && editState.id) {
      await onUpdateStatus(editState.id, {
        label: editState.label,
        description: editState.description,
        color: editState.color,
        group_name: editState.group_name,
        key: editState.key,
      });
    } else if (view === 'add') {
      const key =
        editState.key ||
        editState.label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');
      await onAddStatus({
        key,
        label: editState.label,
        description: editState.description,
        color: editState.color,
        group_name: editState.group_name,
      });
    }
    setSaving(false);
    setView('list');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await onDeleteStatus(deleteTarget.id);
    setDeleteTarget(null);
    setView('list');
  };

  const resetAndClose = () => {
    setOpen(false);
    setView('list');
    setDeleteTarget(null);
  };

  const content = (
    <>
      {view === 'list' && (
        <StatusListView
          grouped={grouped}
          value={value}
          onSelect={(key) => {
            onChange(key);
            resetAndClose();
          }}
          onEdit={startEdit}
          onDelete={confirmDelete}
          onAdd={startAdd}
        />
      )}
      {(view === 'edit' || view === 'add') && (
        <StatusFormView
          editState={editState}
          onChange={setEditState}
          onSave={handleSave}
          onCancel={() => setView('list')}
          saving={saving}
          isNew={view === 'add'}
        />
      )}
      {view === 'confirm-delete' && deleteTarget && (
        <DeleteConfirmView
          status={deleteTarget}
          onConfirm={handleDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setView('list');
          }}
        />
      )}
    </>
  );

  const trigger = (
    <button
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-0.5 text-sm font-medium ${colorConfig.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${colorConfig.dot}`} />
      {currentStatus?.label ?? value}
    </button>
  );

  if (isDesktop) {
    return (
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setView('list');
            setDeleteTarget(null);
          }
        }}
      >
        <PopoverTrigger render={trigger} />
        <PopoverContent className="w-72 p-0" align="start">
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setView('list');
          setDeleteTarget(null);
        }
      }}
    >
      <DrawerTrigger render={trigger} />
      <DrawerContent>
        <DrawerTitle className="sr-only">Change status</DrawerTitle>
        <div className="overflow-y-auto pb-6">{content}</div>
      </DrawerContent>
    </Drawer>
  );
}

// --- List view ---

function StatusListView({
  grouped,
  value,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
}: {
  grouped: Record<TaskStatusGroup, UserStatus[]>;
  value: string;
  onSelect: (key: string) => void;
  onEdit: (status: UserStatus) => void;
  onDelete: (status: UserStatus) => void;
  onAdd: (group: TaskStatusGroup) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <TooltipProvider delay={400}>
      <div className="py-1">
        {STATUS_GROUP_ORDER.map((group) => (
          <div key={group} className="mb-1 last:mb-0">
            <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {STATUS_GROUP_LABELS[group]}
            </p>
            {grouped[group].map((status) => {
              const color = getStatusColor(status.color);
              const isExpanded = expandedId === status.id;
              return (
                <div key={status.id} className="px-1">
                  <div
                    className={`flex items-center rounded-md hover:bg-muted ${
                      status.key === value ? 'bg-muted' : ''
                    }`}
                  >
                    <button
                      onClick={() => onSelect(status.key)}
                      className="flex flex-1 items-center gap-2 px-2 py-1.5 text-sm"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`}
                      />
                      <span className="flex-1 text-left">{status.label}</span>
                    </button>
                    <div className="flex items-center gap-0.5 pr-1.5">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedId(isExpanded ? null : status.id);
                              }}
                              className={`rounded p-0.5 hover:text-foreground ${
                                isExpanded
                                  ? 'text-foreground'
                                  : 'text-muted-foreground'
                              }`}
                            />
                          }
                        >
                          <Info className="h-3 w-3" />
                        </TooltipTrigger>
                        {status.description && (
                          <TooltipContent
                            side="right"
                            className="max-w-56 text-xs"
                          >
                            {status.description}
                          </TooltipContent>
                        )}
                      </Tooltip>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(status);
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                        title="Edit status"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(status);
                        }}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        title="Delete status"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <p className="mx-2 mb-1 rounded bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
                      {status.description || 'No description'}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => onAdd(group)}
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Add status
            </button>
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}

// --- Edit/Add form ---

function StatusFormView({
  editState,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew,
}: {
  editState: EditState;
  onChange: (state: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}) {
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">
          {isNew ? 'Add Status' : 'Edit Status'}
        </h4>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        <input
          type="text"
          value={editState.label}
          onChange={(e) => onChange({ ...editState, label: e.target.value })}
          placeholder="Status name"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />
        <textarea
          value={editState.description}
          onChange={(e) =>
            onChange({ ...editState, description: e.target.value })
          }
          placeholder="Description (helps AI decide when to use this status)"
          rows={2}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">Color</p>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_NAMES.map((name) => (
              <button
                key={name}
                onClick={() => onChange({ ...editState, color: name })}
                className={`h-5 w-5 rounded-full ${STATUS_COLORS[name].dot} ${
                  editState.color === name
                    ? 'ring-2 ring-ring ring-offset-1 ring-offset-background'
                    : ''
                }`}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">Group</p>
          <div className="flex gap-1">
            {STATUS_GROUP_ORDER.map((group) => (
              <button
                key={group}
                onClick={() => onChange({ ...editState, group_name: group })}
                className={`rounded-md px-2 py-1 text-[10px] font-medium ${
                  editState.group_name === group
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {STATUS_GROUP_LABELS[group]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onSave}
        disabled={!editState.label.trim() || saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Check className="h-3 w-3" />
        {saving ? 'Saving...' : isNew ? 'Add' : 'Save'}
      </button>
    </div>
  );
}

// --- Delete confirmation ---

function DeleteConfirmView({
  status,
  onConfirm,
  onCancel,
}: {
  status: UserStatus;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const color = getStatusColor(status.color);

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">Delete Status</h4>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${color.dot}`} />
        <span className="text-sm font-medium">{status.label}</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Are you sure? Tasks using this status won&apos;t be affected, but you
        won&apos;t be able to select it anymore.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
