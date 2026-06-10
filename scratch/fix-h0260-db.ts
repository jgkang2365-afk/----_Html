import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixH0260Sync() {
  const code = 'H0260';
  const year = 2026;
  const period = '상반기';

  // 사용자의 이미지 데이터와 동일한 JSON 구성
  const dailyStaff = [
    {
      date: '2026-04-21',
      measurer_id: 17, // 한기문
      collaborators: ['고유빈']
    },
    {
      date: '2026-04-22',
      measurer_id: 17, // 한기문
      collaborators: ['고유빈', '강종구']
    }
  ];

  console.log(`[Manual Sync] Aggregating collaborators for ${code}...`);
  
  const allCollaboratorsSet = new Set<string>();
  dailyStaff.forEach(d => {
    d.collaborators.forEach(c => allCollaboratorsSet.add(c.trim()));
  });
  
  const unifiedCollaborators = Array.from(allCollaboratorsSet).filter(Boolean).sort().join(", ");
  const maxEndDate = '2026-04-22';

  console.log(`[Manual Sync] New Summary -> Collaborators: ${unifiedCollaborators}, EndDate: ${maxEndDate}`);

  const { error: updateError } = await supabase
    .from("measurement_target_business")
    .update({
      daily_staff: dailyStaff,
      collaborators: unifiedCollaborators,
      measurement_end_date: maxEndDate
    })
    .eq("code", code)
    .eq("year", year)
    .eq("period", period);

  if (updateError) {
    console.error("Update Error:", updateError);
  } else {
    console.log("Successfully synchronized H0260 data consistency!");
  }
}

fixH0260Sync();
