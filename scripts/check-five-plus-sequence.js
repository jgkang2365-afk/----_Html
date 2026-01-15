/**
 * 2026년 상반기 천안 지정지청의 5인 이상 연번 부여 현황 조회 스크립트
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('환경 변수가 설정되지 않았습니다.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkFivePlusSequence() {
  try {
    console.log('2026년 상반기 천안 지정지청의 5인 이상 연번 부여 현황 조회 중...\n');

    // 천안 지정지청의 2026년 상반기 모든 측정일지 조회
    const { data: journals, error } = await supabase
      .from('measurement_journal')
      .select('id, code, business_name, designated_office, total_employees, five_plus_sequence, created_at')
      .eq('measurement_year', 2026)
      .eq('measurement_period', '상반기')
      .in('designated_office', ['천안', '천안시']) // 약칭과 전체명 모두 확인
      .not('five_plus_sequence', 'is', null)
      .order('created_at', { ascending: true }); // 생성 순서대로 정렬

    if (error) {
      console.error('조회 오류:', error);
      return;
    }

    if (!journals || journals.length === 0) {
      console.log('2026년 상반기 천안 지정지청에 등록된 측정일지가 없습니다.');
      return;
    }

    console.log(`총 ${journals.length}개 측정일지가 있습니다.\n`);
    console.log('='.repeat(120));
    console.log('생성순서'.padEnd(8), '코드'.padEnd(10), '사업장명'.padEnd(35), '총인원'.padEnd(8), '5인 이상 연번'.padEnd(12), '생성일시');
    console.log('='.repeat(120));

    journals.forEach((journal, index) => {
      const order = `${index + 1}`.padEnd(8);
      const code = (journal.code || '').padEnd(10);
      const businessName = (journal.business_name || '').substring(0, 33).padEnd(35);
      const employees = (journal.total_employees ? String(journal.total_employees) : '-').padEnd(8);
      const fivePlus = (journal.five_plus_sequence || '-').padEnd(12);
      const createdAt = journal.created_at ? new Date(journal.created_at).toLocaleString('ko-KR') : '-';

      console.log(order, code, businessName, employees, fivePlus, createdAt);
    });

    console.log('='.repeat(120));

    // 5인 이상 연번을 숫자로 변환하여 정렬
    const sortedByNumber = journals
      .map(j => ({
        ...j,
        num: parseInt(j.five_plus_sequence, 10)
      }))
      .filter(j => !isNaN(j.num))
      .sort((a, b) => b.num - a.num); // 내림차순 정렬

    if (sortedByNumber.length > 0) {
      console.log('\n5인 이상 연번 기준 정렬 (큰 번호부터):');
      console.log('-'.repeat(120));
      sortedByNumber.forEach((journal, index) => {
        console.log(`${index + 1}. 번호: ${journal.five_plus_sequence} (${journal.business_name || journal.code})`);
      });

      const maxNumber = sortedByNumber[0];
      console.log(`\n가장 큰 번호: ${maxNumber.five_plus_sequence}`);
      console.log(`  - 사업장: ${maxNumber.business_name || maxNumber.code}`);
      console.log(`  - 총인원: ${maxNumber.total_employees || 'N/A'}`);
      console.log(`  - 생성일시: ${maxNumber.created_at ? new Date(maxNumber.created_at).toLocaleString('ko-KR') : 'N/A'}`);
      
      const nextNumber = parseInt(maxNumber.five_plus_sequence, 10) + 1;
      console.log(`\n다음에 부여될 번호: ${nextNumber}`);
    }

    // H0205 업체 정보 확인
    const h0205 = journals.find(j => j.code === 'H0205');
    if (h0205) {
      console.log('\n' + '='.repeat(120));
      console.log('H0205 (그린자동차정비공업 주식회사) 정보:');
      console.log(`  - 5인 이상 연번: ${h0205.five_plus_sequence}`);
      console.log(`  - 총인원: ${h0205.total_employees}`);
      console.log(`  - 생성일시: ${h0205.created_at ? new Date(h0205.created_at).toLocaleString('ko-KR') : 'N/A'}`);
      
      // H0205보다 먼저 생성된 항목들 확인
      const beforeH0205 = journals.filter(j => 
        j.created_at && h0205.created_at && 
        new Date(j.created_at) < new Date(h0205.created_at)
      );
      
      if (beforeH0205.length > 0) {
        console.log(`\nH0205보다 먼저 생성된 항목 (${beforeH0205.length}개):`);
        beforeH0205.forEach(j => {
          console.log(`  - ${j.code} (${j.business_name || 'N/A'}): 번호 ${j.five_plus_sequence}, 총인원 ${j.total_employees || 'N/A'}`);
        });
      } else {
        console.log('\nH0205가 가장 먼저 생성된 항목입니다.');
      }
    }

  } catch (error) {
    console.error('스크립트 실행 오류:', error);
  }
}

checkFivePlusSequence();
