from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Form, Request, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import logging
import uuid
import asyncio
import random
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import crcmod.predefined
import pandas as pd
import requests
import httpx
from pypdf import PdfReader
from passlib.context import CryptContext
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
# Connection pool settings tuned for production (MongoDB Atlas)
client = AsyncIOMotorClient(
    mongo_url,
    maxPoolSize=50,
    minPoolSize=5,
    serverSelectionTimeoutMS=5000,
    connectTimeoutMS=5000,
)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Constants
PIX_KEY_CNPJ = "48223054000142"  # 48.223.054/0001-42 (digits only)
MERCHANT_NAME = "ROTA RAPIDA APP"  # PIX (no special chars, max 25)
MERCHANT_CITY = "SAO PAULO"
SUBSCRIPTION_PRICE = 20.00
SUBSCRIPTION_DAYS = 30

# Auth
SECRET_KEY = os.environ.get("JWT_SECRET", "fallback-dev-secret-not-for-prod")
ALGORITHM = os.environ.get("JWT_ALG", "HS256")
ACCESS_TOKEN_EXPIRE_DAYS = 30
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
WHATSAPP_NUMBER = os.environ.get("WHATSAPP_NUMBER", "5511983454007")
MAPBOX_ACCESS_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")
FAILED_ATTEMPTS_TO_TRIGGER_HONEYPOT = 3

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login", auto_error=False)
def _ip_key(request):
    """Use real client IP behind proxy for rate limiting."""
    try:
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
        xri = request.headers.get("x-real-ip", "")
        if xri:
            return xri.strip()
    except Exception:
        pass
    return get_remote_address(request)


limiter = Limiter(key_func=_ip_key)

# Code detection
# BR codes can end with an optional uppercase letter (e.g., BR263252632674A)
CODE_PATTERNS = [
    r"BR\d{11,15}[A-Z]?",
    r"[A-Z]{2}\d{9}[A-Z]{2}",
    r"MLB\d{10,14}[A-Z]?",
    r"ML-\d{6,12}",
    r"\d{14,18}",
    r"SEQ\d{3,5}",  # placeholder for Circuit rows where the Tracker column is empty
]


# =============== MODELS ===============
class Stop(BaseModel):
    id: int
    codigo: str
    endereco: str
    status: str = "pendente"
    timestamp: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    cliente: Optional[str] = None
    codigo_at: Optional[str] = None


class ParsedFileResponse(BaseModel):
    stops: List[Stop]
    total: int


class GeocodeRequest(BaseModel):
    address: str


class GeocodeResponse(BaseModel):
    lat: Optional[float]
    lon: Optional[float]
    display_name: Optional[str]
    found: bool


class OptimizeRequest(BaseModel):
    stops: List[Stop]
    start_lat: Optional[float] = None
    start_lon: Optional[float] = None
    return_to_start: bool = False
    minutes_per_stop: float = 3.0  # default: 20 packages/hour
    avg_speed_kmh: float = 30.0    # urban average


class RouteMetrics(BaseModel):
    total_distance_km: float
    estimated_minutes: float
    driving_minutes: float
    stops_minutes: float


class OptimizeResponse(BaseModel):
    stops: List[Stop]
    metrics: Optional[RouteMetrics] = None


class PixRequest(BaseModel):
    user_id: str
    customer_name: Optional[str] = None
    customer_contact: Optional[str] = None


class PixResponse(BaseModel):
    pix_string: str
    txid: str
    amount: float
    pix_key: str
    merchant_name: str
    whatsapp_number: str
    whatsapp_message: str


class SubmitPaymentRequest(BaseModel):
    user_id: str
    txid: str
    customer_name: Optional[str] = None
    customer_contact: Optional[str] = None


class SubscriptionStatus(BaseModel):
    active: bool
    pending: bool = False
    expires_at: Optional[str] = None
    days_remaining: int = 0


class ApproveRequest(BaseModel):
    txid: str


class HistoryEntry(BaseModel):
    user_id: str
    route_id: str
    started_at: str
    ended_at: Optional[str] = None
    total_stops: int
    delivered: int
    failed: int
    stops: List[dict] = []


# =============== UTILS ===============
STREET_PREFIX_RE = re.compile(
    r"\b(?:Rua|R\.?|Avenida|Av\.?|Travessa|Tv\.?|Alameda|Al\.?|"
    r"Praça|Praca|Pca\.?|Estrada|Estr\.?|Largo|Lgo\.?|Rodovia|Rod\.?|"
    r"Viaduto|Vd\.?|Marginal|Caminho|Beco)\s+(?-i:[A-ZÀ-Ý])",
    re.IGNORECASE,
)

# Common noise tokens to strip before geocoding
NOISE_PATTERNS = [
    r"AT[0-9A-Z]{10,14}",            # Circuit route codes (AT2026061969UZ6, AT202607036QXO9)
    r"\b\d{2}:\d{2}\b",              # timestamps like 13:23
    r"\b\d{10,11}\b",                # phone numbers
    r"\b(?:no fundo|casa|apto|apartamento|bloco|fundos|sala|loja)\s*\w*",
    r"–{1,}|-{2,}",                  # dash separators
    r"\bV\s+(?=Rua|Av|Travessa)",   # leading "V" before street
]


def _expand_address_abbrev(text: str) -> str:
    """Expand common Brazilian address abbreviations before geocoding.
    Uses word-boundary regexes so we don't mangle words like 'Trav' inside
    'Travessia' — the trailing '\b' plus a following space keeps replacements safe.
    """
    substitutions = [
        (r"\bAv\.?\s+", "Avenida "),
        (r"\bAvda\.?\s+", "Avenida "),
        (r"\bR\.?\s+", "Rua "),
        (r"\bRUA\s+", "Rua "),
        (r"\bAl\.?\s+", "Alameda "),
        (r"\bTrav\.?\s+", "Travessa "),
        (r"\bTv\.?\s+", "Travessa "),
        (r"\bPça\.?\s+", "Praça "),
        (r"\bPca\.?\s+", "Praça "),
        (r"\bDr\.?\s+", "Doutor "),
        (r"\bDra\.?\s+", "Doutora "),
        (r"\bProf\.?\s+", "Professor "),
        (r"\bProfa\.?\s+", "Professora "),
        (r"\bEng\.?\s+", "Engenheiro "),
        (r"\bCel\.?\s+", "Coronel "),
        (r"\bMal\.?\s+", "Marechal "),
        (r"\bJd\.?\s+", "Jardim "),
    ]
    for pat, repl in substitutions:
        text = re.sub(pat, repl, text, flags=re.IGNORECASE)
    return text


def clean_address(raw: str) -> str:
    """Clean noisy address text from Circuit-style PDFs.
    Strategy: the Circuit PDF row usually has the street name TWICE
    (once near the start, once near the end with neighborhood).
    The LAST occurrence is the canonical one with bairro/zona, so
    we slice from there to capture more useful context for Nominatim."""
    text = raw.strip()

    # Find ALL street-prefix occurrences and use the LAST one
    matches = list(STREET_PREFIX_RE.finditer(text))
    if matches:
        text = text[matches[-1].start():]

    # Remove known noise tokens
    for pat in NOISE_PATTERNS:
        text = re.sub(pat, " ", text, flags=re.IGNORECASE)

    # Normalize whitespace and punctuation
    text = re.sub(r"\s+", " ", text).strip(" ,.-;")

    # Expand abbreviations (R -> Rua, Av -> Avenida, ...) for better geocoding
    text = _expand_address_abbrev(text)

    # Truncate at clearly unrelated content
    if len(text) > 160:
        text = text[:160]

    # Ensure city context if missing
    if "são paulo" not in text.lower() and "sp" not in text.lower()[-12:]:
        text = text + ", São Paulo, SP"

    return text


# Regex to detect a decimal coordinate pair (lat, lon) anywhere in Brazilian bounds.
# Brazil: lat ∈ [-34, 5], lon ∈ [-74, -34]. Allow optional sign, common separators.
_COORD_PAIR_RE = re.compile(
    r"(-?[0-3]?\d(?:\.\d{4,10}))\s*[,;\s/]\s*(-[3-7]?\d(?:\.\d{4,10}))"
)
# Alt order: lon first, then lat (rare but happens in some CSVs).
_COORD_PAIR_ALT_RE = re.compile(
    r"(-[3-7]?\d(?:\.\d{4,10}))\s*[,;\s/]\s*(-?[0-3]?\d(?:\.\d{4,10}))"
)
_CEP_RE = re.compile(r"\b(\d{5})-?(\d{3})\b")


def _extract_coords_from_text(text: str) -> Optional[tuple]:
    """Scan text for a lat/lon pair inside Brazilian bounds. Return (lat, lon) or None."""
    for m in _COORD_PAIR_RE.finditer(text):
        try:
            lat = float(m.group(1))
            lon = float(m.group(2))
        except ValueError:
            continue
        if -34.0 <= lat <= 5.0 and -74.0 <= lon <= -34.0:
            return (lat, lon)
    # Try lon-first order too
    for m in _COORD_PAIR_ALT_RE.finditer(text):
        try:
            lon = float(m.group(1))
            lat = float(m.group(2))
        except ValueError:
            continue
        if -34.0 <= lat <= 5.0 and -74.0 <= lon <= -34.0:
            return (lat, lon)
    return None


def _extract_cep_from_text(text: str) -> Optional[str]:
    m = _CEP_RE.search(text)
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}"


# AT code (Shopee tracker): AT + 10-14 alphanumeric chars, e.g. AT202607036QXO9
_AT_CODE_RE = re.compile(r"\bAT[0-9A-Z]{10,14}\b")

# Customer name heuristic: 2-5 words either FULL uppercase (MILTON AMARAL PEREIRA)
# or Proper Case (Milton Amaral Pereira). Requires at least 2 words, each ≥3 chars.
# Filters out street prefixes and known noise tokens.
_NAME_STOP_WORDS = {
    "RUA", "AVENIDA", "AV", "AVDA", "ALAMEDA", "AL", "TRAVESSA", "TRAV",
    "PRACA", "PRAÇA", "PCA", "PÇA", "R", "ESTRADA", "EST", "RODOVIA", "ROD",
    "LARGO", "VIELA", "VILA", "JARDIM", "CONJUNTO", "SÃO", "SAO", "PAULO",
    "BAIRRO", "AP", "APTO", "APARTAMENTO", "SN", "SEM", "NUMERO", "NÚMERO",
    "CEP", "BRASIL", "BR", "COMPLEMENTO", "COMP", "BLOCO", "BL", "CASA",
    "FUNDOS", "TÉRREO", "TERREO", "LOJA", "GALPAO", "GALPÃO", "SP", "MG", "RJ",
    # Honorifics + abbreviations often embedded in street names (Prof., Dr., etc.)
    # These are frequently mistaken for the customer's first name.
    "PROF", "PROFA", "PROFESSOR", "PROFESSORA", "DR", "DRA", "DOUTOR", "DOUTORA",
    "PRF", "ENG", "ENGENHEIRO", "CEL", "CORONEL", "GEN", "GENERAL",
    "MAL", "MARECHAL", "MIN", "MINISTRO", "PADRE", "PE", "SÃOFRANCISCO",
    "IRMÃ", "IRMA", "FREI", "JD", "PQ", "PARQUE", "PRESIDENTE", "PRES",
    "GOV", "GOVERNADOR", "ARQ", "ARQUITETO",
}


def _extract_customer_and_at(block: str) -> tuple:
    """Extract (customer_name, at_code) from a Circuit-row block. Returns (None, None) if nothing found."""
    at_match = _AT_CODE_RE.search(block or "")
    at_code = at_match.group(0) if at_match else None

    if not block:
        return (None, at_code)

    # Split into candidate segments (semicolons / pipes / newlines are section separators
    # in Circuit exports). Then scan each segment for a full-name-looking token sequence.
    # If no clear segmentation is present (space-separated only), fall back to scanning
    # the ENTIRE block for uppercase/proper-case name patterns.
    segments = re.split(r"[;\|\n]+", block)
    if len(segments) < 2:
        # No obvious separators — also try scanning the whole block, plus segments
        # split by 2+ consecutive spaces (common in PDF column exports).
        segments = segments + re.split(r"\s{2,}", block)
        segments.append(block)
    best: Optional[str] = None
    for seg in segments:
        seg = seg.strip()
        if not seg or len(seg) < 6:
            continue
        # Try UPPERCASE-name regex first (most common in Circuit exports)
        m_iter = list(re.finditer(
            r"\b([A-ZÀ-Ý][A-ZÀ-Ý'\-]{2,}(?:\s+(?:DA|DE|DO|DOS|DAS|E)?\s*[A-ZÀ-Ý][A-ZÀ-Ý'\-]{2,}){1,4})\b",
            seg,
        ))
        # Then try proper-case names (Fulano de Tal)
        m_iter.extend(list(re.finditer(
            r"\b([A-ZÀ-Ý][a-zà-ý'\-]{2,}(?:\s+(?:da|de|do|dos|das|e)?\s*[A-ZÀ-Ý][a-zà-ý'\-]{2,}){1,4})\b",
            seg,
        )))
        for m in m_iter:
            candidate = m.group(1).strip()
            parts = candidate.split()
            # Reject candidates that CONTAIN a stop word (Rua/Av/Prf/Dr/etc.)
            if any(p.upper().rstrip(".,") in _NAME_STOP_WORDS for p in parts):
                continue
            # Reject candidates that appear as an ADDRESS COMPLEMENT right after
            # `<number>,` (e.g. `514, Ap 1106` or `200, Casa 2`). We look for
            # a comma immediately preceded by digits, followed by ≤3 chars of
            # whitespace before the match.
            span_start = m.start()
            context = seg[max(0, span_start - 10):span_start]
            if re.search(r"\d,\s{0,3}$", context):
                continue
            if best is None or len(candidate) > len(best):
                best = candidate

    return (best, at_code)


def extract_codes_and_addresses(text: str) -> List[dict]:
    """Extract stops preserving Circuit PDF order.

    Strategy:
    1. Detect Circuit-style "row starts": lines beginning with `<N>  <Capital>`.
       Circuit PDFs always have a row number before each address, but rows
       can wrap across multiple lines, so the tracking code may end up on a
       line that does NOT start with the row number. We therefore identify
       row starts first and treat the text between consecutive row starts as
       a single logical row.
    2. For each logical row, extract the first matching code + clean address.
    3. Sort by row number (always preserve PDF order).
    4. Fall back to the original per-line scan when no row-starts are found
       (non-Circuit files: pasted text, CSV-like, Shopee/ML lists, etc.).
    """
    seen_codes: set[str] = set()
    stops: List[dict] = []

    # --- Attempt Circuit row-based extraction first ---
    row_re = re.compile(r"(?m)^[\t ]*(\d{1,3})[\t ]+(?=[A-Za-zÀ-Ý])")
    row_matches = list(row_re.finditer(text))

    if len(row_matches) >= 3:
        for i, rm in enumerate(row_matches):
            start = rm.end()
            end = row_matches[i + 1].start() if i + 1 < len(row_matches) else len(text)
            try:
                row_num = int(rm.group(1))
            except ValueError:
                continue
            if row_num < 1 or row_num > 999:
                continue

            block = text[start:end]

            # Detect inline coordinates in the FULL row block (before we strip)
            coord_pair = _extract_coords_from_text(block)
            cep_val = _extract_cep_from_text(block)
            # Extract customer name + AT code from the FULL block (before stripping)
            cliente_val, at_code_val = _extract_customer_and_at(block)

            # Find first matching code inside this row block
            codigo = None
            for pattern in CODE_PATTERNS:
                m = re.search(pattern, block, re.IGNORECASE)
                if m:
                    candidate = m.group(0).upper()
                    if pattern == r"\d{14,18}" and (
                        candidate.startswith("0000") or len(candidate) < 14
                    ):
                        continue
                    codigo = candidate
                    break
            if not codigo or codigo in seen_codes:
                continue

            # Clean address: strip code, semicolons, then run normal cleaner
            raw = re.sub(re.escape(codigo), "", block, flags=re.IGNORECASE)
            # Remove the Circuit route header noise tokens early (broader AT match)
            raw = _AT_CODE_RE.sub(" ", raw)
            # Also strip the extracted customer name so it doesn't pollute the address
            if cliente_val:
                raw = re.sub(re.escape(cliente_val), " ", raw, flags=re.IGNORECASE)
            raw = re.sub(r"[;\t\|]+", " ", raw)
            raw = re.sub(r"\s+", " ", raw).strip(" ,.-;")
            cleaned = clean_address(raw)
            if len(cleaned) < 5:
                cleaned = "Endereço não detectado"

            seen_codes.add(codigo)
            stop_obj = {
                "id": 0,  # reassigned after sort
                "codigo": codigo,
                "endereco": cleaned,
                "status": "pendente",
                "timestamp": None,
                "lat": coord_pair[0] if coord_pair else None,
                "lon": coord_pair[1] if coord_pair else None,
                "cliente": cliente_val,
                "codigo_at": at_code_val,
                "_circuit_order": row_num,
            }
            if not coord_pair and cep_val:
                stop_obj["_cep"] = cep_val
            stops.append(stop_obj)

        if len(stops) >= 2:
            # Sort by row number (PDF order), reassign ids, drop internal fields
            stops.sort(key=lambda s: s["_circuit_order"])
            for i, s in enumerate(stops):
                s["id"] = i
                s.pop("_circuit_order", None)
            return stops

    # --- Fallback: original per-line scanner for non-Circuit text ---
    seen_codes.clear()
    stops = []
    counter = 0
    for line in text.split("\n"):
        line = line.strip()
        if len(line) < 5:
            continue
        codigo = None
        for pattern in CODE_PATTERNS:
            m = re.search(pattern, line, re.IGNORECASE)
            if m:
                candidate = m.group(0).upper()
                if pattern == r"\d{14,18}" and (
                    candidate.startswith("0000") or len(candidate) < 14
                ):
                    continue
                codigo = candidate
                break
        if not codigo or codigo in seen_codes:
            continue

        raw = re.sub(re.escape(codigo), "", line, flags=re.IGNORECASE)
        raw = re.sub(r"[;\t\|]+", " ", raw).strip(" ,;-\t")

        # Detect inline coords / CEP in the FULL original line (before stripping)
        coord_pair = _extract_coords_from_text(line)
        cep_val = _extract_cep_from_text(line)
        cliente_val, at_code_val = _extract_customer_and_at(line)

        row_match = re.match(r"^\s*(\d{1,3})\b\s+(?=[A-ZÀ-Ýa-zà-ý])", raw)
        circuit_order: Optional[int] = None
        if row_match:
            try:
                num = int(row_match.group(1))
                if 1 <= num <= 999:
                    circuit_order = num
                    raw = raw[row_match.end():]
            except ValueError:
                pass

        cleaned = clean_address(raw)
        if len(cleaned) < 5:
            cleaned = "Endereço não detectado"

        seen_codes.add(codigo)
        stop_obj = {
            "id": counter,
            "codigo": codigo,
            "endereco": cleaned,
            "status": "pendente",
            "timestamp": None,
            "lat": coord_pair[0] if coord_pair else None,
            "lon": coord_pair[1] if coord_pair else None,
            "cliente": cliente_val,
            "codigo_at": at_code_val,
            "_circuit_order": circuit_order,
        }
        if not coord_pair and cep_val:
            stop_obj["_cep"] = cep_val
        stops.append(stop_obj)
        counter += 1

    has_order = [s for s in stops if s.get("_circuit_order") is not None]
    if len(has_order) >= max(2, len(stops) // 2):
        stops.sort(key=lambda s: (s.get("_circuit_order") is None, s.get("_circuit_order") or 0))
        for i, s in enumerate(stops):
            s["id"] = i

    for s in stops:
        s.pop("_circuit_order", None)

    return stops


def parse_excel(content: bytes) -> str:
    try:
        df = pd.read_excel(io.BytesIO(content), header=None, sheet_name=0)
        lines = []
        for _, row in df.iterrows():
            cells = [str(c).strip() for c in row if pd.notna(c)]
            if cells:
                lines.append(" ".join(cells))
        return "\n".join(lines)
    except Exception as e:
        logging.error(f"Excel parse error: {e}")
        return ""


def parse_pdf(content: bytes) -> str:
    """Extract PDF text preserving the visual top-to-bottom reading order.

    Strategy for Circuit/Spoke PDFs:
    1. Try pdfplumber TABLE extraction. Circuit PDFs are organized as a
       4-column table (# | Address | Arrival | Notes). Table extraction is
       the most reliable way to preserve row numbers + address + code.
       We serialize each row as `<row#> <address> <code>` so the downstream
       cleaner picks the clean Address column and not the noisy Notes blob.
    2. Fall back to pdfplumber word-by-word reading order (sorted by Y/X).
    3. Final fallback: pypdf default extract_text.
    """
    try:
        import pdfplumber  # type: ignore
        lines_out: List[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                tables = []
                try:
                    tables = page.extract_tables() or []
                except Exception:
                    tables = []
                got_rows = False
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        first_cell = (row[0] or "").strip()
                        if not first_cell.isdigit():
                            continue
                        # Circuit format: row[0]=# row[1]=Address row[2]=Time row[3]=Notes
                        # Extract code from the Notes column (or any column as
                        # fallback) — Circuit puts BR/MLB tracking code there.
                        notes_blob = " ".join(
                            ((cell or "").replace("\n", " "))
                            for cell in row[3:]
                        )
                        if not notes_blob:
                            notes_blob = " ".join(
                                ((cell or "").replace("\n", " ")) for cell in row[1:]
                            )
                        code_match = None
                        for pattern in CODE_PATTERNS:
                            m = re.search(pattern, notes_blob, re.IGNORECASE)
                            if m:
                                cand = m.group(0).upper()
                                if pattern == r"\d{14,18}" and (
                                    cand.startswith("0000") or len(cand) < 14
                                ):
                                    continue
                                code_match = cand
                                break
                        # Address from column 1 (Circuit's "Address" column)
                        address = (row[1] or "").replace("\n", " ") if len(row) > 1 else ""
                        address = re.sub(r"\s+", " ", address).strip(" ,;.-")
                        if not code_match:
                            # Tracker missing in this row — still preserve the
                            # Circuit sequence by inserting a placeholder code
                            # derived from the row number. The frontend scanner
                            # falls back to "assign to next pending stop" when
                            # a scanned code does not match any tracker.
                            try:
                                code_match = f"SEQ{int(first_cell):04d}"
                            except ValueError:
                                code_match = f"SEQ{first_cell}"
                        if len(address) < 3:
                            address = "Endereço não detectado"
                        # Preserve notes column extras (customer name, CEP, phone)
                        # so downstream _extract_customer_and_at + CEP resolver
                        # can find them. Strip the tracking code we already
                        # extracted to avoid duplication.
                        notes_extra = notes_blob or ""
                        if code_match and not code_match.startswith("SEQ"):
                            notes_extra = re.sub(
                                re.escape(code_match), "", notes_extra, flags=re.IGNORECASE
                            )
                        notes_extra = re.sub(r"\s+", " ", notes_extra).strip(" ,;.-")
                        line_parts = [first_cell, address, code_match]
                        if notes_extra:
                            line_parts.append(notes_extra)
                        lines_out.append(" ".join(line_parts))
                        got_rows = True
                if got_rows:
                    lines_out.append("")
                    continue
                # No table on this page → fall back to coordinate-aware words
                try:
                    words = page.extract_words(x_tolerance=2, y_tolerance=3)
                except Exception:
                    words = []
                words.sort(key=lambda w: (round(w["top"]), w["x0"]))
                current_y: Optional[float] = None
                current_line: List[str] = []
                for w in words:
                    if current_y is None or abs(w["top"] - current_y) < 5:
                        current_line.append(w["text"])
                        if current_y is None:
                            current_y = w["top"]
                    else:
                        lines_out.append(" ".join(current_line))
                        current_line = [w["text"]]
                        current_y = w["top"]
                if current_line:
                    lines_out.append(" ".join(current_line))
                lines_out.append("")
        text = "\n".join(lines_out)
        if text.strip():
            return text
    except Exception as e:
        logging.warning(f"pdfplumber failed, falling back to pypdf: {e}")

    # Final fallback: pypdf
    try:
        reader = PdfReader(io.BytesIO(content))
        text = ""
        for page in reader.pages:
            text += page.extract_text() + "\n"
        return text
    except Exception as e:
        logging.error(f"PDF parse error: {e}")
        return ""


def parse_csv(content: bytes) -> str:
    try:
        return content.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def generate_pix_brcode(pix_key: str, amount: float, merchant_name: str, merchant_city: str, txid: str) -> str:
    def tlv(tag: str, value: str) -> str:
        return f"{tag}{len(value):02d}{value}"

    merchant_name = merchant_name[:25]
    merchant_city = merchant_city[:15]
    txid = re.sub(r"[^A-Za-z0-9]", "", txid)[:25] or "TXID"

    gui = tlv("00", "br.gov.bcb.pix")
    key = tlv("01", pix_key)
    merchant_account = tlv("26", gui + key)

    payload_parts = [
        tlv("00", "01"), tlv("01", "12"), merchant_account,
        tlv("52", "0000"), tlv("53", "986"), tlv("54", f"{amount:.2f}"),
        tlv("58", "BR"), tlv("59", merchant_name), tlv("60", merchant_city),
        tlv("62", tlv("05", txid)),
    ]
    payload = "".join(payload_parts) + "6304"
    crc16 = crcmod.predefined.Crc('crc-ccitt-false')
    crc16.update(payload.encode("utf-8"))
    return payload + crc16.hexdigest().upper()


async def geocode_google(address: str) -> Optional[dict]:
    """Primary geocoder: Google Maps Geocoding API.
    Uses region=br, components=country:BR, language=pt-BR for Brazilian bias.
    Accepts ONLY results with location_type in {ROOFTOP, RANGE_INTERPOLATED,
    GEOMETRIC_CENTER} — rejects APPROXIMATE (city/state-level) matches.
    """
    api_key = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()
    if not api_key:
        return None
    accepted_types = {"ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"}
    try:
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": address,
            "key": api_key,
            "region": "br",
            "components": "country:BR",
            "language": "pt-BR",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("status") != "OK" or not data.get("results"):
            return None
        for res in data["results"]:
            geom = res.get("geometry", {}) or {}
            loc_type = geom.get("location_type")
            if loc_type not in accepted_types:
                continue
            loc = geom.get("location", {}) or {}
            lat = loc.get("lat")
            lon = loc.get("lng")
            if lat is None or lon is None:
                continue
            return {
                "lat": float(lat),
                "lon": float(lon),
                "display_name": res.get("formatted_address", ""),
                "found": True,
                "provider": "google",
                "location_type": loc_type,
            }
        return None
    except Exception as e:
        logging.warning(f"Google geocode failed for '{address[:60]}…': {e}")
        return None


async def geocode_mapbox(address: str) -> Optional[dict]:
    """Primary geocoder: Mapbox v5. 100k free requests/month.
    Returns None if no token configured or if call fails — falls through to Nominatim/Photon."""
    if not MAPBOX_ACCESS_TOKEN:
        return None
    try:
        import urllib.parse
        encoded = urllib.parse.quote(address)
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{encoded}.json"
        # São Paulo metro bbox: minLon, minLat, maxLon, maxLat
        params = {
            "access_token": MAPBOX_ACCESS_TOKEN,
            "country": "br",
            "proximity": "-46.6333,-23.5505",
            "bbox": "-47.20,-24.00,-46.30,-23.30",  # São Paulo metro region
            "types": "address,place,locality,neighborhood",
            "limit": 1,
            "language": "pt",
        }
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: requests.get(url, params=params, timeout=8)
        )
        if resp.status_code in (429, 401, 403):
            return None
        if resp.status_code != 200:
            return None
        data = resp.json()
        feats = data.get("features", [])
        if not feats:
            return None
        f = feats[0]
        # Reject low-confidence Mapbox matches (< 0.75) — usually neighborhood-only
        # or POI matches that Google couldn't resolve either.
        relevance = f.get("relevance", 0)
        if relevance < 0.75:
            return None
        center = f.get("center", [])
        if len(center) < 2:
            return None
        # Verify the result is actually in/near São Paulo (under ~50km)
        lat, lon = float(center[1]), float(center[0])
        if abs(lat + 23.55) > 0.7 or abs(lon + 46.63) > 0.7:
            return None
        return {
            "lat": lat,
            "lon": lon,
            "display_name": f.get("place_name", ""),
            "found": True,
        }
    except Exception as e:
        logging.warning(f"Mapbox geocode failed for '{address[:60]}…': {e}")
        return None


# Nominatim/Photon: reject results at city/state/country level
_ADMIN_REJECT_TYPES = {
    "city", "state", "country", "county", "municipality",
    "administrative", "province", "region", "town", "village",
    "suburb", "neighbourhood",  # too coarse
}
_ADMIN_REJECT_CLASSES = {"boundary"}


def _is_admin_place_reject(entry: dict) -> bool:
    """Return True if a Nominatim/Photon feature is a coarse admin match
    (city/state/country/etc.) that we should NOT accept as a delivery address."""
    if not entry:
        return False
    klass = str(entry.get("class") or entry.get("osm_type") or "").lower()
    typ = str(entry.get("type") or "").lower()
    addr_type = str(entry.get("addresstype") or "").lower()
    if klass == "place" and typ in _ADMIN_REJECT_TYPES:
        return True
    if klass in _ADMIN_REJECT_CLASSES:
        return True
    if addr_type in _ADMIN_REJECT_TYPES:
        return True
    return False


async def geocode_photon(address: str) -> Optional[dict]:
    """Photon (komoot.io) — free OSM-based geocoder. Bias results to São Paulo."""
    try:
        url = "https://photon.komoot.io/api/"
        # Bias toward São Paulo, request 5 results to filter best match
        params = {"q": address, "limit": 5, "lat": -23.55, "lon": -46.63}
        headers = {"User-Agent": "RotaRapidaApp/1.0"}
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: requests.get(url, params=params, headers=headers, timeout=8)
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        feats = data.get("features", [])
        if not feats:
            return None

        # Prefer a feature in São Paulo state / city, in Brazil
        def score(f):
            props = f.get("properties", {})
            s = 0
            if props.get("countrycode") == "BR":
                s += 10
            if (props.get("state") or "").lower().startswith("são paulo"):
                s += 5
            if (props.get("city") or "").lower() == "são paulo":
                s += 5
            # Closer to SP center = better (rough)
            try:
                coords = f["geometry"]["coordinates"]
                dlat = abs(coords[1] + 23.55)
                dlon = abs(coords[0] + 46.63)
                s -= (dlat + dlon)  # smaller distance is better
            except Exception:
                pass
            return s

        # Filter out coarse admin-level results (city/state/country/etc.)
        feats = [f for f in feats if not _is_admin_place_reject(f.get("properties", {}))]
        if not feats:
            return None

        best = max(feats, key=score)
        coords = best["geometry"]["coordinates"]  # [lon, lat]
        props = best.get("properties", {})
        # Reject if too far from São Paulo (more than ~2 degrees ≈ 220km)
        if abs(coords[1] + 23.55) > 2 or abs(coords[0] + 46.63) > 2:
            return None
        name = ", ".join(filter(None, [
            props.get("name"), props.get("city") or props.get("state"), props.get("country"),
        ]))
        return {"lat": coords[1], "lon": coords[0], "display_name": name, "found": True}
    except Exception as e:
        logging.warning(f"Photon failed for '{address[:60]}…': {e}")
    return None


async def geocode_google_places(address: str) -> Optional[dict]:
    """Fallback: Google Places Text Search. Fuzzy — resolves abbreviated / partial
    addresses that geocode_google() rejects as APPROXIMATE. Biased around São Paulo.

    Prefers results whose `types` contains street_address, premise or route.
    """
    api_key = (os.environ.get("GOOGLE_MAPS_API_KEY") or "").strip()
    if not api_key:
        return None
    try:
        url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
        params = {
            "query": address,
            "key": api_key,
            "region": "br",
            "language": "pt-BR",
            "location": "-23.5505,-46.6333",
            "radius": 50000,
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url, params=params)
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("status") not in ("OK", "ZERO_RESULTS") or not data.get("results"):
            return None
        preferred_types = {"street_address", "premise", "route"}

        # Prefer a result whose types contain street_address/premise/route
        def pick():
            for res in data["results"]:
                types = set(res.get("types") or [])
                if types & preferred_types:
                    return res
            return data["results"][0]

        res = pick()
        loc = (res.get("geometry") or {}).get("location") or {}
        lat = loc.get("lat")
        lon = loc.get("lng")
        if lat is None or lon is None:
            return None
        return {
            "lat": float(lat),
            "lon": float(lon),
            "display_name": res.get("formatted_address") or res.get("name") or "",
            "found": True,
            "provider": "google_places",
            "place_types": res.get("types", []),
        }
    except Exception as e:
        logging.warning(f"Google Places geocode failed for '{address[:60]}…': {e}")
        return None


async def geocode_nominatim(address: str) -> dict:
    """Geocode pipeline: Google Geocoding → Google Places → Mapbox → Nominatim → Photon.

    Function name kept for backwards-compat with existing call sites.
    """
    # Attempt 0: Google Geocoding (strict ROOFTOP/RANGE/GEOMETRIC only)
    r = await geocode_google(address)
    if r:
        return r

    # Attempt 0.5: Google Places (fuzzy — great for abbreviated / partial addresses)
    r = await geocode_google_places(address)
    if r:
        return r

    # Attempt 1: Mapbox (relevance >= 0.75 enforced inside geocode_mapbox)
    r = await geocode_mapbox(address)
    if r:
        return r

    headers = {"User-Agent": "RotaRapidaApp/1.0 (delivery-app; contact@rotarapida.app)"}

    async def try_nominatim(query: str) -> Optional[dict]:
        try:
            url = "https://nominatim.openstreetmap.org/search"
            params = {
                "q": query,
                "format": "json",
                "limit": 3,
                "countrycodes": "br",
                "addressdetails": 1,
            }
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(
                None, lambda: requests.get(url, params=params, headers=headers, timeout=10)
            )
            if resp.status_code != 200:
                return None
            try:
                data = resp.json()
            except Exception:
                return None
            for entry in data or []:
                if _is_admin_place_reject(entry):
                    continue
                try:
                    return {
                        "lat": float(entry["lat"]),
                        "lon": float(entry["lon"]),
                        "display_name": entry.get("display_name", ""),
                        "found": True,
                        "provider": "nominatim",
                    }
                except (KeyError, ValueError, TypeError):
                    continue
        except Exception:
            return None
        return None

    # Attempt 1: Nominatim full address
    r = await try_nominatim(address)
    if r:
        return r

    # Attempt 2: Simplified Nominatim query (cut at first ", São Paulo")
    simplified = address
    sp_idx = simplified.lower().find("são paulo")
    if sp_idx > 10:
        simplified = simplified[:sp_idx].rstrip(", ") + ", São Paulo, SP"
    await asyncio.sleep(0.3)
    r = await try_nominatim(simplified)
    if r:
        return r

    # Attempt 3: Photon (more permissive fallback)
    r = await geocode_photon(address)
    if r:
        return r

    # Attempt 4: Photon with simplified query
    if simplified != address:
        r = await geocode_photon(simplified)
        if r:
            return r

    return {"lat": None, "lon": None, "display_name": None, "found": False}


# =============== AUTH ===============
def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(data: dict, honeypot: bool = False) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode["hp"] = honeypot
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


async def get_current_admin(token: Optional[str] = Depends(oauth2_scheme)) -> dict:
    if not token:
        raise HTTPException(401, "Token ausente")
    payload = decode_token(token)
    if not payload or payload.get("sub") != ADMIN_USERNAME:
        raise HTTPException(401, "Token inválido")
    # Returns dict with honeypot flag preserved
    return {"username": payload["sub"], "honeypot": bool(payload.get("hp", False))}


def get_real_ip(request: Request) -> str:
    """Get the real client IP behind K8s/proxy ingress.
    Trusts X-Forwarded-For (first IP in the comma-separated chain),
    falls back to X-Real-IP, then request.client.host."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("x-real-ip", "")
    if xri:
        return xri.strip()
    return request.client.host if request.client else "unknown"


async def log_audit(request: Request, username: str, success: bool, note: str = ""):
    try:
        ip = get_real_ip(request)
        ua = request.headers.get("user-agent", "Unknown")
        await db.audit_logs.insert_one({
            "username_attempted": username,
            "success": success,
            "ip": ip,
            "user_agent": ua,
            "note": note,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


async def count_failed_attempts(ip: str, minutes: int = 30) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    return await db.audit_logs.count_documents({
        "ip": ip,
        "success": False,
        "timestamp": {"$gte": cutoff},
    })


# =============== PUBLIC ROUTES ===============
@api_router.get("/")
async def root():
    return {"app": "Rota+Rápida App API", "version": "2.1.0"}


@api_router.get("/health")
async def health():
    """Lightweight health check for K8s liveness probe — no DB calls."""
    return {"status": "ok"}


@api_router.get("/cep/{cep}")
async def lookup_cep(cep: str):
    """Look up a Brazilian CEP via ViaCEP (free, no key)."""
    digits = re.sub(r"\D", "", cep)
    if len(digits) != 8:
        raise HTTPException(400, "CEP deve ter 8 dígitos")
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: requests.get(
                f"https://viacep.com.br/ws/{digits}/json/",
                timeout=6,
                headers={"User-Agent": "RotaRapidaApp/1.0"},
            ),
        )
        if resp.status_code != 200:
            raise HTTPException(404, "CEP não encontrado")
        data = resp.json()
        if data.get("erro"):
            raise HTTPException(404, "CEP não encontrado")
        # Build address string for geocoding
        parts = [
            data.get("logradouro", ""),
            data.get("bairro", ""),
            data.get("localidade", ""),
            data.get("uf", ""),
        ]
        addr = ", ".join(p for p in parts if p)
        # Try to geocode it to get exact lat/lon
        geo = await geocode_nominatim(addr) if addr else {"lat": None, "lon": None, "found": False}
        return {
            "cep": digits,
            "logradouro": data.get("logradouro"),
            "bairro": data.get("bairro"),
            "cidade": data.get("localidade"),
            "uf": data.get("uf"),
            "address": addr,
            "lat": geo.get("lat"),
            "lon": geo.get("lon"),
            "found": bool(geo.get("found")),
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"CEP lookup error: {e}")
        raise HTTPException(500, "Erro ao consultar CEP")


async def _resolve_cep_to_latlon(cep: str) -> Optional[tuple]:
    """Resolve a Brazilian CEP to (lat, lon) via ViaCEP + geocoder pipeline.
    Returns None on any failure."""
    digits = re.sub(r"\D", "", cep or "")
    if len(digits) != 8:
        return None
    try:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: requests.get(
                f"https://viacep.com.br/ws/{digits}/json/",
                timeout=6,
                headers={"User-Agent": "RotaRapidaApp/1.0"},
            ),
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("erro"):
            return None
        addr_parts = [
            data.get("logradouro"),
            data.get("bairro"),
            data.get("localidade"),
            data.get("uf"),
        ]
        addr = ", ".join(p for p in addr_parts if p)
        if not addr:
            return None
        geo = await geocode_nominatim(addr)
        if geo and geo.get("found") and geo.get("lat") is not None and geo.get("lon") is not None:
            return (float(geo["lat"]), float(geo["lon"]))
    except Exception as e:
        logging.warning(f"CEP resolve failed for {cep}: {e}")
    return None


@api_router.post("/parse-file", response_model=ParsedFileResponse)
async def parse_file(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()
    if filename.endswith((".xlsx", ".xls")):
        text = parse_excel(content)
    elif filename.endswith(".pdf"):
        text = parse_pdf(content)
    else:
        text = parse_csv(content)
    raw_stops = extract_codes_and_addresses(text)

    # For stops WITHOUT coords BUT with a detected CEP, resolve CEP → lat/lon.
    # This runs concurrently but is capped to a small pool to be gentle on ViaCEP.
    cep_tasks = []
    cep_indices = []
    for i, s in enumerate(raw_stops):
        if (s.get("lat") is None or s.get("lon") is None) and s.get("_cep"):
            cep_tasks.append(_resolve_cep_to_latlon(s["_cep"]))
            cep_indices.append(i)
    if cep_tasks:
        results = await asyncio.gather(*cep_tasks, return_exceptions=True)
        for idx, r in zip(cep_indices, results):
            if isinstance(r, tuple):
                raw_stops[idx]["lat"] = r[0]
                raw_stops[idx]["lon"] = r[1]
    # Strip internal fields (Pydantic ignores them, but be tidy)
    for s in raw_stops:
        s.pop("_cep", None)

    stops = [Stop(**s) for s in raw_stops]
    return ParsedFileResponse(stops=stops, total=len(stops))


@api_router.post("/parse-text", response_model=ParsedFileResponse)
async def parse_text(payload: dict):
    text = payload.get("text", "")
    raw_stops = extract_codes_and_addresses(text)
    # Resolve CEP fallbacks (same logic as parse_file)
    cep_tasks = []
    cep_indices = []
    for i, s in enumerate(raw_stops):
        if (s.get("lat") is None or s.get("lon") is None) and s.get("_cep"):
            cep_tasks.append(_resolve_cep_to_latlon(s["_cep"]))
            cep_indices.append(i)
    if cep_tasks:
        results = await asyncio.gather(*cep_tasks, return_exceptions=True)
        for idx, r in zip(cep_indices, results):
            if isinstance(r, tuple):
                raw_stops[idx]["lat"] = r[0]
                raw_stops[idx]["lon"] = r[1]
    for s in raw_stops:
        s.pop("_cep", None)
    stops = [Stop(**s) for s in raw_stops]
    return ParsedFileResponse(stops=stops, total=len(stops))


@api_router.post("/geocode", response_model=GeocodeResponse)
async def geocode(req: GeocodeRequest):
    result = await geocode_nominatim(req.address)
    return GeocodeResponse(**result)


@api_router.post("/geocode-batch")
async def geocode_batch(payload: dict):
    """Geocode multiple addresses with moderate concurrency + caching.
    Google supports much higher concurrency than Nominatim, so we bump the
    Semaphore to 5 and lower the polite-pause between calls to 100ms.
    """
    addresses: List[str] = payload.get("addresses", [])
    semaphore = asyncio.Semaphore(5)  # Google-tier concurrency
    cache: dict = {}

    async def bounded(addr: str):
        if addr in cache:
            return cache[addr]
        async with semaphore:
            r = await geocode_nominatim(addr)
            cache[addr] = r
            # Brief pause between calls to be polite (Google-tier)
            await asyncio.sleep(0.1)
            return r

    results = await asyncio.gather(*[bounded(a) for a in addresses])
    return {"results": results}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two points on Earth in km."""
    import math
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@api_router.post("/optimize", response_model=OptimizeResponse)
async def optimize_route(req: OptimizeRequest):
    pending = [s for s in req.stops if s.status == "pendente" and s.lat is not None and s.lon is not None]
    done = [s for s in req.stops if s.status != "pendente"]

    if len(pending) == 0:
        return OptimizeResponse(stops=req.stops)

    # Start point: provided origin OR first pending stop
    if req.start_lat is not None and req.start_lon is not None:
        start = (req.start_lat, req.start_lon)
        origin_for_google = start
    else:
        start = (pending[0].lat, pending[0].lon)
        origin_for_google = None  # let Google use first stop as origin

    optimized: List[Stop] = []
    used_solver = "nearest_neighbor"
    total_dist_m = 0
    total_dur_s = 0

    # ---- SOLVER 1: OR-Tools (Circuit-grade quality for any number of stops) ----
    # Use OR-Tools whenever we have > 3 pending stops. It handles up to hundreds
    # of stops with near-optimal quality (guided local search) and blows the
    # nearest-neighbor / 25-waypoint-Google-limit out of the water.
    if len(pending) >= 3:
        try:
            from ortools_optimizer import optimize_with_ortools
            or_result = await optimize_with_ortools(
                pending,
                start_lat=req.start_lat,
                start_lon=req.start_lon,
                return_to_start=req.return_to_start,
                use_google_matrix=False,  # Haversine × 1.3 — free, fast, 95%+ optimal in urban BR
            )
        except Exception as e:
            logger.warning(f"OR-Tools optimize failed: {e}")
            or_result = None

        if or_result and or_result.get("order"):
            order_indices = or_result["order"]
            optimized = [pending[i] for i in order_indices]
            used_solver = f"ortools_{or_result.get('used_matrix', 'haversine')}"
            total_dist_m = or_result.get("distance_m", 0)
            total_dur_s = or_result.get("duration_s", 0)

    # ---- SOLVER 2: Google Directions optimize (only for ≤25 stops; leaves ≥26+ to fallback) ----
    if not optimized and len(pending) <= 25:
        try:
            from optimize_routes import reorder_with_google
            google_result = await reorder_with_google(pending, origin=origin_for_google)
        except Exception as e:
            logger.warning(f"google optimize import/call failed: {e}")
            google_result = None

        if google_result and google_result.get("order"):
            order_indices = google_result["order"]
            optimized = [pending[i] for i in order_indices]
            used_solver = "google_directions"
            total_dist_m = google_result.get("distance_m", 0)
            total_dur_s = google_result.get("duration_s", 0)

    # ---- SOLVER 3: Nearest-neighbor fallback (last resort) ----
    if not optimized:
        if req.start_lat is not None and req.start_lon is not None:
            remaining = list(pending)
        else:
            optimized = [pending[0]]
            remaining = pending[1:]

        while remaining:
            last_lat, last_lon = (optimized[-1].lat, optimized[-1].lon) if optimized else start
            nearest_idx = 0
            min_d = float("inf")
            for i, s in enumerate(remaining):
                d = haversine_km(last_lat, last_lon, s.lat, s.lon)
                if d < min_d:
                    min_d = d
                    nearest_idx = i
            optimized.append(remaining.pop(nearest_idx))

    # Compute metrics
    if total_dist_m > 0:
        total_km = total_dist_m / 1000.0
        driving_min = total_dur_s / 60.0
    else:
        total_km = 0.0
        prev = start
        for s in optimized:
            total_km += haversine_km(prev[0], prev[1], s.lat, s.lon)
            prev = (s.lat, s.lon)
        if req.return_to_start:
            total_km += haversine_km(prev[0], prev[1], start[0], start[1])
        total_km *= 1.3
        driving_min = (total_km / max(req.avg_speed_kmh, 1.0)) * 60.0

    stops_min = len(optimized) * req.minutes_per_stop
    total_min = driving_min + stops_min

    final = done + optimized
    for idx, s in enumerate(final):
        s.id = idx

    logger.info(f"optimize: {len(pending)} stops via {used_solver} → {total_km:.1f} km")
    metrics = RouteMetrics(
        total_distance_km=round(total_km, 2),
        estimated_minutes=round(total_min, 1),
        driving_minutes=round(driving_min, 1),
        stops_minutes=round(stops_min, 1),
    )
    return OptimizeResponse(stops=final, metrics=metrics)


@api_router.post("/route-metrics", response_model=RouteMetrics)
async def compute_metrics(req: OptimizeRequest):
    """Compute metrics for current order without reordering."""
    pending = [s for s in req.stops if s.status == "pendente" and s.lat is not None and s.lon is not None]
    if len(pending) == 0:
        return RouteMetrics(total_distance_km=0, estimated_minutes=0, driving_minutes=0, stops_minutes=0)

    start = (req.start_lat, req.start_lon) if req.start_lat is not None else (pending[0].lat, pending[0].lon)
    total_km = 0.0
    prev = start
    for s in pending:
        total_km += haversine_km(prev[0], prev[1], s.lat, s.lon)
        prev = (s.lat, s.lon)
    if req.return_to_start:
        total_km += haversine_km(prev[0], prev[1], start[0], start[1])

    total_km *= 1.3
    driving_min = (total_km / max(req.avg_speed_kmh, 1.0)) * 60.0
    stops_min = len(pending) * req.minutes_per_stop
    return RouteMetrics(
        total_distance_km=round(total_km, 2),
        estimated_minutes=round(driving_min + stops_min, 1),
        driving_minutes=round(driving_min, 1),
        stops_minutes=round(stops_min, 1),
    )


# =============== PIX FLOW ===============
@api_router.post("/pix/generate", response_model=PixResponse)
async def generate_pix(req: PixRequest):
    txid = f"RF{uuid.uuid4().hex[:18].upper()}"
    pix_string = generate_pix_brcode(
        pix_key=PIX_KEY_CNPJ, amount=SUBSCRIPTION_PRICE,
        merchant_name=MERCHANT_NAME, merchant_city=MERCHANT_CITY, txid=txid,
    )
    await db.pix_transactions.insert_one({
        "txid": txid,
        "user_id": req.user_id,
        "amount": SUBSCRIPTION_PRICE,
        "status": "awaiting_payment",
        "customer_name": req.customer_name,
        "customer_contact": req.customer_contact,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # WhatsApp pre-filled message — includes user_id so admin can match in panel
    msg = (
        f"Olá! Acabei de pagar a assinatura do Rota+Rápida App 🚀%0A"
        f"%0A💰 Valor: R$ {SUBSCRIPTION_PRICE:.2f}"
        f"%0A🔑 Login (ID): {req.user_id}"
        f"%0A🧾 TXID: {txid}"
        f"%0A%0A👉 Segue meu comprovante anexado:"
    )

    return PixResponse(
        pix_string=pix_string, txid=txid, amount=SUBSCRIPTION_PRICE,
        pix_key="48.223.054/0001-42", merchant_name=MERCHANT_NAME,
        whatsapp_number=WHATSAPP_NUMBER, whatsapp_message=msg,
    )


@api_router.post("/pix/submit-payment")
async def submit_payment(req: SubmitPaymentRequest):
    """User confirms they paid. Status → pending_approval (admin must approve)."""
    tx = await db.pix_transactions.find_one({"txid": req.txid}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Transação não encontrada")

    update = {
        "status": "pending_approval",
        "user_submitted_at": datetime.now(timezone.utc).isoformat(),
    }
    if req.customer_name:
        update["customer_name"] = req.customer_name
    if req.customer_contact:
        update["customer_contact"] = req.customer_contact

    await db.pix_transactions.update_one({"txid": req.txid}, {"$set": update})
    return {"ok": True, "status": "pending_approval"}


@api_router.get("/subscription/{user_id}", response_model=SubscriptionStatus)
async def get_subscription(user_id: str):
    sub = await db.subscriptions.find_one({"user_id": user_id}, {"_id": 0})

    pending = await db.pix_transactions.find_one(
        {"user_id": user_id, "status": "pending_approval"},
        {"_id": 0},
        sort=[("user_submitted_at", -1)],
    )

    if not sub:
        return SubscriptionStatus(active=False, pending=bool(pending))

    expires_at_str = sub.get("expires_at")
    if not expires_at_str:
        return SubscriptionStatus(active=False, pending=bool(pending))

    expires_at = datetime.fromisoformat(expires_at_str)
    now = datetime.now(timezone.utc)
    if expires_at < now:
        return SubscriptionStatus(active=False, pending=bool(pending), expires_at=expires_at_str)

    days = (expires_at - now).days
    return SubscriptionStatus(active=True, pending=False, expires_at=expires_at_str, days_remaining=days)


# =============== HISTORY ===============
@api_router.post("/history/save")
async def save_history(entry: HistoryEntry):
    """Save a completed route for history/analytics."""
    doc = entry.model_dump()
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.route_history.insert_one(doc)
    return {"ok": True, "route_id": entry.route_id}


@api_router.get("/history/{user_id}")
async def get_history(user_id: str, limit: int = 30):
    cursor = db.route_history.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return {"routes": docs}


@api_router.get("/stats/{user_id}")
async def get_stats(user_id: str):
    """Aggregate stats for the user."""
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()

    # Fetch week / month routes with DB-level filtering (bounded)
    week_routes = await db.route_history.find(
        {"user_id": user_id, "created_at": {"$gte": week_ago}},
        {"_id": 0},
    ).to_list(length=200)

    month_routes = await db.route_history.find(
        {"user_id": user_id, "created_at": {"$gte": month_ago}},
        {"_id": 0},
    ).to_list(length=500)

    # All-time: aggregate at DB level instead of loading all docs
    all_time_agg = await db.route_history.aggregate([
        {"$match": {"user_id": user_id}},
        {"$group": {
            "_id": None,
            "routes": {"$sum": 1},
            "total_stops": {"$sum": "$total_stops"},
            "delivered": {"$sum": "$delivered"},
            "failed": {"$sum": "$failed"},
        }},
    ]).to_list(length=1)

    def aggregate(routes):
        total_stops = sum(r.get("total_stops", 0) for r in routes)
        delivered = sum(r.get("delivered", 0) for r in routes)
        failed = sum(r.get("failed", 0) for r in routes)
        success_rate = (delivered / total_stops * 100) if total_stops else 0
        return {
            "routes": len(routes),
            "total_stops": total_stops,
            "delivered": delivered,
            "failed": failed,
            "success_rate": round(success_rate, 1),
        }

    if all_time_agg:
        a = all_time_agg[0]
        total_stops = a.get("total_stops", 0)
        delivered_total = a.get("delivered", 0)
        all_time = {
            "routes": a.get("routes", 0),
            "total_stops": total_stops,
            "delivered": delivered_total,
            "failed": a.get("failed", 0),
            "success_rate": round((delivered_total / total_stops * 100) if total_stops else 0, 1),
        }
    else:
        all_time = {"routes": 0, "total_stops": 0, "delivered": 0, "failed": 0, "success_rate": 0}

    # Best day (single doc) — query DB sorted by delivered desc
    best_doc = await db.route_history.find_one(
        {"user_id": user_id},
        {"_id": 0, "delivered": 1, "created_at": 1},
        sort=[("delivered", -1)],
    )
    best_day = None
    if best_doc:
        best_day = {
            "date": (best_doc.get("created_at") or "")[:10],
            "delivered": best_doc.get("delivered", 0),
        }

    # Badge based on weekly delivered
    week_delivered = sum(r.get("delivered", 0) for r in week_routes)
    badge = "🌱 Novato"
    if week_delivered >= 200:
        badge = "🏆 Campeão da semana"
    elif week_delivered >= 100:
        badge = "🚀 Acelerado"
    elif week_delivered >= 50:
        badge = "⚡ Em ritmo"
    elif week_delivered >= 10:
        badge = "🔥 Aquecendo"

    return {
        "week": aggregate(week_routes),
        "month": aggregate(month_routes),
        "all_time": all_time,
        "best_day": best_day,
        "badge": badge,
    }


# =============== ADMIN AUTH + HONEYPOT ===============
@api_router.post("/admin/login")
@limiter.limit("5/10minute")
async def admin_login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    ip = get_real_ip(request)
    # Russian-doll honeypot trigger: too many prior fails
    prior_fails = await count_failed_attempts(ip, minutes=60)

    if form.username == ADMIN_USERNAME and ADMIN_PASSWORD_HASH and verify_password(form.password, ADMIN_PASSWORD_HASH):
        await log_audit(request, form.username, True)
        token = create_access_token({"sub": ADMIN_USERNAME}, honeypot=False)
        return {"access_token": token, "token_type": "bearer", "is_admin": True}

    # Failed
    await log_audit(request, form.username, False, note=f"prior_fails={prior_fails}")

    if prior_fails + 1 >= FAILED_ATTEMPTS_TO_TRIGGER_HONEYPOT:
        # Drop the attacker into the matryoshka 🪆 — issue a honeypot JWT
        # so subsequent admin calls receive fake data
        token = create_access_token({"sub": ADMIN_USERNAME, "level": 1}, honeypot=True)
        # Random delay to waste their time
        await asyncio.sleep(random.uniform(0.8, 1.8))
        return {"access_token": token, "token_type": "bearer", "is_admin": True}

    raise HTTPException(401, "Credenciais inválidas")


def _fake_pending(level: int):
    """Generate fake pending payments for honeypot."""
    items = []
    seed = level * 7919
    rnd = random.Random(seed)
    for i in range(rnd.randint(2, 6)):
        items.append({
            "txid": f"FAKE{seed}{i:04d}",
            "user_id": f"user_{seed}_{i}",
            "amount": 20.00,
            "customer_name": rnd.choice([
                "João Silva", "Maria Santos", "Pedro Almeida", "Ana Pereira",
                "Carlos Souza", "Lucia Ferreira", "Bruno Costa", "Renata Lima"
            ]),
            "customer_contact": f"+55 11 9{rnd.randint(1000,9999)}-{rnd.randint(1000,9999)}",
            "created_at": (datetime.now(timezone.utc) - timedelta(hours=rnd.randint(1, 48))).isoformat(),
            "status": "pending_approval",
        })
    return items


@api_router.get("/admin/pending-payments")
async def list_pending_payments(admin: dict = Depends(get_current_admin)):
    if admin["honeypot"]:
        # Russian doll level
        await asyncio.sleep(random.uniform(0.3, 1.0))
        return {
            "items": _fake_pending(1),
            "_decoy_hint": "Camada 1 desbloqueada. Tente /api/admin/level/2 para mais.",
        }
    cursor = db.pix_transactions.find(
        {"status": "pending_approval"}, {"_id": 0}
    ).sort("user_submitted_at", -1).limit(100)
    items = await cursor.to_list(length=100)
    return {"items": items}


@api_router.get("/admin/level/{n}")
async def matryoshka_level(n: int, request: Request, admin: dict = Depends(get_current_admin)):
    """Russian-doll recursive levels. Real admins never reach here.
    Honeypot users keep digging forever."""
    if not admin["honeypot"]:
        raise HTTPException(404, "Not found")
    await asyncio.sleep(random.uniform(0.4, 1.6))
    next_level = n + 1
    return {
        "level": n,
        "items": _fake_pending(n),
        "secret_note": f"Excelente, você chegou ao nível {n}. Há ainda mais.",
        "next_level_url": f"/api/admin/level/{next_level}",
        "hash_token": hashlib.sha256(f"matryoshka-{n}".encode()).hexdigest(),
    }


@api_router.post("/admin/approve-payment")
async def approve_payment(req: ApproveRequest, admin: dict = Depends(get_current_admin)):
    if admin["honeypot"]:
        await asyncio.sleep(random.uniform(0.5, 1.2))
        return {"ok": True, "_hint": "Pagamento aprovado. (camada 2 disponível)"}

    tx = await db.pix_transactions.find_one({"txid": req.txid}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Transação não encontrada")

    expires_at = datetime.now(timezone.utc) + timedelta(days=SUBSCRIPTION_DAYS)
    await db.pix_transactions.update_one(
        {"txid": req.txid},
        {"$set": {
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await db.subscriptions.update_one(
        {"user_id": tx["user_id"]},
        {"$set": {
            "user_id": tx["user_id"],
            "active": True,
            "expires_at": expires_at.isoformat(),
            "last_txid": req.txid,
        }},
        upsert=True,
    )
    return {"ok": True, "expires_at": expires_at.isoformat()}


@api_router.post("/admin/reject-payment")
async def reject_payment(req: ApproveRequest, admin: dict = Depends(get_current_admin)):
    if admin["honeypot"]:
        await asyncio.sleep(random.uniform(0.3, 0.9))
        return {"ok": True, "_hint": "Rejeitado. (próximo: camada 3)"}
    await db.pix_transactions.update_one(
        {"txid": req.txid},
        {"$set": {
            "status": "rejected",
            "rejected_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    return {"ok": True}


@api_router.get("/admin/stats")
async def admin_stats(admin: dict = Depends(get_current_admin)):
    if admin["honeypot"]:
        await asyncio.sleep(random.uniform(0.3, 1.0))
        rnd = random.Random()
        return {
            "active_subs": rnd.randint(800, 9999),
            "pending": rnd.randint(5, 80),
            "revenue_month": rnd.randint(20000, 99999),
            "_decoy": "dados em tempo real (camada 1)",
        }
    active = await db.subscriptions.count_documents({"active": True})
    pending = await db.pix_transactions.count_documents({"status": "pending_approval"})
    approved_month = await db.pix_transactions.count_documents({
        "status": "approved",
        "approved_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()},
    })
    return {
        "active_subs": active,
        "pending": pending,
        "revenue_month": approved_month * SUBSCRIPTION_PRICE,
    }


# =============== AUTH (Google + Trial + Device Fingerprint) ===============
from auth_routes import register_auth_routes  # noqa: E402
register_auth_routes(api_router, db)

# =============== ROUTE OPTIMIZATION (Google Directions) ===============
from optimize_routes import register_optimize_routes  # noqa: E402
register_optimize_routes(api_router)


# =============== MOUNT ===============
app.include_router(api_router)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=429,
        content={"detail": "Muitas tentativas. Aguarde alguns minutos."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    """Create DB indexes for query performance."""
    try:
        await db.route_history.create_index([("user_id", 1), ("created_at", -1)])
        await db.pix_transactions.create_index([("status", 1), ("user_submitted_at", -1)])
        await db.pix_transactions.create_index([("user_id", 1)])
        await db.subscriptions.create_index([("user_id", 1)], unique=True)
        await db.audit_logs.create_index([("ip", 1), ("timestamp", -1)])
        # Auth (Google + Trial + Device Fingerprint)
        await db.users.create_index([("email", 1)], unique=True)
        await db.users.create_index([("user_id", 1)], unique=True)
        await db.users.create_index([("device_fingerprint", 1)])
        await db.user_sessions.create_index([("session_token", 1)], unique=True)
        await db.user_sessions.create_index([("user_id", 1)])
        await db.user_sessions.create_index([("expires_at", 1)], expireAfterSeconds=0)
    except Exception as e:
        logging.warning(f"Index creation skipped: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
