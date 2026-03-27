
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkMarubalData() {
  const businessName = "주식회사 마루벌";
  console.log(`Checking data for: ${businessName}`);

  // 1. business_info 조회
  const businessInfo = await prisma.business_info.findFirst({
    where: { business_name: { contains: businessName } }
  });
  console.log("Business Info:", businessInfo ? {
    code: businessInfo.code,
    business_name: businessInfo.business_name,
    total_employees: (businessInfo as any).total_employees,
    commencement_number: (businessInfo as any).commencement_number
  } : "Not found");

  if (businessInfo) {
    // 2. measurement_business 조회 (최근 데이터 순)
    const measurements = await prisma.measurement_business.findMany({
      where: { code: businessInfo.code },
      orderBy: [
        { year: 'desc' },
        { period: 'desc' }
      ],
      take: 5
    });
    console.log("Measurement Business History:", measurements.map(m => ({
      year: m.year,
      period: m.period,
      total_employees: m.total_employees,
      commencement_number: m.commencement_number
    })));
  }

  await prisma.$disconnect();
}

checkMarubalData().catch(console.error);
