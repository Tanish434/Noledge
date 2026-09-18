/**
 * Speech Cleaner Utility
 * Ports complete chemistry, LaTeX, Markdown, table, and code-fence cleaners
 * from agent/src/cleaner.py into TypeScript for natural spoken voice synthesis.
 */

const CHEMISTRY_SPEECH_PAIRS: [RegExp, (match: string, ...args: string[]) => string][] = [
  [/\b(?:(\d+)\s*)?C_?6H_?12O_?6\b/gi, (_m, p1) => (p1 ? `${p1} glucose` : 'glucose')],
  [/\b(?:(\d+)\s*)?CO_?2\b/gi, (_m, p1) => (p1 ? `${p1} carbon dioxide` : 'carbon dioxide')],
  [/\b(?:(\d+)\s*)?H_?2O\b/gi, (_m, p1) => (p1 ? `${p1} water` : 'water')],
  [/\b(?:(\d+)\s*)?O_?2\b/gi, (_m, p1) => (p1 ? `${p1} oxygen` : 'oxygen')],
  [/\b(?:(\d+)\s*)?N_?2\b/gi, (_m, p1) => (p1 ? `${p1} nitrogen` : 'nitrogen')],
  [/\b(?:(\d+)\s*)?H_?2\b/gi, (_m, p1) => (p1 ? `${p1} hydrogen` : 'hydrogen')],
  [/\b(?:(\d+)\s*)?CH_?4\b/gi, (_m, p1) => (p1 ? `${p1} methane` : 'methane')],
  [/\b(?:(\d+)\s*)?NaCl\b/gi, (_m, p1) => (p1 ? `${p1} sodium chloride` : 'sodium chloride')],
  [/\b(?:(\d+)\s*)?HCl\b/gi, (_m, p1) => (p1 ? `${p1} hydrochloric acid` : 'hydrochloric acid')],
  [/\b(?:(\d+)\s*)?H_?2SO_?4\b/gi, (_m, p1) => (p1 ? `${p1} sulfuric acid` : 'sulfuric acid')],
  [/\b(?:(\d+)\s*)?NH_?3\b/gi, (_m, p1) => (p1 ? `${p1} ammonia` : 'ammonia')],
  [/\b(?:(\d+)\s*)?CaCO_?3\b/gi, (_m, p1) => (p1 ? `${p1} calcium carbonate` : 'calcium carbonate')],
  [/\b(?:(\d+)\s*)?SO_?2\b/gi, (_m, p1) => (p1 ? `${p1} sulfur dioxide` : 'sulfur dioxide')],
  [/\b(?:(\d+)\s*)?NO_?2\b/gi, (_m, p1) => (p1 ? `${p1} nitrogen dioxide` : 'nitrogen dioxide')],
  [/\bATP\b/g, () => 'A T P'],
  [/\bADP\b/g, () => 'A D P'],
  [/\bNADPH\b/g, () => 'N A D P H'],
  [/\bNADP\+\b/g, () => 'N A D P plus'],
  [/\bDNA\b/g, () => 'D N A'],
  [/\bRNA\b/g, () => 'R N A'],
  [/\bmRNA\b/g, () => 'messenger R N A'],
];

export function cleanChemistryAndLatex(text: string): string {
  let res = text;
  // 1. Strip and simplify LaTeX text wrappers ($ \text{CO}_2$ -> CO_2)
  res = res.replace(/\\text\{([^}]+)\}/g, '$1');
  res = res.replace(/_\{?(\d+)\}?/g, '_$1');
  res = res.replace(/\^\{?(\d+)\}?/g, '^$1');
  res = res.replace(/\$+\s*([^$]+?)\s*\$+/g, '$1');

  // 2. Chemical formulas to natural spoken terms
  for (const [pattern, repl] of CHEMISTRY_SPEECH_PAIRS) {
    res = res.replace(pattern, (match: string, ...args: string[]) => repl(match, ...args));
  }

  // 3. Math & chemical reaction arrows
  res = res.replace(/\\rightarrow/g, ' yields ');
  res = res.replace(/\\to/g, ' yields ');
  res = res.replace(/\\times/g, ' times ');
  res = res.replace(/\\approx/g, ' approximately ');
  res = res.replace(/\\pm/g, ' plus or minus ');
  res = res.replace(/\\degree/g, ' degrees ');

  // 4. Exponents / subscripts
  res = res.replace(/\^2\b/g, ' squared');
  res = res.replace(/\^3\b/g, ' cubed');
  res = res.replace(/\^(\d+)/g, ' to the power of $1');
  res = res.replace(/_(\d+)/g, ' $1');

  // 5. Clean out all leftover LaTeX tokens and math delimiters
  res = res.replace(/[\$\\{}]/g, '');

  // Clean multiple spaces
  res = res.replace(/[ \t]+/g, ' ');
  return res.trim();
}

export function cleanForSpeech(text: string): string {
  if (!text) return '';

  // Extract spoken summary block if present
  const spokenMatch = text.match(/<{2,3}\s*(?:SPOKEN_SUMMARY|SUMMARY)?\s*>{2,3}([\s\S]*?)<{2,3}\s*(?:END_SPOKEN_SUMMARY|END_SUMMARY)?\s*>{2,3}/i);
  if (spokenMatch && spokenMatch[1]) {
    return cleanChemistryAndLatex(spokenMatch[1].trim());
  }

  const lines = text.split('\n');
  const output: string[] = [];
  let inCodeBlock = false;
  let inTable = false;

  for (const rawLine of lines) {
    const stripped = rawLine.trim();

    // Code fence handling
    if (stripped.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) continue;
      const lang = stripped.slice(3).trim().toLowerCase();
      if (lang.includes('chart') || lang.includes('graph')) {
        output.push('I have generated the interactive chart on your screen.');
      } else if (['python', 'js', 'javascript', 'html', 'css', 'sql', 'bash', 'json', 'ts', 'typescript'].includes(lang)) {
        output.push('I have displayed the code snippet on your screen.');
      }
      continue;
    }

    if (inCodeBlock) continue;

    // Table divider handling: | :--- | :--- |
    if (/^\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?$/.test(stripped)) {
      inTable = true;
      continue;
    }

    // Table rows handling: | Cell 1 | Cell 2 |
    if (stripped.startsWith('|') && stripped.endsWith('|')) {
      const rawCells = stripped
        .slice(1, -1)
        .split('|')
        .map((c) => c.replace(/[*_`]/g, '').trim())
        .filter(Boolean);

      if (!inTable) {
        inTable = true;
        continue;
      } else {
        if (rawCells.length >= 3) {
          output.push(`${rawCells[0]} for ${rawCells[1]}: ${rawCells.slice(2).join('. ')}.`);
        } else if (rawCells.length === 2) {
          output.push(`${rawCells[0]}: ${rawCells[1]}.`);
        } else if (rawCells.length > 0) {
          output.push(`${rawCells.join(', ')}.`);
        }
        continue;
      }
    }

    inTable = false;

    // Clean markdown prose and chemistry
    let cleaned = cleanChemistryAndLatex(stripped);
    cleaned = cleaned.replace(/^#{1,6}\s+/g, '');
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    cleaned = cleaned.replace(/^\s*[-*+]\s+/g, '');
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    cleaned = cleaned.replace(/\|/g, '');

    if (cleaned.trim()) {
      output.push(cleaned.trim());
    }
  }

  return output.join(' ').replace(/\s+/g, ' ').trim();
}
