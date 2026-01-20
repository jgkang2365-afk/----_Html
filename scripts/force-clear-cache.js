#!/usr/bin/env node

/**
 * 강제 캐시 정리 스크립트
 * Windows에서 파일 잠금 문제를 해결하기 위해 더 강력한 방법 사용
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const nextFolder = path.join(projectRoot, '.next');

console.log('🔧 강제 캐시 정리 시작...\n');

// Windows에서 파일 잠금 해제를 위한 대기 시간
const waitForUnlock = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function removeFolder(folderPath) {
  const maxRetries = 5;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      if (fs.existsSync(folderPath)) {
        // Windows에서 강제 삭제 시도
        if (process.platform === 'win32') {
          try {
            // rmdir 명령어로 강제 삭제 시도
            execSync(`rmdir /s /q "${folderPath}"`, { stdio: 'ignore' });
          } catch (error) {
            // rmdir 실패 시 fs.rmSync 사용
            fs.rmSync(folderPath, { recursive: true, force: true, maxRetries: 3 });
          }
        } else {
          fs.rmSync(folderPath, { recursive: true, force: true });
        }
        
        // 삭제 확인
        if (!fs.existsSync(folderPath)) {
          return true;
        }
      } else {
        return true; // 이미 없음
      }
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        console.log(`⏳ 재시도 중... (${retries}/${maxRetries})`);
        await waitForUnlock(1000 * retries); // 점진적 대기
      } else {
        console.error(`❌ 삭제 실패: ${error.message}`);
        return false;
      }
    }
  }
  return false;
}

async function main() {
  // Node.js 프로세스 종료 안내
  if (process.platform === 'win32') {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I /N "node.exe"', { encoding: 'utf-8' });
      if (result.trim()) {
        console.log('⚠️  실행 중인 Node.js 프로세스가 감지되었습니다.');
        console.log('💡 개발 서버를 완전히 종료한 후 다시 시도하세요.\n');
        console.log('   종료 방법:');
        console.log('   1. 터미널에서 Ctrl+C');
        console.log('   2. 작업 관리자에서 node.exe 프로세스 종료\n');
      }
    } catch (error) {
      // 프로세스가 없으면 정상 진행
    }
  }

  console.log('🗑️  .next 폴더 삭제 중...');
  const success = await removeFolder(nextFolder);
  
  if (success) {
    console.log('✅ 캐시 정리 완료!\n');
    console.log('💡 이제 개발 서버를 재시작하세요: npm run dev');
  } else {
    console.log('\n❌ 캐시 정리 실패');
    console.log('💡 다음을 시도해보세요:');
    console.log('   1. 개발 서버 완전 종료');
    console.log('   2. 작업 관리자에서 node.exe 프로세스 확인 및 종료');
    console.log('   3. 수동으로 .next 폴더 삭제');
    console.log('   4. 바이러스 백신 소프트웨어 일시 중지');
    process.exit(1);
  }
}

main();
