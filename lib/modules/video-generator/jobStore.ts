import path from 'path';
import { JobRecord } from '@/lib/types';
import { sessionDir, atomicWriteJson, readJsonFile, ensureDir } from '@/lib/utils/file-utils';

function jobRecordsPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'job_records.json');
}

export async function saveJobRecord(sessionId: string, record: JobRecord): Promise<void> {
  await ensureDir(sessionDir(sessionId));
  const existing = await loadJobRecords(sessionId);
  const idx = existing.findIndex((r) => r.momentId === record.momentId);
  if (idx >= 0) {
    existing[idx] = record;
  } else {
    existing.push(record);
  }
  await atomicWriteJson(jobRecordsPath(sessionId), existing);
}

export async function loadJobRecords(sessionId: string): Promise<JobRecord[]> {
  const records = await readJsonFile<JobRecord[]>(jobRecordsPath(sessionId));
  return records ?? [];
}
