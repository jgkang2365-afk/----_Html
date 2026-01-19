#!/usr/bin/env node

/**
 * Next.js 캐시 정리 스크립트
 * .next 폴더와 node_modules/.cache 폴더를 삭제합니다.
 * Windows에서 파일 잠금 문제를 방지하기 위해 Node.js 프로세스도 종료합니다.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

const foldersToRemove = [
  path.join(projectRoot, '.next'),
  path.join(projectRoot, 'node_modules', '.cache'),
];

console.log('🧹 Next.js 캐시 정리 중...\n');

// Windows에서 Node.js 프로세스 종료 시도 (파일 잠금 방지)
if (process.platform === 'win32') {
  try {
    console.log('⏳ 실행 중인 Node.js 프로세스 확인 중...');
    execSync('tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I /N "node.exe"', { stdio: 'ignore' });
    console.log('⚠️  실행 중인 Node.js 프로세스가 있습니다.');
    console.log('💡 개발 서버를 먼저 종료(Ctrl+C)한 후 다시 실행하세요.\n');
  } catch (error) {
    // Node.js 프로세스가 없으면 정상 진행
  }
}

let removedCount = 0;
let errorCount = 0;

foldersToRemove.forEach((folderPath) => {
  try {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      const relativePath = path.relative(projectRoot, folderPath);
      console.log(`✅ 삭제 완료: ${relativePath}`);
      removedCount++;
    } else {
      const relativePath = path.relative(projectRoot, folderPath);
      console.log(`ℹ️  없음: ${relativePath}`);
    }
  } catch (error) {
    const relativePath = path.relative(projectRoot, folderPath);
    console.error(`❌ 오류 발생 (${relativePath}):`, error.message);
    errorCount++;
  }
});

console.log('\n' + '='.repeat(50));
if (errorCount === 0) {
  console.log(`✨ 캐시 정리 완료! (${removedCount}개 폴더 삭제)`);
  console.log('💡 개발 서버를 재시작하세요: npm run dev');
} else {
  console.log(`⚠️  일부 폴더 삭제 실패 (${errorCount}개)`);
  console.log('💡 개발 서버를 종료한 후 다시 시도하세요.');
}
console.log('='.repeat(50));

process.exit(errorCount > 0 ? 1 : 0);
