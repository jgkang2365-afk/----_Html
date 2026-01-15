/**
 * 5인 이상 연번 재부여 스크립트
 * 현재 데이터를 기준으로 올바르게 재부여합니다.
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

async function resetFivePlusSequence() {
  try {
    console.log('='.repeat(100));
    console.log('5인 이상 연번 재부여 시작');
    console.log('='.repeat(100));
    console.log('\n');

    // 천안 지정지청의 2026년 상반기 모든 측정일지 조회
    const { data: allJournals, error: fetchError } = await supabase
      .from('measurement_journal')
      .select('id, code, business_name, designated_office, total_employees, five_plus_sequence, created_at')
      .eq('measurement_year', 2026)
      .eq('measurement_period', '상반기')
      .in('designated_office', ['천안', '천안시'])
      .order('created_at', { ascending: true }); // 생성 순서대로 정렬

    if (fetchError) {
      console.error('측정일지 조회 오류:', fetchError);
      return;
    }

    if (!allJournals || allJournals.length === 0) {
      console.log('재부여할 측정일지가 없습니다.');
      return;
    }

    console.log(`총 ${allJournals.length}개 측정일지를 재부여합니다.\n`);

    // 생성 순서대로 정렬 (이미 정렬되어 있지만 확실히)
    const sortedJournals = [...allJournals].sort((a, b) => {
      const dateA = new Date(a.created_at || 0);
      const dateB = new Date(b.created_at || 0);
      return dateA - dateB;
    });

    let currentFivePlusNumber = 0; // 5인 이상 항목에 부여할 번호
    let lastFivePlusNumber = null; // 5인 미만 항목이 재사용할 번호

    const updates = [];

    for (const journal of sortedJournals) {
      const totalEmployees = journal.total_employees || 0;
      let newFivePlusSequence = null;

      if (totalEmployees >= 5) {
        // 5인 이상: 번호 증가
        currentFivePlusNumber++;
        newFivePlusSequence = String(currentFivePlusNumber);
        lastFivePlusNumber = newFivePlusSequence;
      } else {
        // 5인 미만: 직전 번호 재사용
        if (lastFivePlusNumber !== null) {
          newFivePlusSequence = lastFivePlusNumber;
        } else {
          // 직전 번호가 없으면 0
          newFivePlusSequence = '0';
        }
      }

      // 변경이 필요한 경우만 업데이트
      if (journal.five_plus_sequence !== newFivePlusSequence) {
        updates.push({
          id: journal.id,
          code: journal.code,
          business_name: journal.business_name,
          total_employees: totalEmployees,
          old_sequence: journal.five_plus_sequence,
          new_sequence: newFivePlusSequence,
        });
      }

      console.log(`${journal.code} (${journal.business_name || 'N/A'})`);
      console.log(`  - 총인원: ${totalEmployees}`);
      console.log(`  - 기존 번호: ${journal.five_plus_sequence || 'N/A'}`);
      console.log(`  - 새 번호: ${newFivePlusSequence}`);
      console.log('');
    }

    if (updates.length === 0) {
      console.log('모든 번호가 이미 올바르게 부여되어 있습니다.');
      return;
    }

    console.log('='.repeat(100));
    console.log(`총 ${updates.length}개 항목을 업데이트합니다.`);
    console.log('='.repeat(100));
    console.log('\n');

    // 실제 업데이트 실행
    let successCount = 0;
    let errorCount = 0;

    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('measurement_journal')
        .update({ five_plus_sequence: update.new_sequence })
        .eq('id', update.id);

      if (updateError) {
        console.error(`❌ ${update.code} 업데이트 실패:`, updateError.message);
        errorCount++;
      } else {
        console.log(`✅ ${update.code} (${update.business_name || 'N/A'}): ${update.old_sequence} → ${update.new_sequence}`);
        successCount++;
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('재부여 완료');
    console.log('='.repeat(100));
    console.log(`성공: ${successCount}개`);
    console.log(`실패: ${errorCount}개`);

    // 재부여 후 최종 확인
    console.log('\n' + '='.repeat(100));
    console.log('재부여 후 최종 확인');
    console.log('='.repeat(100));

    const { data: finalJournals, error: finalError } = await supabase
      .from('measurement_journal')
      .select('id, code, business_name, total_employees, five_plus_sequence, created_at')
      .eq('measurement_year', 2026)
      .eq('measurement_period', '상반기')
      .in('designated_office', ['천안', '천안시'])
      .order('created_at', { ascending: true });

    if (!finalError && finalJournals) {
      console.log('\n최종 번호 부여 현황:');
      finalJournals.forEach((journal, index) => {
        console.log(`${index + 1}. ${journal.code} (${journal.business_name || 'N/A'})`);
        console.log(`   - 총인원: ${journal.total_employees || 'N/A'}`);
        console.log(`   - 5인 이상 연번: ${journal.five_plus_sequence || 'N/A'}`);
      });
    }

  } catch (error) {
    console.error('스크립트 실행 오류:', error);
  }
}

resetFivePlusSequence();
