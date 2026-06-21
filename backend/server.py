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
from pypdf import PdfReader
from passlib.context import CryptContext
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Constants
PIX_KEY_CNPJ = "48223054000142"
MERCHANT_NAME = "ROTA FACIL"
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
CODE_PATTERNS = [
    r"BR\d{11,15}",
    r"[A-Z]{2}\d{9}[A-Z]{2}",
    r"MLB\d{10,14}",
    r"ML-\d{6,12}",
    r"\d{14,18}",
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
def extract_codes_and_addresses(text: str) -> List[dict]:
    lines = text.split("\n")
    stops = []
    seen_codes = set()
    counter = 0
    for line in lines:
        line = line.strip()
        if len(line) < 5:
            continue
        codigo = None
        for pattern in CODE_PATTERNS:
            m = re.search(pattern, line, re.IGNORECASE)
            if m:
                candidate = m.group(0).upper()
                if pattern == r"\d{14,18}" and (candidate.startswith("0000") or len(candidate) < 14):
                    continue
                codigo = candidate
                break
        if not codigo or codigo in seen_codes:
            continue
        endereco = re.sub(re.escape(codigo), "", line, flags=re.IGNORECASE)
        endereco = re.sub(r"[;\t\|]+", " ", endereco).strip(" ,;-\t")
        if len(endereco) < 5:
            endereco = "Endereço não detectado"
        seen_codes.add(codigo)
        stops.append({
            "id": counter, "codigo": codigo, "endereco": endereco,
            "status": "pendente", "timestamp": None, "lat": None, "lon": None,
        })
        counter += 1
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


async def geocode_nominatim(address: str) -> dict:
    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {"q": address + ", Brasil", "format": "json", "limit": 1, "countrycodes": "br"}
        headers = {"User-Agent": "RotaFacil/1.0 (delivery-app)"}
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: requests.get(url, params=params, headers=headers, timeout=8)
        )
        data = resp.json()
        if data and len(data) > 0:
            return {
                "lat": float(data[0]["lat"]), "lon": float(data[0]["lon"]),
                "display_name": data[0].get("display_name", ""), "found": True,
            }
    except Exception as e:
        logging.error(f"Geocode error for '{address}': {e}")
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
    return {"app": "Rota Fácil API", "version": "2.0.0"}


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
    stops = [Stop(**s) for s in raw_stops]
    return ParsedFileResponse(stops=stops, total=len(stops))


@api_router.post("/parse-text", response_model=ParsedFileResponse)
async def parse_text(payload: dict):
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
    addresses: List[str] = payload.get("addresses", [])
    results = []
    for addr in addresses:
        r = await geocode_nominatim(addr)
        results.append(r)
        await asyncio.sleep(1.0)
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
        optimized: List[Stop] = []
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
            d = haversine_km(last_lat, last_lon, s.lat, s.lon)
            if d < min_d:
                min_d = d
                nearest_idx = i
        optimized.append(remaining.pop(nearest_idx))

    # Compute metrics
    total_km = 0.0
    prev = start
    for s in optimized:
        total_km += haversine_km(prev[0], prev[1], s.lat, s.lon)
        prev = (s.lat, s.lon)
    if req.return_to_start:
        total_km += haversine_km(prev[0], prev[1], start[0], start[1])

    # Real-world factor (~1.3 for urban driving vs straight line)
    total_km *= 1.3
    driving_min = (total_km / max(req.avg_speed_kmh, 1.0)) * 60.0
    stops_min = len(optimized) * req.minutes_per_stop
    total_min = driving_min + stops_min

    final = done + optimized
    for idx, s in enumerate(final):
        s.id = idx

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
        f"Olá! Acabei de pagar a assinatura do Rota Fácil 🚀%0A"
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

    all_routes = await db.route_history.find(
        {"user_id": user_id}, {"_id": 0}
    ).to_list(length=1000)

    week_routes = [r for r in all_routes if r.get("created_at", "") >= week_ago]
    month_routes = [r for r in all_routes if r.get("created_at", "") >= month_ago]

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

    # Best day (by delivered)
    best_day = None
    if all_routes:
        sorted_routes = sorted(all_routes, key=lambda r: r.get("delivered", 0), reverse=True)
        best = sorted_routes[0]
        best_day = {
            "date": best.get("created_at", "")[:10],
            "delivered": best.get("delivered", 0),
        }

    # Badge
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
        "all_time": aggregate(all_routes),
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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
