/**
 * 5인 이상 연번 부여 로직 설명 스크립트
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

async function explainLogic() {
  try {
    console.log('='.repeat(100));
    console.log('5인 이상 연번 자동 부여 로직 설명');
    console.log('='.repeat(100));
    console.log('\n');

    console.log('📌 로직 설명:');
    console.log('1. 총인원이 5인 이상인 경우:');
    console.log('   - 같은 지정지청 + 측정년도 + 측정주기에서');
    console.log('   - 모든 5인 이상 연번을 조회');
    console.log('   - 숫자로 변환하여 내림차순 정렬');
    console.log('   - 가장 큰 번호를 찾아서 1을 더함');
    console.log('   - 예: 기존에 1, 2가 있으면 → 다음 번호는 3');
    console.log('\n');

    console.log('2. 총인원이 5인 미만인 경우:');
    console.log('   - 같은 지정지청 + 측정년도 + 측정주기에서');
    console.log('   - 가장 최근에 생성된 측정일지의 5인 이상 연번을 재사용');
    console.log('   - (중복 허용)');
    console.log('\n');

    console.log('='.repeat(100));
    console.log('현재 데이터 확인: 천안 지정지청, 2026년 상반기');
    console.log('='.repeat(100));
    console.log('\n');

    // 천안 지정지청의 2026년 상반기 모든 측정일지 조회
    const { data: allJournals, error: allError } = await supabase
      .from('measurement_journal')
      .select('id, code, business_name, designated_office, total_employees, five_plus_sequence, created_at')
      .eq('measurement_year', 2026)
      .eq('measurement_period', '상반기')
      .in('designated_office', ['천안', '천안시'])
      .order('created_at', { ascending: true });

    if (allError) {
      console.error('조회 오류:', allError);
      return;
    }

    console.log(`총 ${allJournals?.length || 0}개 측정일지가 있습니다.\n`);

    if (allJournals && allJournals.length > 0) {
      allJournals.forEach((journal, index) => {
        console.log(`${index + 1}. ${journal.business_name || journal.code} (코드: ${journal.code})`);
        console.log(`   - 지정지청: ${journal.designated_office}`);
        console.log(`   - 총인원: ${journal.total_employees || 'N/A'}`);
        console.log(`   - 5인 이상 연번: ${journal.five_plus_sequence || 'N/A'}`);
        console.log(`   - 생성일시: ${journal.created_at ? new Date(journal.created_at).toLocaleString('ko-KR') : 'N/A'}`);
        console.log('');
      });

      // 5인 이상 연번이 있는 항목만 필터링
      const withFivePlus = allJournals.filter(j => j.five_plus_sequence);
      
      if (withFivePlus.length > 0) {
        console.log('='.repeat(100));
        console.log('5인 이상 연번이 있는 항목들:');
        console.log('='.repeat(100));
        
        // 숫자로 변환하여 정렬
        const sorted = withFivePlus
          .map(j => ({
            ...j,
            num: parseInt(j.five_plus_sequence, 10)
          }))
          .filter(j => !isNaN(j.num))
          .sort((a, b) => b.num - a.num);

        sorted.forEach((journal, index) => {
          console.log(`${index + 1}. 번호: ${journal.five_plus_sequence} - ${journal.business_name || journal.code}`);
        });

        if (sorted.length > 0) {
          const maxNumber = sorted[0];
          console.log(`\n✅ 가장 큰 번호: ${maxNumber.five_plus_sequence}`);
          console.log(`   - 사업장: ${maxNumber.business_name || maxNumber.code}`);
          console.log(`   - 다음에 부여될 번호: ${parseInt(maxNumber.five_plus_sequence, 10) + 1}`);
        }
      }

      // H0205 분석
      const h0205 = allJournals.find(j => j.code === 'H0205');
      if (h0205) {
        console.log('\n' + '='.repeat(100));
        console.log('H0205 (그린자동차정비공업 주식회사) 분석:');
        console.log('='.repeat(100));
        console.log(`현재 5인 이상 연번: ${h0205.five_plus_sequence}`);
        console.log(`총인원: ${h0205.total_employees} (5인 이상)`);
        console.log(`생성일시: ${h0205.created_at ? new Date(h0205.created_at).toLocaleString('ko-KR') : 'N/A'}`);
        
        // H0205보다 먼저 생성된 항목들
        const beforeH0205 = allJournals.filter(j => 
          j.created_at && h0205.created_at && 
          new Date(j.created_at) < new Date(h0205.created_at)
        );

        if (beforeH0205.length > 0) {
          console.log(`\n⚠️  H0205보다 먼저 생성된 항목 (${beforeH0205.length}개):`);
          beforeH0205.forEach(j => {
            console.log(`   - ${j.code} (${j.business_name || 'N/A'}): 번호 ${j.five_plus_sequence || 'N/A'}, 총인원 ${j.total_employees || 'N/A'}`);
          });
          
          // 5인 이상인 항목들만 필터링
          const fivePlusBefore = beforeH0205.filter(j => j.total_employees && j.total_employees >= 5);
          if (fivePlusBefore.length > 0) {
            const maxBefore = fivePlusBefore
              .map(j => ({ ...j, num: parseInt(j.five_plus_sequence || '0', 10) }))
              .filter(j => !isNaN(j.num))
              .sort((a, b) => b.num - a.num)[0];
            
            if (maxBefore) {
              console.log(`\n📊 H0205 등록 시점의 가장 큰 번호: ${maxBefore.five_plus_sequence}`);
              console.log(`   - 예상 다음 번호: ${parseInt(maxBefore.five_plus_sequence, 10) + 1}`);
              console.log(`   - 실제 부여된 번호: ${h0205.five_plus_sequence}`);
              
              if (parseInt(h0205.five_plus_sequence, 10) === parseInt(maxBefore.five_plus_sequence, 10) + 1) {
                console.log(`   ✅ 정상: 예상 번호와 일치합니다.`);
              } else {
                console.log(`   ⚠️  주의: 예상 번호와 다릅니다.`);
              }
            }
          }
        } else {
          console.log('\n📌 H0205가 첫 번째로 생성된 항목입니다.');
          console.log('   - 첫 번째 항목이므로 번호는 1이어야 합니다.');
          console.log(`   - 실제 부여된 번호: ${h0205.five_plus_sequence}`);
          
          if (h0205.five_plus_sequence === '1') {
            console.log('   ✅ 정상: 첫 번째 항목에 1번이 부여되었습니다.');
          } else {
            console.log('   ⚠️  주의: 첫 번째 항목인데 1번이 아닙니다.');
            console.log('   가능한 원인:');
            console.log('   1. 이전에 다른 항목들이 있었지만 삭제되었을 수 있습니다.');
            console.log('   2. 수동으로 번호가 입력되었을 수 있습니다.');
            console.log('   3. 다른 지정지청의 데이터가 포함되었을 수 있습니다.');
          }
        }
      }
    } else {
      console.log('등록된 측정일지가 없습니다.');
    }

  } catch (error) {
    console.error('스크립트 실행 오류:', error);
  }
}

explainLogic();
