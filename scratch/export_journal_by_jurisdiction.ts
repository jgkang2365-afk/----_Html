import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const JURISDICTIONS = ['천안', '대전', '평택', '경기'];

function getDayOfWeek(dateStr: string) {
  if (!dateStr) return '';
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(dateStr);
  return days[date.getDay()];
}

async function exportJournalExcel() {
  console.log('Fetching all journals...');
  const { data: journals, error } = await supabase
    .from('measurement_journal')
    .select('*')
    .order('measurement_start_date', { ascending: false });

  if (error) {
    console.error('Error fetching journals:', error);
    return;
  }

  const wb = XLSX.utils.book_new();

  for (const jurs of JURISDICTIONS) {
    const filteredData = journals.filter(j => (j.office_jurisdiction || '').includes(jurs));
    
    const sheetData = filteredData.map(j => {
      const measurement_date = j.measurement_start_date === j.measurement_end_date 
        ? j.measurement_start_date 
        : `${j.measurement_start_date || ''} ~ ${j.measurement_end_date || ''}`;

      return {
        '코드': j.code,
        '공문연번': j.document_number,
        '연번': j.sequence_number,
        '5인 이상 연번': j.five_plus_sequence,
        '측정일지': measurement_date,
        '요일': getDayOfWeek(j.measurement_start_date),
        '측정자': j.measurer,
        '측정주기': `${j.measurement_year || ''} ${j.measurement_period || ''}`,
        '비고': j.note,
        '소재지청': j.office_jurisdiction,
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
    XLSX.utils.book_append_sheet(wb, ws, jurs);
  }

  const fileName = `측정일지_추출_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filePath = path.resolve(process.cwd(), fileName);
  XLSX.writeFile(wb, filePath);
  
  console.log(`Excel file created: ${fileName}`);
  console.log(`Total records: ${journals.length}`);
}

exportJournalExcel();
