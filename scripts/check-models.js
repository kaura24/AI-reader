#!/usr/bin/env node
/**
 * OpenAI 사용 가능한 모델 목록 확인 스크립트
 * 실행: npm run check-models
 */

import OpenAI from 'openai';
import { config } from 'dotenv';

// .env 파일 로드
config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
	console.error('❌ 오류: OPENAI_API_KEY가 설정되지 않았습니다.');
	console.error('   .env 파일에 OPENAI_API_KEY를 설정해주세요.');
	process.exit(1);
}

const openai = new OpenAI({
	apiKey: OPENAI_API_KEY
});

async function checkModels() {
	console.log('🔍 OpenAI 사용 가능한 모델 목록을 확인합니다...\n');

	try {
		const models = await openai.models.list();
		
		// GPT 모델만 필터링
		const gptModels = models.data
			.filter(m => m.id.includes('gpt'))
			.sort((a, b) => a.id.localeCompare(b.id));

		console.log('📋 사용 가능한 GPT 모델:');
		console.log('─'.repeat(50));
		
		for (const model of gptModels) {
			console.log(`  • ${model.id}`);
		}
		
		console.log('─'.repeat(50));
		console.log(`총 ${gptModels.length}개 모델\n`);

		// 권장 모델 확인
		const targetModels = ['gpt-5-mini-2025-08-07', 'gpt-5-mini', 'gpt-4o-mini'];
		console.log('🎯 권장 모델 사용 가능 여부:');
		
		for (const target of targetModels) {
			const available = gptModels.some(m => m.id === target);
			const status = available ? '✅ 사용 가능' : '❌ 사용 불가';
			console.log(`  • ${target}: ${status}`);
		}

	} catch (error) {
		console.error('❌ 모델 목록 조회 실패:', error.message);
		process.exit(1);
	}
}

checkModels();

