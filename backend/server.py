from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import io
import logging
import uuid
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import crcmod.predefined
import pandas as pd
import requests
from pypdf import PdfReader

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Constants
PIX_KEY_CNPJ = "48223054000142"  # 48.223.054/0001-42 (digits only)
MERCHANT_NAME = "ROTA FACIL"
MERCHANT_CITY = "SAO PAULO"
SUBSCRIPTION_PRICE = 20.00
SUBSCRIPTION_DAYS = 30

# Regex patterns for delivery codes
CODE_PATTERNS = [
    r"BR\d{11,15}",            # Shopee/Correios BR codes
    r"[A-Z]{2}\d{9}[A-Z]{2}",  # Correios international (e.g., LZ123456789BR)
    r"MLB\d{10,14}",           # Mercado Livre MLB
    r"ML-\d{6,12}",            # Mercado Livre alt
    r"\d{14,18}",              # Numeric tracking
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


class OptimizeResponse(BaseModel):
    stops: List[Stop]


class PixRequest(BaseModel):
    user_id: str


class PixResponse(BaseModel):
    pix_string: str
    txid: str
    amount: float
    pix_key: str
    merchant_name: str


class ConfirmPaymentRequest(BaseModel):
    user_id: str
    txid: str


class SubscriptionStatus(BaseModel):
    active: bool
    expires_at: Optional[str] = None
    days_remaining: int = 0


# =============== UTILS ===============
def extract_codes_and_addresses(text: str) -> List[dict]:
    """Extract delivery codes and addresses from raw text"""
    lines = text.split("\n")
    stops = []
    seen_codes = set()
    counter = 0

    for line in lines:
        line = line.strip()
        if len(line) < 5:
            continue

        # Try patterns one by one
        codigo = None
        for pattern in CODE_PATTERNS:
            m = re.search(pattern, line, re.IGNORECASE)
            if m:
                candidate = m.group(0).upper()
                # Avoid generic 14-digit if too short  / dates etc
                if pattern == r"\d{14,18}" and (candidate.startswith("0000") or len(candidate) < 14):
                    continue
                codigo = candidate
                break

        if not codigo or codigo in seen_codes:
            continue

        # Address = remainder of line
        endereco = re.sub(re.escape(codigo), "", line, flags=re.IGNORECASE)
        endereco = re.sub(r"[;\t\|]+", " ", endereco).strip(" ,;-\t")
        if len(endereco) < 5:
            endereco = "Endereço não detectado"

        seen_codes.add(codigo)
        stops.append({
            "id": counter,
            "codigo": codigo,
            "endereco": endereco,
            "status": "pendente",
            "timestamp": None,
            "lat": None,
            "lon": None,
        })
        counter += 1

    return stops


def parse_excel(content: bytes) -> str:
    """Convert excel file to text"""
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
        text = content.decode("utf-8", errors="ignore")
        return text
    except Exception:
        return ""


def generate_pix_brcode(pix_key: str, amount: float, merchant_name: str, merchant_city: str, txid: str) -> str:
    """Generate PIX BR Code (Copia e Cola) following EMVCo / BACEN spec"""
    def tlv(tag: str, value: str) -> str:
        return f"{tag}{len(value):02d}{value}"

    # Truncate merchant name/city per spec
    merchant_name = merchant_name[:25]
    merchant_city = merchant_city[:15]
    txid = re.sub(r"[^A-Za-z0-9]", "", txid)[:25] or "TXID"

    gui = tlv("00", "br.gov.bcb.pix")
    key = tlv("01", pix_key)
    merchant_account = tlv("26", gui + key)

    payload_parts = [
        tlv("00", "01"),               # Payload format
        tlv("01", "12"),               # Point of init - 12 = single use
        merchant_account,
        tlv("52", "0000"),             # MCC
        tlv("53", "986"),              # Currency BRL
        tlv("54", f"{amount:.2f}"),    # Amount
        tlv("58", "BR"),               # Country
        tlv("59", merchant_name),
        tlv("60", merchant_city),
        tlv("62", tlv("05", txid)),    # Additional Data - txid
    ]
    payload = "".join(payload_parts) + "6304"
    crc16 = crcmod.predefined.Crc('crc-ccitt-false')
    crc16.update(payload.encode("utf-8"))
    return payload + crc16.hexdigest().upper()


async def geocode_nominatim(address: str) -> dict:
    """Geocode address using OpenStreetMap Nominatim (free, no key)"""
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "q": address + ", Brasil",
            "format": "json",
            "limit": 1,
            "countrycodes": "br",
        }
        headers = {"User-Agent": "RotaFacil/1.0 (delivery-app)"}

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: requests.get(url, params=params, headers=headers, timeout=8)
        )
        data = resp.json()
        if data and len(data) > 0:
            return {
                "lat": float(data[0]["lat"]),
                "lon": float(data[0]["lon"]),
                "display_name": data[0].get("display_name", ""),
                "found": True,
            }
    except Exception as e:
        logging.error(f"Geocode error for '{address}': {e}")
    return {"lat": None, "lon": None, "display_name": None, "found": False}


# =============== ROUTES ===============
@api_router.get("/")
async def root():
    return {"app": "Rota Fácil API", "version": "1.0.0"}


@api_router.post("/parse-file", response_model=ParsedFileResponse)
async def parse_file(file: UploadFile = File(...)):
    """Parse uploaded file (xlsx, xls, csv, txt, pdf) into list of stops"""
    content = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith((".xlsx", ".xls")):
        text = parse_excel(content)
    elif filename.endswith(".pdf"):
        text = parse_pdf(content)
    else:
        text = parse_csv(content)

    raw_stops = extract_codes_and_addresses(text)
    stops = [Stop(**s) for s in raw_stops]
    return ParsedFileResponse(stops=stops, total=len(stops))


@api_router.post("/parse-text", response_model=ParsedFileResponse)
async def parse_text(payload: dict):
    """Parse free-form text into stops (for manual paste input)"""
    text = payload.get("text", "")
    raw_stops = extract_codes_and_addresses(text)
    stops = [Stop(**s) for s in raw_stops]
    return ParsedFileResponse(stops=stops, total=len(stops))


@api_router.post("/geocode", response_model=GeocodeResponse)
async def geocode(req: GeocodeRequest):
    result = await geocode_nominatim(req.address)
    return GeocodeResponse(**result)


@api_router.post("/geocode-batch")
async def geocode_batch(payload: dict):
    """Geocode multiple addresses sequentially (Nominatim 1 req/sec policy)"""
    addresses: List[str] = payload.get("addresses", [])
    results = []
    for addr in addresses:
        r = await geocode_nominatim(addr)
        results.append(r)
        await asyncio.sleep(1.0)  # respect Nominatim policy
    return {"results": results}


@api_router.post("/optimize", response_model=OptimizeResponse)
async def optimize_route(req: OptimizeRequest):
    """Nearest-neighbor TSP optimization"""
    pending = [s for s in req.stops if s.status == "pendente" and s.lat is not None and s.lon is not None]
    done = [s for s in req.stops if s.status != "pendente"]

    if len(pending) <= 1:
        return OptimizeResponse(stops=req.stops)

    # Start from provided origin or first stop
    if req.start_lat is not None and req.start_lon is not None:
        start = (req.start_lat, req.start_lon)
        optimized = []
        remaining = list(pending)
    else:
        optimized = [pending[0]]
        remaining = pending[1:]
        start = (pending[0].lat, pending[0].lon)

    while remaining:
        last_lat, last_lon = (optimized[-1].lat, optimized[-1].lon) if optimized else start
        nearest_idx = 0
        min_d = float("inf")
        for i, s in enumerate(remaining):
            d = ((last_lat - s.lat) ** 2 + (last_lon - s.lon) ** 2) ** 0.5
            if d < min_d:
                min_d = d
                nearest_idx = i
        optimized.append(remaining.pop(nearest_idx))

    final = done + optimized
    for idx, s in enumerate(final):
        s.id = idx

    return OptimizeResponse(stops=final)


@api_router.post("/pix/generate", response_model=PixResponse)
async def generate_pix(req: PixRequest):
    txid = f"RF{uuid.uuid4().hex[:18].upper()}"
    pix_string = generate_pix_brcode(
        pix_key=PIX_KEY_CNPJ,
        amount=SUBSCRIPTION_PRICE,
        merchant_name=MERCHANT_NAME,
        merchant_city=MERCHANT_CITY,
        txid=txid,
    )

    await db.pix_transactions.insert_one({
        "txid": txid,
        "user_id": req.user_id,
        "amount": SUBSCRIPTION_PRICE,
        "status": "pending_payment",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return PixResponse(
        pix_string=pix_string,
        txid=txid,
        amount=SUBSCRIPTION_PRICE,
        pix_key="48.223.054/0001-42",
        merchant_name=MERCHANT_NAME,
    )


@api_router.post("/pix/confirm")
async def confirm_payment(req: ConfirmPaymentRequest):
    """Manually mark payment as confirmed and activate subscription.
    NOTE: For MVP this auto-activates. In production an admin webhook/manual review
    would update this. This endpoint is intentionally permissive to demonstrate
    the activation flow."""
    tx = await db.pix_transactions.find_one({"txid": req.txid}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Transação não encontrada")

    expires_at = datetime.now(timezone.utc) + timedelta(days=SUBSCRIPTION_DAYS)

    await db.pix_transactions.update_one(
        {"txid": req.txid},
        {"$set": {
            "status": "confirmed",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }},
    )

    await db.subscriptions.update_one(
        {"user_id": req.user_id},
        {"$set": {
            "user_id": req.user_id,
            "active": True,
            "expires_at": expires_at.isoformat(),
            "last_txid": req.txid,
        }},
        upsert=True,
    )

    return {"active": True, "expires_at": expires_at.isoformat()}


@api_router.get("/subscription/{user_id}", response_model=SubscriptionStatus)
async def get_subscription(user_id: str):
    sub = await db.subscriptions.find_one({"user_id": user_id}, {"_id": 0})
    if not sub:
        return SubscriptionStatus(active=False, expires_at=None, days_remaining=0)

    expires_at_str = sub.get("expires_at")
    if not expires_at_str:
        return SubscriptionStatus(active=False)

    expires_at = datetime.fromisoformat(expires_at_str)
    now = datetime.now(timezone.utc)
    if expires_at < now:
        return SubscriptionStatus(active=False, expires_at=expires_at_str, days_remaining=0)

    days = (expires_at - now).days
    return SubscriptionStatus(active=True, expires_at=expires_at_str, days_remaining=days)


app.include_router(api_router)

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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
