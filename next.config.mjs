import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
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
        instrumentationHook: true
    }
};

export default nextConfig;
