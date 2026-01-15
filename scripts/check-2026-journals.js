/**
 * 2026년 상반기 측정일지에 등록된 업체 목록 조회 스크립트
 * 
 * 사용법: node scripts/check-2026-journals.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('환경 변수가 설정되지 않았습니다.');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY:', !!supabaseKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function get2026Journals() {
  try {
    console.log('2026년 상반기 측정일지 조회 중...\n');

    const { data: journals, error } = await supabase
      .from('measurement_journal')
      .select('code, business_name, designated_office, total_employees, measurement_start_date, measurement_end_date, completion_status, measurer, created_at')
      .eq('measurement_year', 2026)
      .eq('measurement_period', '상반기')
      .order('code', { ascending: true });

    if (error) {
      console.error('조회 오류:', error);
      return;
    }

    if (!journals || journals.length === 0) {
      console.log('2026년 상반기 측정일지에 등록된 업체가 없습니다.');
      return;
    }

    console.log(`총 ${journals.length}개 업체가 등록되어 있습니다.\n`);
    console.log('='.repeat(100));
    console.log('코드'.padEnd(10), '사업장명'.padEnd(30), '지정지청'.padEnd(10), '총인원'.padEnd(8), '측정자'.padEnd(10), '완료여부');
    console.log('='.repeat(100));

    journals.forEach((journal, index) => {
      const code = (journal.code || '').padEnd(10);
      const businessName = (journal.business_name || '').substring(0, 28).padEnd(30);
      const office = (journal.designated_office || '').padEnd(10);
      const employees = (journal.total_employees ? String(journal.total_employees) : '-').padEnd(8);
      const measurer = (journal.measurer || '-').substring(0, 8).padEnd(10);
      const status = journal.completion_status || '미완료';

      console.log(code, businessName, office, employees, measurer, status);
    });

    console.log('='.repeat(100));
    console.log(`\n상세 정보:\n`);

    journals.forEach((journal, index) => {
      console.log(`${index + 1}. ${journal.business_name || 'N/A'} (코드: ${journal.code || 'N/A'})`);
      console.log(`   - 지정지청: ${journal.designated_office || 'N/A'}`);
      console.log(`   - 총인원: ${journal.total_employees || 'N/A'}`);
      console.log(`   - 측정 시작일: ${journal.measurement_start_date || 'N/A'}`);
      console.log(`   - 측정 종료일: ${journal.measurement_end_date || 'N/A'}`);
      console.log(`   - 측정자: ${journal.measurer || 'N/A'}`);
      console.log(`   - 완료여부: ${journal.completion_status || '미완료'}`);
      console.log(`   - 등록일시: ${journal.created_at ? new Date(journal.created_at).toLocaleString('ko-KR') : 'N/A'}`);
      console.log('');
    });

  } catch (error) {
    console.error('스크립트 실행 오류:', error);
  }
}

get2026Journals();
