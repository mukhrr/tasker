'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
  CustomColumn,
  CustomFieldValue,
  CustomFieldType,
} from '@/types/database';

const supabase = createClient();

export function useCustomColumns(userId: string) {
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [fieldValues, setFieldValues] = useState<CustomFieldValue[]>([]);

  const fetchFieldValues = useCallback(async (columnIds: string[]) => {
    if (columnIds.length === 0) {
      setFieldValues([]);
      return;
    }
    const { data } = await supabase
      .from('custom_field_values')
      .select('*')
      .in('column_id', columnIds);
    setFieldValues((data as CustomFieldValue[]) ?? []);
  }, []);

  const fetchColumns = useCallback(async () => {
    const { data } = await supabase
      .from('custom_columns')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    const cols = (data as CustomColumn[]) ?? [];
    setColumns(cols);
    // Fetch field values filtered by the user's column IDs
    await fetchFieldValues(cols.map((c) => c.id));
  }, [userId, fetchFieldValues]);

  useEffect(() => {
    fetchColumns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const addColumn = async (name: string, fieldType: CustomFieldType) => {
    const position = columns.length;
    const { error } = await supabase.from('custom_columns').insert({
      user_id: userId,
      name,
      field_type: fieldType,
      position,
    });
    if (!error) await fetchColumns();
  };

  const updateColumn = async (id: string, updates: Partial<CustomColumn>) => {
    const { error } = await supabase
      .from('custom_columns')
      .update(updates)
      .eq('id', id);
    if (!error) await fetchColumns();
  };

  const deleteColumn = async (id: string) => {
    await supabase.from('custom_columns').delete().eq('id', id);
    await fetchColumns();
  };

  const setFieldValue = async (
    taskId: string,
    columnId: string,
    value: string | null
  ) => {
    // Optimistic
    setFieldValues((prev) => {
      const existing = prev.find(
        (fv) => fv.task_id === taskId && fv.column_id === columnId
      );
      if (existing) {
        return prev.map((fv) =>
          fv.task_id === taskId && fv.column_id === columnId
            ? { ...fv, value }
            : fv
        );
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          task_id: taskId,
          column_id: columnId,
          value,
        },
      ];
    });

    await supabase
      .from('custom_field_values')
      .upsert(
        { task_id: taskId, column_id: columnId, value },
        { onConflict: 'task_id,column_id' }
      );
  };

  const getFieldValue = (taskId: string, columnId: string): string | null => {
    return (
      fieldValues.find(
        (fv) => fv.task_id === taskId && fv.column_id === columnId
      )?.value ?? null
    );
  };

  return {
    columns,
    fieldValues,
    addColumn,
    updateColumn,
    deleteColumn,
    setFieldValue,
    getFieldValue,
  };
}
