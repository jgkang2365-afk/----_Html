import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
    env: {
        // VERCEL_ENV is a platform-owned value. Expose only this non-secret identity
        // so the browser Supabase client can cross-check Preview vs Production.
        NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV || 'development',
    },
    webpack: (config) => {
        // config.cache = false;

        // 정적 분석 및 해석 범위 제한
        config.resolve.modules = [
            path.resolve(process.cwd(), 'node_modules'),
            'node_modules'
        ];

        config.resolve.roots = [process.cwd()];
        config.resolve.symlinks = false; // 상위 디렉토리 등으로의 심볼릭 링크 추적 차단

        // 파일 변경 감지 폴링 설정 (Windows 파일 잠금 완화)
        config.watchOptions = {
            poll: 1000,
            aggregateTimeout: 300,
        };

        return config;
    },
    // 빌드 시 제외할 경로 설정
    typescript: {
        ignoreBuildErrors: true,
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    experimental: {
        optimizePackageImports: ['lucide-react', 'recharts'],
        instrumentationHook: true,
        // Turbopack 번들 JSZip은 실제 HWPX section XML 해제 시 크기 불일치를 일으킨다.
        serverComponentsExternalPackages: ['node-cron', 'imapflow', 'selenium-webdriver', 'jszip']
    }
};

export default nextConfig;
