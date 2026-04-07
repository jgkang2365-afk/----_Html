import { createClient } from './lib/supabase/server.ts';

async function check() {
  try {
    const supabase = await createClient();
    
    const { count: total, error: e1 } = await supabase.from('measurement_journal').select('*', { count: 'exact', head: true });
    console.log('Total measurement_journal:', total, e1 || '');
    
    const { count: y2025, error: e2 } = await supabase.from('measurement_journal').select('*', { count: 'exact', head: true }).eq('measurement_year', 2025);
    console.log('2025 measurement_journal:', y2025, e2 || '');

    const { count: y2026, error: e3 } = await supabase.from('measurement_journal').select('*', { count: 'exact', head: true }).eq('measurement_year', 2026);
    console.log('2026 measurement_journal:', y2026, e3 || '');
  } catch (err) {
    console.error(err);
  }
}

check();
