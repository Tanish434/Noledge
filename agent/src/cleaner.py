import re
from typing import List

CHEMISTRY_SPEECH_PAIRS = [
    (r"\b(?:(\d+)\s*)?C_?6H_?12O_?6\b", lambda m: f"{m.group(1)} glucose" if m.group(1) else "glucose"),
    (r"\b(?:(\d+)\s*)?CO_?2\b", lambda m: f"{m.group(1)} carbon dioxide" if m.group(1) else "carbon dioxide"),
    (r"\b(?:(\d+)\s*)?H_?2O\b", lambda m: f"{m.group(1)} water" if m.group(1) else "water"),
    (r"\b(?:(\d+)\s*)?O_?2\b", lambda m: f"{m.group(1)} oxygen" if m.group(1) else "oxygen"),
    (r"\b(?:(\d+)\s*)?N_?2\b", lambda m: f"{m.group(1)} nitrogen" if m.group(1) else "nitrogen"),
    (r"\b(?:(\d+)\s*)?H_?2\b", lambda m: f"{m.group(1)} hydrogen" if m.group(1) else "hydrogen"),
    (r"\b(?:(\d+)\s*)?CH_?4\b", lambda m: f"{m.group(1)} methane" if m.group(1) else "methane"),
    (r"\b(?:(\d+)\s*)?NaCl\b", lambda m: f"{m.group(1)} sodium chloride" if m.group(1) else "sodium chloride"),
    (r"\b(?:(\d+)\s*)?HCl\b", lambda m: f"{m.group(1)} hydrochloric acid" if m.group(1) else "hydrochloric acid"),
    (r"\b(?:(\d+)\s*)?H_?2SO_?4\b", lambda m: f"{m.group(1)} sulfuric acid" if m.group(1) else "sulfuric acid"),
    (r"\b(?:(\d+)\s*)?NH_?3\b", lambda m: f"{m.group(1)} ammonia" if m.group(1) else "ammonia"),
    (r"\b(?:(\d+)\s*)?CaCO_?3\b", lambda m: f"{m.group(1)} calcium carbonate" if m.group(1) else "calcium carbonate"),
    (r"\b(?:(\d+)\s*)?SO_?2\b", lambda m: f"{m.group(1)} sulfur dioxide" if m.group(1) else "sulfur dioxide"),
    (r"\b(?:(\d+)\s*)?NO_?2\b", lambda m: f"{m.group(1)} nitrogen dioxide" if m.group(1) else "nitrogen dioxide"),
    (r"\bATP\b", lambda m: "A T P"),
    (r"\bADP\b", lambda m: "A D P"),
    (r"\bNADPH\b", lambda m: "N A D P H"),
    (r"\bNADP\+\b", lambda m: "N A D P plus"),
    (r"\bDNA\b", lambda m: "D N A"),
    (r"\bRNA\b", lambda m: "R N A"),
    (r"\bmRNA\b", lambda m: "messenger R N A"),
]

def clean_chemistry_and_latex(text: str) -> str:
    """Transforms raw chemical formulas and LaTeX notation into clean spoken English."""
    res = text
    # 1. Strip and simplify LaTeX text wrappers ($ \text{CO}_2$ -> CO_2)
    res = re.sub(r"\\text\{([^}]+)\}", r"\1", res)
    res = re.sub(r"_\{?(\d+)\}?", r"_\1", res)
    res = re.sub(r"\^\{?(\d+)\}?", r"^\1", res)
    res = re.sub(r"\$+\s*([^$]+?)\s*\$+", r"\1", res)

    # 2. Chemical formulas to natural spoken terms
    for pattern, repl in CHEMISTRY_SPEECH_PAIRS:
        res = re.sub(pattern, repl, res, flags=re.IGNORECASE)

    # 3. Math & chemical reaction arrows
    res = res.replace(r"\rightarrow", " yields ")
    res = res.replace(r"\to", " yields ")
    res = res.replace(r"\times", " times ")
    res = res.replace(r"\approx", " approximately ")
    res = res.replace(r"\pm", " plus or minus ")
    res = res.replace(r"\degree", " degrees ")

    # 4. Exponents / subscripts
    res = re.sub(r"\^2\b", " squared", res)
    res = re.sub(r"\^3\b", " cubed", res)
    res = re.sub(r"\^(\d+)", r" to the power of \1", res)
    res = re.sub(r"_(\d+)", r" \1", res)

    # 5. Clean out all leftover LaTeX tokens and math delimiters
    res = res.replace("$", "").replace("\\", "").replace("{", "").replace("}", "")

    # Clean multiple spaces
    res = re.sub(r"[ \t]+", " ", res)
    return res.strip()

class StreamSpeechFilter:
    """
    Streaming speech filter for LiveKit TTS (Cartesia / ElevenLabs).
    Buffers tokens line-by-line to strip Markdown table delimiters (| :--- |),
    convert table rows to conversational sentences, suppress raw code blocks,
    and eliminate markdown punctuation from audio synthesis without impacting
    the visual chat transcript.
    """
    def __init__(self):
        self.buffer = ""
        self.in_code_block = False
        self.in_table = False
        self.table_headers: List[str] = []

    def push(self, chunk: str) -> List[str]:
        if not chunk:
            return []
        self.buffer += chunk
        output: List[str] = []

        while "\n" in self.buffer or (not self.in_code_block and not self.in_table and re.search(r'([.!?])\s+', self.buffer)):
            if "\n" in self.buffer:
                line, self.buffer = self.buffer.split("\n", 1)
            else:
                m = re.search(r'([.!?])\s+', self.buffer)
                end_idx = m.end()
                line = self.buffer[:end_idx]
                self.buffer = self.buffer[end_idx:]

            processed = self._process_line(line)
            if processed:
                output.append(processed)

        return output

    def flush(self) -> List[str]:
        output: List[str] = []
        if self.buffer.strip():
            processed = self._process_line(self.buffer)
            if processed:
                output.append(processed)
        self.buffer = ""
        self.in_code_block = False
        self.in_table = False
        self.table_headers = []
        return output

    def _process_line(self, line: str) -> str:
        stripped = line.strip()

        # Handle code fences (```chart, ```python, etc.)
        if stripped.startswith("```"):
            self.in_code_block = not self.in_code_block
            if not self.in_code_block:
                return ""
            lang = stripped[3:].strip().lower()
            if "chart" in lang or "graph" in lang:
                return " I have generated the interactive chart on your screen. "
            elif lang in ("python", "js", "javascript", "html", "css", "sql", "bash", "json"):
                return " I have displayed the code snippet on your screen. "
            return ""

        # Suppress code contents from being spoken
        if self.in_code_block:
            return ""

        # Handle table divider: | :--- | :--- |
        if re.match(r"^\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?$", stripped):
            self.in_table = True
            return ""

        # Handle table rows: | Cell 1 | Cell 2 | ...
        if stripped.startswith("|") and stripped.endswith("|"):
            raw_cells = [
                c.replace("*", "").replace("_", "").replace("`", "").strip()
                for c in stripped[1:-1].split("|")
            ]
            cells = [c for c in raw_cells if c]
            if not self.in_table:
                # First row is table headers
                self.table_headers = cells
                self.in_table = True
                return ""
            else:
                # Table data row -> natural spoken statement
                if len(cells) >= 3:
                    return f" {cells[0]} for {cells[1]}: " + ". ".join(cells[2:]) + ". "
                elif len(cells) == 2:
                    return f" {cells[0]}: {cells[1]}. "
                elif cells:
                    return " " + ", ".join(cells) + ". "
                return ""

        self.in_table = False
        self.table_headers = []

        # Clean prose, chemistry, and markdown formatting
        cleaned = clean_chemistry_and_latex(stripped)
        cleaned = re.sub(r"^#{1,6}\s+", "", cleaned)
        cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
        cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
        cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
        cleaned = re.sub(r"_([^_]+)_", r"\1", cleaned)
        cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
        cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
        cleaned = re.sub(r"^\s*[-*+]\s+", "", cleaned)
        cleaned = cleaned.replace("|", "")
        return cleaned + "\n" if cleaned else ""

def clean_for_speech(text: str) -> str:
    """Convenience full-text cleaner."""
    f = StreamSpeechFilter()
    parts = f.push(text)
    parts.extend(f.flush())
    res = "".join(parts).strip()
    return re.sub(r"\n\s*\n", "\n\n", res)
