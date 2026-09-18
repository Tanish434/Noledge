import json
import logging
from pathlib import Path
from typing import Dict, Optional, Any, Tuple

logger = logging.getLogger("shader_manager")

PREF_FILE = Path(__file__).parent / "shader_preferences.json"

SHADERS: Dict[str, Dict[str, str]] = {
    "shdr-01": {"label": "SHDR-01", "name": "Prism Crystal", "note": "cut-glass crystal orb with a dispersive, turbulent interior"},
    "shdr-02": {"label": "SHDR-02", "name": "Scrollwork Dome", "note": "ornate scrollwork on a rolling gold dome"},
    "shdr-03": {"label": "SHDR-03", "name": "Rainbow Belt", "note": "a turbulent belt of light girdling the ball, contoured in rainbow"},
    "shdr-04": {"label": "SHDR-04", "name": "Voxel Lattice", "note": "a hollow shell of light, faceted by a voxel lattice"},
    "shdr-05": {"label": "SHDR-05", "name": "Chromatic Lenses", "note": "rainbow rings travelling through a lattice of lenses"},
    "shdr-06": {"label": "SHDR-06", "name": "Interference Lattice", "note": "a hundred glowing lattices stacked through the ball, interfering"},
    "shdr-07": {"label": "SHDR-07", "name": "Twist Column", "note": "a twist wave travelling out through the ball around a lit column"},
    "shdr-08": {"label": "SHDR-08", "name": "Pearl Contours", "note": "mother-of-pearl contour bands, each layer its own hue"},
    "shdr-09": {"label": "SHDR-09", "name": "Latitude Rings", "note": "torn rings of rainbow light worn as the ball's latitudes"},
    "shdr-10": {"label": "SHDR-10", "name": "Knit Light", "note": "a lattice of light knitted into the ball's own skin"},
    "shdr-11": {"label": "SHDR-11", "name": "Quantum Chroma", "note": "quantum orbital, rainbow chroma"},
    "shdr-12": {"label": "SHDR-12", "name": "Toy Bricks", "note": "a ball of glossy toy bricks, studs up - it rebuilds itself while it thinks"},
    "shdr-13": {"label": "SHDR-13", "name": "Plasma Globe", "note": "plasma globe: crawling lightning filaments"},
    "shdr-14": {"label": "SHDR-14", "name": "Pixel Plasma", "note": "a lit plasma dome quantized to chunky two-tone pixels"},
    "shdr-15": {"label": "SHDR-15", "name": "Particle Track", "note": "an iridescent particle-track web worn as the ball's skin"},
    "shdr-16": {"label": "SHDR-16", "name": "Water Caustics", "note": "sunlight through water - a caustic net crawling over the ball"},
    "shdr-17": {"label": "SHDR-17", "name": "Electric Storm", "note": "a grainy many-coloured storm with band shear and lightning"},
    "shdr-18": {"label": "SHDR-18", "name": "Folded Crystal", "note": "a crystal folded out of one eighth of space, tumbling"},
    "shdr-19": {"label": "SHDR-19", "name": "Cellular Beads", "note": "beads swelling and shrinking in their cells, packed over the ball"},
    "shdr-20": {"label": "SHDR-20", "name": "Fountain Film", "note": "a water film rushing down the ball, fountain-style"},
    "shdr-21": {"label": "SHDR-21", "name": "Cloud Diffusion", "note": "light diffusing through a cloud"},
    "shdr-22": {"label": "SHDR-22", "name": "Magnetic Field", "note": "field lines swirling around the ball about a wandering axis"},
    "shdr-23": {"label": "SHDR-23", "name": "CRT Matrix", "note": "an ASCII glyph matrix in CRT green, wrapped on the ball"},
    "shdr-24": {"label": "SHDR-24", "name": "Voxel Earth", "note": "a Minecraft Earth - a perfect voxel sphere whose seasons cycle it through worlds"},
    "shdr-25": {"label": "SHDR-25", "name": "Warped Field", "note": "the folds of a warped field, drawn by their own steepness"},
    "shdr-26": {"label": "SHDR-26", "name": "Thread Web", "note": "a crazed web of coloured threads knotted to a cell grid"},
    "shdr-27": {"label": "SHDR-27", "name": "Radar Mosaic", "note": "a weather-radar mosaic, fronts of coloured pixels sweeping the ball"},
    "shdr-28": {"label": "SHDR-28", "name": "Binary Grid", "note": "nested binary grids shuttering on a tumbling bit-sphere"},
    "shdr-29": {"label": "SHDR-29", "name": "LED Wall", "note": "an LED tile wall lighting up in flowing blobs, wrapped on the ball"},
    "shdr-30": {"label": "SHDR-30", "name": "Vanishing Meadow", "note": "a meadow folding into itself toward a blue vanishing point"},
    "shdr-31": {"label": "SHDR-31", "name": "Volumetric Rays", "note": "raymarched shell, volumetric godrays"},
    "shdr-32": {"label": "SHDR-32", "name": "Galactic Core", "note": "a galaxy marched as gas and dust inside the ball"},
    "shdr-33": {"label": "SHDR-33", "name": "Thermal Riso", "note": "a thermal image, risograph-printed on the ball"}
}

def load_preferences() -> Dict[str, Any]:
    if PREF_FILE.exists():
        try:
            with open(PREF_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Error reading {PREF_FILE}: {e}")
    return {"aliases": {}, "favorites": []}

def save_preferences(prefs: Dict[str, Any]):
    try:
        with open(PREF_FILE, "w", encoding="utf-8") as f:
            json.dump(prefs, f, indent=2)
    except Exception as e:
        logger.warning(f"Error saving {PREF_FILE}: {e}")

def resolve_shader(query: str) -> Optional[Tuple[str, Dict[str, str]]]:
    """
    Resolve a user query to a canonical shader key (e.g. 'shdr-13').
    Matches against:
    1. Aliases
    2. Exact key (shdr-01 or 01 or 1)
    3. Name keywords (e.g. 'glass', 'matrix', 'crystal', 'water', 'plasma', 'godrays')
    4. Note keywords
    """
    q = query.strip().lower()
    if not q:
        return None

    prefs = load_preferences()
    # 1. Check user aliases
    for alias, skey in prefs.get("aliases", {}).items():
        if alias.lower() in q or q in alias.lower():
            if skey in SHADERS:
                return skey, SHADERS[skey]

    # 2. Check exact key or number
    clean_key = q.replace("shader", "").replace("shdr", "").replace("-", "").strip()
    if clean_key.isdigit():
        num = int(clean_key)
        candidate = f"shdr-{num:02d}"
        if candidate in SHADERS:
            return candidate, SHADERS[candidate]

    # 3. Direct match in key
    for skey, meta in SHADERS.items():
        if skey == q:
            return skey, meta

    # 4. Keyword match in name
    for skey, meta in SHADERS.items():
        if meta["name"].lower() in q or q in meta["name"].lower():
            return skey, meta

    # 5. Fuzzy keyword match in words of note
    q_words = [w for w in q.split() if len(w) > 3 and w not in ["switch", "shader", "change", "please", "turn", "load", "the", "like", "make"]]
    for skey, meta in SHADERS.items():
        haystack = f"{meta['name']} {meta['note']}".lower()
        if any(w in haystack for w in q_words):
            return skey, meta

    return None

def set_shader_alias(alias: str, shader_id: str) -> bool:
    skey_tuple = resolve_shader(shader_id)
    if not skey_tuple:
        return False
    skey = skey_tuple[0]
    prefs = load_preferences()
    prefs.setdefault("aliases", {})[alias.strip()] = skey
    save_preferences(prefs)
    return True

def remove_shader_alias(alias: str) -> bool:
    prefs = load_preferences()
    aliases = prefs.get("aliases", {})
    if alias in aliases:
        del aliases[alias]
        prefs["aliases"] = aliases
        save_preferences(prefs)
        return True
    return False

def set_shader_favorite(shader_id: str, is_favorite: bool = True) -> bool:
    skey_tuple = resolve_shader(shader_id)
    if not skey_tuple:
        return False
    skey = skey_tuple[0]
    prefs = load_preferences()
    favs = set(prefs.get("favorites", []))
    if is_favorite:
        favs.add(skey)
    else:
        favs.discard(skey)
    prefs["favorites"] = sorted(list(favs))
    save_preferences(prefs)
    return True
