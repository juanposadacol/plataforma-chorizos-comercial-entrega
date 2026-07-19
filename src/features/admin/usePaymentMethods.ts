/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface PaymentMethodOption {
  id: string;
  code: string;
  name: string;
  requires_reference: boolean;
}

export function usePaymentMethods() {
  const [methods, setMethods] = useState<PaymentMethodOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase
      .from('payment_methods')
      .select('id, code, name, requires_reference')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setMethods(data as PaymentMethodOption[]);
        setLoading(false);
      });
  }, []);

  return { methods, loading };
}
