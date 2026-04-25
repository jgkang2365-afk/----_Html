import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { format, addDays, differenceInDays, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// 시트 분류는 '지정지청(designated_office)' 기준
const DESIGNATED_OFFICES = ['천안', '대전', '평택', '경기'];

function formatDatesRange(startStr: string, endStr: string) {
  if (!startStr) return '';
  if (!endStr || startStr === endStr) return format(parseISO(startStr), 'MM/dd');

  const start = parseISO(startStr);
  const end = parseISO(endStr);
  const diff = differenceInDays(end, start);
  
  const dateList: string[] = [];
  for (let i = 0; i <= diff; i++) {
    const current = addDays(start, i);
    if (i === 0) {
      dateList.push(format(current, 'MM/dd'));
    } else {
      dateList.push(format(current, 'dd'));
    }
  }
  return dateList.join(', ');
}

function formatWeekDaysRange(startStr: string, endStr: string) {
  if (!startStr) return '';
  const start = parseISO(startStr);
  const end = endStr ? parseISO(endStr) : start;
  const diff = differenceInDays(end, start);
  
  const dayList: string[] = [];
  for (let i = 0; i <= diff; i++) {
    const current = addDays(start, i);
    dayList.push(format(current, 'eee', { locale: ko }));
  }
  return dayList.join(', ');
}

async function exportJournal2026Final() {
  console.log('Fetching STRICT 2026 journals...');
  const { data: journals, error } = await supabase
    .from('measurement_journal')
    .select('*')
    .eq('measurement_year', 2026) // 2026년 데이터만
    .order('measurement_start_date', { ascending: true }); // 날짜순 정렬

  if (error) {
    console.error('Error fetching journals:', error);
    return;
  }

  const wb = XLSX.utils.book_new();

  for (const office of DESIGNATED_OFFICES) {
    // 시트 분류는 지정지청(designated_office) 기준
    const filteredData = journals.filter(j => (j.designated_office || '').includes(office));
    
    console.log(`Sheet [${office}]: ${filteredData.length} records found.`);

    const sheetData = filteredData.map(j => {
      return {
        '코드': j.code,
        '공문연번': j.document_number,
        '연번': j.sequence_number,
        '5인 이상 연번': j.five_plus_sequence,
        '측정일': formatDatesRange(j.measurement_start_date, j.measurement_end_date),
        '요일': formatWeekDaysRange(j.measurement_start_date, j.measurement_end_date),
        '측정자': j.measurer,
        '측정주기': `${j.measurement_year || ''} ${j.measurement_period || ''}`,
        '비고': j.note,
        '소재지청': j.office_jurisdiction, // 소재지청 컬럼에 실제 소재지 정보 매칭
        '사업장명': j.business_name,
        '인원': j.total_employees,
        '사업자번호': j.business_number,
        '산재관리번호': j.industrial_accident_number,
        '대표자': j.representative_name,
        '주소': j.address,
        '전화번호': j.phone,
        'FAX': j.fax,
        '담당자 성명': j.manager_name,
        '담당자 직책': j.manager_position,
        '휴대폰': j.manager_mobile,
        '담당자 메일': j.manager_email,
        'K2B 전송일': j.k2b_send_date,
        'K2B 전송자': j.k2b_sender,
        '측정비(사업장)': j.measurement_fee_business,
        '측정비(국고)': j.measurement_fee_national,
        '측정비(합계)': j.measurement_fee_total,
        '입금일(사업장)': j.deposit_date_business,
        '입금액(사업장)': j.deposit_amount_business,
        '입금일(국고)': j.deposit_date_national,
        '입금액(국고)': j.deposit_amount_national,
        '입금액(합계)': j.deposit_total,
        '특이사항': j.special_notes
      };
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, office);
  }

  const fileName = `측정일지_추출_2026년도_2026-04-24.xlsx`;
  const filePath = path.resolve(process.cwd(), fileName);
  XLSX.writeFile(wb, filePath);
  
  console.log(`\nSuccess! Excel file updated: ${fileName}`);
}

exportJournal2026Final();
