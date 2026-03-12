'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CustomColumn, CustomFieldValue, CustomFieldType } from '@/types/database';

export function useCustomColumns(userId: string) {
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [fieldValues, setFieldValues] = useState<CustomFieldValue[]>([]);
  const supabase = createClient();

  const fetchColumns = useCallback(async () => {
    const { data } = await supabase
      .from('custom_columns')
      .select('*')
      .eq('user_id', userId)
      .order('position');
    setColumns((data as CustomColumn[]) ?? []);
  }, [userId, supabase]);

  const fetchFieldValues = useCallback(async () => {
    const { data } = await supabase
      .from('custom_field_values')
      .select('*');
    setFieldValues((data as CustomFieldValue[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    fetchColumns();
    fetchFieldValues();
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
      return [...prev, { id: crypto.randomUUID(), task_id: taskId, column_id: columnId, value }];
    });

    await supabase.from('custom_field_values').upsert(
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
