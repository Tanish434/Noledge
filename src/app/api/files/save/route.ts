import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const { filePath, markdownContent, fullDeckMarkdown } = await req.json() as {
      filePath?: string;
      markdownContent?: string;
      fullDeckMarkdown?: string;
    };

    if (!filePath) {
      return NextResponse.json({ error: 'filePath is required' }, { status: 400 });
    }

    // Clean and normalize target path
    let targetPath = filePath
      .replace(/^File:\s*/i, '')
      .replace(/^Obsidian File:\s*/i, '')
      .replace(/^Local File:\s*/i, '')
      .replace(/\s*\(\d+\s+questions\)$/i, '')
      .trim();

    if (!path.isAbsolute(targetPath)) {
      const cwdPath = path.join(process.cwd(), targetPath);
      const questionsPath = path.join(process.cwd(), 'questions', path.basename(targetPath));
      if (!fs.existsSync(cwdPath) && fs.existsSync(questionsPath)) {
        targetPath = questionsPath;
      } else {
        targetPath = cwdPath;
      }
    }
    // Ensure target path uses .json extension
    if (targetPath.toLowerCase().endsWith('.md') || targetPath.toLowerCase().endsWith('.markdown')) {
      targetPath = targetPath.replace(/\.(md|markdown)$/i, '.json');
    }

    if (fullDeckMarkdown !== undefined) {
      const contentToWrite = fullDeckMarkdown.trim() + '\n';
      const baseName = path.basename(targetPath).replace(/\.(md|markdown)$/i, '.json');
      const userHome = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\001bi';

      const candidatePaths = [
        targetPath,
        path.join(userHome, 'Downloads', baseName),
        path.join(userHome, 'Desktop', baseName),
        path.join(userHome, 'Documents', baseName),
        path.join(process.cwd(), baseName),
        path.join(process.cwd(), 'questions', baseName),
      ];

      const writtenSet = new Set<string>();
      for (const cand of candidatePaths) {
        try {
          const norm = path.normalize(cand);
          if (writtenSet.has(norm)) continue;
          if (fs.existsSync(norm) || norm === path.normalize(targetPath)) {
            const dir = path.dirname(norm);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(norm, contentToWrite, 'utf-8');
            writtenSet.add(norm);
          }
        } catch {
          // Ignore
        }
      }

      return NextResponse.json({ success: true, path: targetPath, writtenCount: writtenSet.size });
    } else if (!fs.existsSync(targetPath)) {
      // Try resolving in project root / questions folder for append
      const fallbackPath = path.join(process.cwd(), 'questions', path.basename(targetPath));
      if (fs.existsSync(fallbackPath)) {
        targetPath = fallbackPath;
      }
    } else if (markdownContent) {
      // Append single question
      const existingContent = fs.readFileSync(targetPath, 'utf-8');
      const needsDivider = !existingContent.trim().endsWith('---');
      const newFileContent = `${existingContent.trim()}\n\n${needsDivider ? '---\n\n' : ''}${markdownContent.trim()}\n`;
      fs.writeFileSync(targetPath, newFileContent, 'utf-8');
    }

    return NextResponse.json({ success: true, path: targetPath });
  } catch (err) {
    console.error('[api/files/save]', err);
    return NextResponse.json({ error: 'Failed to write file to disk' }, { status: 500 });
  }
}
