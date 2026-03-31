import { findOfficeByAddress, classifyDesignatedOffice } from "../lib/utils/jurisdiction-matcher";

const testCases = [
  { address: "충청남도 서산시 대산읍 독곶리 123", expectedOffice: "서산", expectedDesignated: "천안" },
  { address: "충남 태안군 안면읍 승언리 456", expectedOffice: "서산", expectedDesignated: "천안" },
  { address: "제주특별자치도 제주시 첨단로 242", expectedOffice: "광주", expectedDesignated: "천안" },
  { address: "제주도 서귀포시 중문동 100", expectedOffice: "광주", expectedDesignated: "천안" },
  { address: "제주시 한림읍 123", expectedOffice: "광주", expectedDesignated: "천안" },
  { address: "충청남도 천안시 서북구 성거읍", expectedOffice: "천안", expectedDesignated: "천안" },
  { address: "대전광역시 서구 둔산동", expectedOffice: "대전", expectedDesignated: "대전" },
  { address: "경기도 평택시 경기대로", expectedOffice: "평택", expectedDesignated: "평택" },
  { address: "수원시 영통구", expectedOffice: "경기", expectedDesignated: "경기" },
  { address: "인천광역시 부평구", expectedOffice: "인천북부", expectedDesignated: "천안" },
  { address: "서울시 강남구 테헤란로", expectedOffice: "서울강남", expectedDesignated: "천안" },
];

console.log("=== 제주를 광주로 통합한 최종 관할지청 매칭 테스트 === ");
let successCount = 0;

testCases.forEach((tc, index) => {
  const office = findOfficeByAddress(tc.address);
  const designated = classifyDesignatedOffice(office);
  
  const isOfficeMatch = office === tc.expectedOffice;
  const isDesignatedMatch = designated === tc.expectedDesignated;
  
  if (isOfficeMatch && isDesignatedMatch) {
    console.log(`[PASS] ${index + 1}: ${tc.address} -> ${office}/${designated}`);
    successCount++;
  } else {
    console.log(`[FAIL] ${index + 1}: ${tc.address}`);
    console.log(`  - 예상 관할: ${tc.expectedOffice}, 실제: ${office}`);
    console.log(`  - 예상 지정: ${tc.expectedDesignated}, 실제: ${designated}`);
  }
});

console.log(`\n결과: ${successCount} / ${testCases.length} 통과`);
if (successCount === testCases.length) {
  console.log("모든 테스트를 통과했습니다! (광주 통합 완료)");
} else {
  console.log("일부 테스트가 실패했습니다. 로직 확인이 필요합니다.");
}
