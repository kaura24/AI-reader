import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

// 크롬 브라우저로 지정
process.env.BROWSER = 'chrome';

export default defineConfig({
    plugins: [tailwindcss(), sveltekit()],

    // 개발 서버 설정 추가
    server: {
        open: true  // 서버 시작 시 자동으로 크롬 브라우저 열기
    },

    test: {
        expect: { requireAssertions: true },

        projects: [
            {
                extends: './vite.config.js',

                test: {
                    name: 'client',

                    browser: {
                        enabled: true,
                        provider: playwright(),
                        instances: [{ browser: 'chromium', headless: true }]
                    },

                    include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
                    exclude: ['src/lib/server/**']
                }
            },

            {
                extends: './vite.config.js',

                test: {
                    name: 'server',
                    environment: 'node',
                    include: ['src/**/*.{test,spec}.{js,ts}'],
                    exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
                }
            }
        ]
    }
});
