import { NextResponse } from 'next/server';
import { SUPPORTED_MODELS } from '@/src/models';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(SUPPORTED_MODELS);
}
