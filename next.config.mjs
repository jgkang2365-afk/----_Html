/** @type {import('next').NextConfig} */
const nextConfig = {

    webpack: (config) => {
        config.cache = false;
        // 파일 변경 감지 폴링 설정 (Windows 파일 잠금 완화)
        config.watchOptions = {
            poll: 1000,
            aggregateTimeout: 300,
        };
        return config;
    },
};

export default nextConfig;
