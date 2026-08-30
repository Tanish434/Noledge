import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get('filePath');

    if (!filePath) {
      return NextResponse.json({ error: 'filePath parameter is required' }, { status: 400 });
    }

    let targetPath = filePath
      .replace(/^File:\s*/i, '')
      .replace(/^Obsidian File:\s*/i, '')
      .replace(/^Local File:\s*/i, '')
      .replace(/\s*\(\d+\s+questions\)$/i, '')
      .trim();

    if (!path.isAbsolute(targetPath)) {
      targetPath = path.join(process.cwd(), targetPath);
    }
    targetPath = path.normalize(targetPath);

    const baseName = path.basename(targetPath);
    const jsonBaseName = baseName.replace(/\.(md|markdown)$/i, '.json');
    const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\001bi';

    const candidatePaths = [
      targetPath,
      targetPath.replace(/\.(md|markdown)$/i, '.json'),
      path.join(userHome, 'Downloads', baseName),
      path.join(userHome, 'Downloads', jsonBaseName),
      path.join(userHome, 'Desktop', baseName),
      path.join(userHome, 'Desktop', jsonBaseName),
      path.join(userHome, 'Documents', baseName),
      path.join(userHome, 'Documents', jsonBaseName),
      path.join(process.cwd(), 'questions', baseName),
      path.join(process.cwd(), 'questions', jsonBaseName),
      path.join(process.cwd(), baseName),
      path.join(process.cwd(), jsonBaseName),
    ];

    let resolvedPath = '';
    for (const cand of candidatePaths) {
      try {
        const norm = path.normalize(cand);
        if (fs.existsSync(norm)) {
          resolvedPath = norm;
          break;
        }
      } catch {
        // Ignore
      }
    }

    if (!resolvedPath) {
      return NextResponse.json({ error: `File not found at ${targetPath}` }, { status: 404 });
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    return NextResponse.json({ success: true, content, path: resolvedPath });
  } catch (err) {
    console.error('[api/files/read]', err);
    return NextResponse.json({ error: 'Failed to read file from disk' }, { status: 500 });
  }
}
