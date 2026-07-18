/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchRecords, subscribeToAdminTable, type FetchOptions } from './adminService';

export interface AdminDataState<T> {
  data: T[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAdminData<T>(
  table: string,
  options: FetchOptions = {},
  realtime = false,
): AdminDataState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsKey = useMemo(() => JSON.stringify(options), [options]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setData(await fetchRecords<T>(table, JSON.parse(optionsKey) as FetchOptions));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible cargar la información.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [optionsKey, table]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!realtime) return undefined;
    return subscribeToAdminTable(table, () => void reload());
  }, [realtime, reload, table]);

  return { data, loading, refreshing, error, reload };
}
