"""Firstrade API microservice — bridges the Python `firstrade` package for Next.js."""

import os
import re
import uuid
import time
import json
import secrets
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load .env from the service directory (python-dotenv not required)
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

app = FastAPI(title="Firstrade Sync Service", docs_url=None, redoc_url=None)

# ── API Key auth ─────────────────────────────────────────────────────────────
API_KEY = os.environ.get("FIRSTRADE_SERVICE_API_KEY", secrets.token_urlsafe(32))

# Print the auto-generated key on startup so the Next.js app can use it
if not os.environ.get("FIRSTRADE_SERVICE_API_KEY"):
    print(f"[Firstrade Service] Auto-generated API key: {API_KEY}")
    print("[Firstrade Service] Set FIRSTRADE_SERVICE_API_KEY env var to use a fixed key.")


async def verify_api_key(request: Request):
    key = request.headers.get("x-api-key")
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


# Allow CORS from local dev + any configured Vercel domain
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_ALLOWED_ORIGIN, "http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "x-api-key"],
)

# ── Rate Limiter ─────────────────────────────────────────────────────────────

_rate_limits: dict[str, list[float]] = {}  # endpoint → [timestamp, ...]

RATE_LIMIT_CONFIG = {
    "/login": {"max_requests": 5, "window_seconds": 60},
    "/otp": {"max_requests": 5, "window_seconds": 60},
    "/accounts": {"max_requests": 10, "window_seconds": 60},
    "/transactions": {"max_requests": 3, "window_seconds": 60},
}


def check_rate_limit(endpoint: str):
    config = RATE_LIMIT_CONFIG.get(endpoint)
    if not config:
        return
    now = time.time()
    window = config["window_seconds"]
    max_req = config["max_requests"]

    timestamps = _rate_limits.get(endpoint, [])
    # Prune old timestamps
    timestamps = [t for t in timestamps if now - t < window]
    if len(timestamps) >= max_req:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {max_req} requests per {window}s for {endpoint}."
        )
    timestamps.append(now)
    _rate_limits[endpoint] = timestamps


# ── Session Store ────────────────────────────────────────────────────────────

_sessions: dict[str, dict] = {}  # session_id → {"session": FTSession, "last_active": float}
SESSION_TTL = 30 * 60  # 30 minutes


def _cleanup_sessions():
    now = time.time()
    expired = [k for k, v in _sessions.items() if now - v["last_active"] > SESSION_TTL]
    for k in expired:
        del _sessions[k]


def _get_session(session_id: str):
    _cleanup_sessions()
    entry = _sessions.get(session_id)
    if not entry:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please login again.")
    entry["last_active"] = time.time()
    return entry["session"]


def _clear_credentials(session):
    """Clear sensitive credentials from session object after they are no longer needed."""
    try:
        session.username = ""
        session.password = ""
        session.pin = ""
        session.email = ""
        session.phone = ""
    except Exception:
        pass


# ── Request/Response Models ──────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    pin: str = ""
    email: str = ""
    phone: str = ""


class OTPRequest(BaseModel):
    session_id: str
    otp_code: str


class TransactionsRequest(BaseModel):
    session_id: str
    days: int = 90

    def model_post_init(self, __context):
        if self.days < 1 or self.days > 3650:
            raise ValueError("days must be between 1 and 3650")


class AccountsRequest(BaseModel):
    session_id: str


class SessionImportRequest(BaseModel):
    cookies: str   # JSON-serialised cookie dict
    headers: str   # JSON-serialised essential headers dict


# ── Option Detection ─────────────────────────────────────────────────────────

_OPTION_PATTERN = re.compile(
    r"(?P<sym>[A-Z]+)\s+(?P<exp>\d{2}/\d{2}/\d{4})\s+(?P<strike>[\d.]+)\s+(?P<type>[CP])"
)


def _safe_float(val) -> float:
    if val is None:
        return 0.0
    try:
        return float(str(val).replace("$", "").replace(",", "").strip())
    except Exception:
        return 0.0


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/login", dependencies=[Depends(verify_api_key)])
async def login(req: LoginRequest):
    """Login to Firstrade. Returns session_id or indicates OTP is required."""
    check_rate_limit("/login")
    try:
        from firstrade.account import FTSession
    except ImportError:
        raise HTTPException(status_code=500, detail="firstrade package not installed")

    try:
        session = FTSession(
            username=req.username,
            password=req.password,
            pin=req.pin or "",
            email=req.email or "",
            phone=req.phone or "",
        )
        # Step 1: just do the HTTP login, don't call session.login() which also does MFA
        session.session.headers.update(__import__('firstrade.urls', fromlist=['session_headers']).session_headers())
        ftat = session._load_cookies()
        if ftat:
            session.session.headers["ftat"] = ftat
        session._request("get", url="https://api3x.firstrade.com/", timeout=10)
        session.session.headers["access-token"] = __import__('firstrade.urls', fromlist=['access_token']).access_token()

        resp = session._request("post", url=__import__('firstrade.urls', fromlist=['login']).login(),
                                data={"username": session.username, "password": session.password})
        session.login_json = resp.json()

        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail=f"Firstrade returned HTTP {resp.status_code}")

        if session.login_json.get("error"):
            raise HTTPException(status_code=401, detail="Login failed. Please check your credentials.")

        # If no MFA needed at all
        if "mfa" not in session.login_json and "ftat" in session.login_json and not session.login_json["error"]:
            session.session.headers["sid"] = session.login_json["sid"]
            _clear_credentials(session)
            session_id = str(uuid.uuid4())
            _sessions[session_id] = {"session": session, "last_active": time.time(), "needs_otp": False}
            return {"success": True, "session_id": session_id, "requires_otp": False}

        # MFA required — store session and return OTP options info
        session.t_token = session.login_json.get("t_token")
        otp_options = session.login_json.get("otp", [])
        mfa = session.login_json.get("mfa")
        if not mfa:
            session.otp_options = otp_options

        # Auto-request OTP code via SMS (first sms option) or email
        otp_sent = False
        sent_channel = None
        if otp_options and not mfa:
            # Pick SMS first, fallback to email
            chosen = None
            for opt in otp_options:
                if opt.get("channel") == "sms":
                    chosen = opt
                    break
            if not chosen:
                chosen = otp_options[0]

            try:
                from firstrade import urls as ft_urls
                code_resp = session._request("post", ft_urls.request_code(), data={
                    "recipientId": chosen["recipientId"],
                    "t_token": session.t_token,
                })
                code_json = code_resp.json()
                # Update login_json and set verificationSid for login_two()
                session.login_json = code_json
                if "verificationSid" in code_json:
                    session.session.headers["sid"] = code_json["verificationSid"]
                otp_sent = True
                sent_channel = chosen["channel"]
            except Exception as e:
                print(f"[Firstrade Login] Failed to request OTP: {type(e).__name__}")

        # Clear credentials from memory — they are no longer needed after login request
        _clear_credentials(session)

        session_id = str(uuid.uuid4())
        _sessions[session_id] = {"session": session, "last_active": time.time(), "needs_otp": True}

        return {
            "success": True,
            "session_id": session_id,
            "requires_otp": True,
            "mfa_type": "totp" if mfa else "otp",
            "otp_sent": otp_sent,
            "otp_channel": sent_channel,
            "otp_channels": [{"channel": o.get("channel"), "mask": o.get("recipientMask")} for o in otp_options] if otp_options else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Firstrade Login] Error: {type(e).__name__}")
        raise HTTPException(status_code=401, detail="Login failed. Please check your credentials.")


@app.post("/otp", dependencies=[Depends(verify_api_key)])
async def submit_otp(req: OTPRequest):
    """Submit OTP code to complete MFA."""
    check_rate_limit("/otp")
    _cleanup_sessions()
    entry = _sessions.get(req.session_id)
    if not entry:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")

    session = entry.get("session")
    if session is None:
        raise HTTPException(status_code=401, detail="Session invalid. Please login again.")

    if not entry.get("needs_otp"):
        return {"success": True, "message": "Already authenticated, no OTP needed"}

    try:
        session.login_two(req.otp_code)
        entry["needs_otp"] = False
        entry["last_active"] = time.time()
        return {"success": True, "message": "MFA completed"}
    except Exception as e:
        print(f"[Firstrade OTP] Error: {type(e).__name__}")
        raise HTTPException(status_code=401, detail="MFA verification failed. Check your OTP code.")


@app.post("/accounts", dependencies=[Depends(verify_api_key)])
async def get_accounts(req: AccountsRequest):
    """Get list of account numbers for the session."""
    check_rate_limit("/accounts")
    session = _get_session(req.session_id)

    try:
        from firstrade.account import FTAccountData
        data = FTAccountData(session)
        accounts = list(data.account_numbers)
        return {"success": True, "accounts": accounts}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not retrieve accounts")


@app.post("/transactions", dependencies=[Depends(verify_api_key)])
async def get_transactions(req: TransactionsRequest):
    """Fetch transaction history with FIFO matching, returns matched trades."""
    check_rate_limit("/transactions")
    session = _get_session(req.session_id)

    try:
        from firstrade.account import FTAccountData
    except ImportError:
        raise HTTPException(status_code=500, detail="firstrade package not installed")

    data = FTAccountData(session)
    end_date = datetime.today()
    start_date = end_date - timedelta(days=req.days)

    all_orders: list[dict] = []
    account_numbers = list(data.account_numbers)

    for acct_id in account_numbers:
        orders = _get_order_history(data, acct_id, start_date, end_date)
        print(f"[Firstrade Tx] Account {acct_id}: {len(orders)} raw orders")
        all_orders.extend(orders)

    if not all_orders:
        return {"success": True, "trades": [], "cashflows": [], "accounts": account_numbers}

    trades, cashflows = _normalize_orders(all_orders)
    print(f"[Firstrade Tx] Result: {len(trades)} trades + {len(cashflows)} cashflows from {len(all_orders)} orders")
    return {"success": True, "trades": trades, "cashflows": cashflows, "accounts": account_numbers}


def _get_order_history(data, acct_id: str, start: datetime, end: datetime) -> list:
    """Fetch account history with pagination using the firstrade package."""
    all_items = []
    custom_range = [start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")]

    try:
        result = data.get_account_history(
            account=acct_id,
            date_range="cust",
            custom_range=custom_range,
        )

        if not isinstance(result, dict):
            return list(result) if isinstance(result, list) else []

        items = result.get("items", [])
        total = int(result.get("total", len(items)))
        per_page = int(result.get("per_page", len(items))) or len(items)

        all_items.extend(items)

        # Fetch remaining pages if needed
        if total > per_page:
            from firstrade import urls as ft_urls
            total_pages = (total + per_page - 1) // per_page
            for page in range(2, total_pages + 1):
                try:
                    page_url = ft_urls.account_history(acct_id, "cust", custom_range)
                    # Append page param
                    sep = "&" if "?" in page_url else "?"
                    page_url = f"{page_url}{sep}page={page}"
                    resp = data.session._request("get", page_url)
                    page_result = resp.json()
                    page_items = page_result.get("items", [])
                    all_items.extend(page_items)
                except Exception:
                    break

        return all_items
    except Exception as e:
        print(f"[Firstrade] Error fetching history for {acct_id}: {type(e).__name__}")
        return []


def _normalize_orders(orders: list) -> tuple[list[dict], list[dict]]:
    """Parse Firstrade account history into trades (avg cost) and cashflows.

    Uses weighted average cost method:
    - BUY: updates average cost for the symbol
    - SELL: P&L = (sell_price - avg_cost) * qty - commissions
    """
    # Sort by date ascending
    def _order_date(o):
        d = o.get("report_date", o.get("date", "")) if isinstance(o, dict) else ""
        return str(d)
    orders = sorted(orders, key=_order_date)

    trades = []
    cashflows = []
    # positions[symbol] = {"qty": total_shares, "total_cost": total_cost_basis}
    positions: dict[str, dict] = {}

    for o in orders:
        if not isinstance(o, dict):
            try:
                o = vars(o)
            except Exception:
                continue

        o = {k.lower().replace(" ", "_"): v for k, v in o.items()}

        action = str(
            o.get("trans_str", o.get("action", o.get("transaction_type", "")))
        ).strip().upper()
        sym = str(o.get("symbol", "")).strip().upper()
        qty = abs(_safe_float(o.get("quantity", o.get("qty", 0))))
        price = _safe_float(
            o.get("trade_price", o.get("price", o.get("fill_price", 0)))
        )
        amount = _safe_float(o.get("amount", 0))
        comm = abs(_safe_float(o.get("commission", o.get("fees", 0))))
        desc = str(o.get("description", ""))

        # Parse date — output as YYYY-MM-DD
        raw_date = str(
            o.get("report_date", o.get("date", o.get("trade_date", "")))
        ).strip()
        try:
            parsed_date = datetime.strptime(raw_date, "%m/%d/%Y")
            trade_date = parsed_date.strftime("%Y-%m-%d")
        except Exception:
            try:
                parsed_date = datetime.fromisoformat(raw_date) if "T" in raw_date else datetime.strptime(raw_date, "%Y-%m-%d")
                trade_date = parsed_date.strftime("%Y-%m-%d")
            except Exception:
                continue

        is_buy = any(x in action for x in ("BUY", "BOUGHT", "OPEN"))
        is_sell = any(x in action for x in ("SELL", "SOLD", "CLOSE"))

        # ── BUY: update weighted average cost ────────────────────────
        if is_buy and sym and qty > 0 and price > 0:
            pos = positions.setdefault(sym, {"qty": 0.0, "total_cost": 0.0})
            pos["qty"] += qty
            pos["total_cost"] += price * qty + comm  # cost includes commission
            continue

        # ── SELL: compute P&L using average cost ─────────────────────
        if is_sell and sym and qty > 0 and price > 0:
            pos = positions.get(sym)
            avg_cost = pos["total_cost"] / pos["qty"] if pos and pos["qty"] > 0 else price
            sell_qty = min(qty, pos["qty"]) if pos else qty

            if sell_qty <= 0:
                continue

            pnl = (price - avg_cost) * sell_qty - comm
            pnl_pct = (price - avg_cost) / avg_cost * 100 if avg_cost else 0

            asset_type = "Option" if (_OPTION_PATTERN.search(sym) or _OPTION_PATTERN.search(desc) or len(sym) > 5) else "Stock"

            trades.append({
                "symbol": sym,
                "assetType": asset_type,
                "side": "long",
                "quantity": int(sell_qty),
                "entryPrice": round(avg_cost, 4),
                "closePrice": round(price, 4),
                "entryDate": trade_date,  # same date (avg cost, no specific entry date)
                "closeDate": trade_date,
                "pnl": round(pnl, 2),
                "pnlPct": round(pnl_pct, 2),
                "commission": round(comm, 4),
                "status": "closed",
            })

            # Reduce position
            if pos:
                cost_removed = avg_cost * sell_qty
                pos["qty"] -= sell_qty
                pos["total_cost"] -= cost_removed
                if pos["qty"] <= 0.01:  # floating point cleanup
                    pos["qty"] = 0.0
                    pos["total_cost"] = 0.0
            continue

        # ── Non-trade cashflows ──────────────────────────────────────
        cf_type = None
        cf_amount = amount

        if "DIVIDEND" in action or "DIV" in action:
            cf_type = "dividend"
        elif "INTEREST" in action:
            cf_type = "interest"
        elif "DEPOSIT" in action or ("ACH" in action and cf_amount > 0):
            cf_type = "deposit"
        elif "WITHDRAW" in action or "DISBURSEMENT" in action or ("ACH" in action and cf_amount < 0):
            cf_type = "withdrawal"
        elif "FEE" in action or "CHARGE" in action or ("OTHER" in action and "FEE" in desc.upper()):
            cf_type = "fee"
        elif "TRANSFER" in action:
            cf_type = "transfer"
        elif "JOURNAL" in action:
            cf_type = "journal"

        if cf_type:
            cashflows.append({
                "type": cf_type,
                "date": trade_date,
                "amount": round(cf_amount, 2),
                "symbol": sym or "",
                "description": desc,
                "commission": round(comm, 4),
            })

    # Deduplicate cashflows: Firstrade sometimes reports the same event twice
    seen_cf: set[tuple] = set()
    deduped_cashflows = []
    for cf in cashflows:
        key = (cf["date"], abs(cf["amount"]))
        if key not in seen_cf:
            seen_cf.add(key)
            deduped_cashflows.append(cf)
    cashflows = deduped_cashflows

    return trades, cashflows


@app.post("/balances", dependencies=[Depends(verify_api_key)])
async def get_balances(req: AccountsRequest):
    """Get account balances (equity, cash, positions value)."""
    check_rate_limit("/accounts")
    session = _get_session(req.session_id)

    try:
        from firstrade.account import FTAccountData
        data = FTAccountData(session)
        accounts = list(data.account_numbers)
        result = {}

        for acct_id in accounts:
            try:
                overview = data.get_balance_overview(acct_id)
                result[acct_id] = overview
            except Exception:
                result[acct_id] = {}

        return {"success": True, "balances": result, "accounts": accounts}
    except Exception as e:
        raise HTTPException(status_code=500, detail="Could not retrieve balances")


@app.post("/session-export", dependencies=[Depends(verify_api_key)])
async def export_session(req: AccountsRequest):
    """Serialise live session cookies + essential auth headers for persistent storage.

    The caller should store the returned JSON string in the database and pass it
    back to /session-import on the next run to avoid re-logging in every time.
    """
    session = _get_session(req.session_id)
    cookies = dict(session.session.cookies)
    # Only persist the auth-specific headers Firstrade needs
    keep = {"ftat", "sid", "access-token"}
    essential_headers = {k: v for k, v in session.session.headers.items() if k.lower() in keep}
    return {
        "success": True,
        "cookies": json.dumps(cookies),
        "headers": json.dumps(essential_headers),
    }


@app.post("/session-import", dependencies=[Depends(verify_api_key)])
async def import_session(req: SessionImportRequest):
    """Restore a Firstrade session from previously exported cookies/headers.

    Returns a new in-memory session_id on success, or {"success": false} if the
    stored cookies have expired (caller should prompt the user to re-login).
    """
    try:
        from firstrade.account import FTSession, FTAccountData
        # Build a bare session without triggering a real login
        session = FTSession(username="", password="", pin="")
        session.session.cookies.update(json.loads(req.cookies))
        session.session.headers.update(json.loads(req.headers))

        # Quick validity check — just list account numbers
        data = FTAccountData(session)
        _ = list(data.account_numbers)

        session_id = str(uuid.uuid4())
        _sessions[session_id] = {"session": session, "last_active": time.time(), "needs_otp": False}
        return {"success": True, "session_id": session_id}
    except Exception as e:
        print(f"[Firstrade SessionImport] Cookies expired: {type(e).__name__}")
        return {"success": False, "error": "Session expired. Please login again."}


@app.post("/positions", dependencies=[Depends(verify_api_key)])
async def get_positions(req: AccountsRequest):
    """Return current open positions (symbol, quantity) and cash per account.

    Used by the market-close cron job to calculate NAV using official close prices
    rather than Firstrade's live balance (which reflects after-hours quotes).
    """
    session = _get_session(req.session_id)

    try:
        from firstrade.account import FTAccountData
        data = FTAccountData(session)
        accounts = list(data.account_numbers)
        result: dict[str, dict] = {}

        for acct_id in accounts:
            positions: list[dict] = []
            cash = 0.0

            # ── Positions ────────────────────────────────────────────────────
            try:
                raw = data.get_positions(acct_id)
                items = raw if isinstance(raw, list) else (raw.get("items", []) if isinstance(raw, dict) else [])
                for pos in items:
                    if not isinstance(pos, dict):
                        try:
                            pos = vars(pos)
                        except Exception:
                            continue
                    pos = {k.lower().replace(" ", "_"): v for k, v in pos.items()}
                    sym = str(pos.get("symbol", pos.get("sym", ""))).strip().upper()
                    qty = _safe_float(pos.get("quantity", pos.get("qty", 0)))
                    mkt = _safe_float(pos.get("market_value", pos.get("mkt_value", pos.get("mkt_val", 0))))
                    cost = _safe_float(pos.get("cost_basis", pos.get("cost", 0)))
                    if sym and qty > 0:
                        positions.append({"symbol": sym, "quantity": qty, "market_value": mkt, "cost_basis": cost})
            except Exception as e:
                print(f"[Firstrade Positions] get_positions failed for {acct_id}: {type(e).__name__}")

            # ── Cash from balance overview ────────────────────────────────────
            try:
                overview = data.get_balance_overview(acct_id)
                if isinstance(overview, dict):
                    for k, v in overview.items():
                        kl = k.lower()
                        num = _safe_float(v)
                        if "cash" in kl and "avail" not in kl:
                            cash = max(cash, num)
            except Exception:
                pass

            result[acct_id] = {"positions": positions, "cash": cash}

        return {"success": True, "accounts": result}
    except Exception as e:
        print(f"[Firstrade Positions] Error: {type(e).__name__}")
        raise HTTPException(status_code=500, detail="Could not retrieve positions")


@app.get("/health")
async def health():
    return {"status": "ok"}
