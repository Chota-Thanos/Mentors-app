"""
Payments Router (Razorpay)
POST /payments/create-order   — create a Razorpay order
POST /payments/verify         — verify payment signature and grant access
POST /payments/webhook        — Razorpay webhook (background verification)
GET  /payments/history        — list user's payment history
"""

import hashlib
import hmac
import logging
from datetime import datetime, timezone

import razorpay
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import ProfileRow, require_auth
from ..config import get_settings
from ..db import get_admin_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/payments", tags=["Payments"])
_settings = get_settings()

SPLIT_CREATOR_RATIO = 0.80   # 80% to creator
SPLIT_PLATFORM_RATIO = 0.20  # 20% to platform


def _razorpay_client() -> razorpay.Client:
    return razorpay.Client(
        auth=(_settings.razorpay_key_id, _settings.razorpay_key_secret)
    )


# ── Schemas ────────────────────────────────────────────────────────────────────

class CreateOrderRequest(BaseModel):
    item_type: str              # 'test_series' | 'premium_collection' | 'subscription_plan'
    item_id: int | str          # series/collection ID or plan name


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    payment_record_id: int      # ID in our payments table


# ── Helpers ────────────────────────────────────────────────────────────────────

def _verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    secret = _settings.razorpay_key_secret.encode("utf-8")
    message = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _grant_access(user_id: int, payment_id: int, item_type: str, item_id: int):
    """Write a user_content_access row after successful payment."""
    admin = get_admin_client()
    row = {
        "user_id": user_id,
        "access_type": item_type,
        "payment_id": payment_id,
        "is_active": True,
    }
    if item_type == "test_series":
        row["test_series_id"] = item_id
    elif item_type == "collection":
        row["collection_id"] = item_id
    admin.table("user_content_access").insert(row).execute()


def _create_revenue_split(payment_id: int, creator_id: int, gross_amount: float):
    """Create a revenue_split record for the creator (manual payout later)."""
    admin = get_admin_client()
    creator_amount = round(gross_amount * SPLIT_CREATOR_RATIO, 2)
    platform_amount = round(gross_amount * SPLIT_PLATFORM_RATIO, 2)
    admin.table("revenue_splits").insert({
        "payment_id": payment_id,
        "creator_user_id": creator_id,
        "creator_amount": creator_amount,
        "platform_amount": platform_amount,
        "status": "pending",
    }).execute()


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/create-order")
async def create_order(
    body: CreateOrderRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Create a Razorpay order and a pending payment record."""
    admin = get_admin_client()

    # Fetch price
    price_paise = 0
    creator_id = None

    if body.item_type == "test_series":
        resp = admin.table("test_series").select("price,creator_id,name").eq("id", int(body.item_id)).single().execute()
        if not resp.data:
            raise HTTPException(404, "Test series not found")
        price_paise = int((resp.data.get("price") or 0) * 100)
        creator_id = resp.data.get("creator_id")
        notes = f"Test Series: {resp.data['name']}"

    elif body.item_type == "premium_collection":
        resp = admin.table("premium_collections").select("price,creator_id,name").eq("id", int(body.item_id)).single().execute()
        if not resp.data:
            raise HTTPException(404, "Collection not found")
        price_paise = int((resp.data.get("price") or 0) * 100)
        creator_id = resp.data.get("creator_id")
        notes = f"Collection: {resp.data['name']}"

    elif body.item_type == "subscription_plan":
        resp = admin.table("subscription_plans").select("price_monthly,display_name").eq("name", str(body.item_id)).single().execute()
        if not resp.data:
            raise HTTPException(404, "Plan not found")
        price_paise = int((resp.data.get("price_monthly") or 0) * 100)
        notes = f"Subscription: {resp.data['display_name']}"

    else:
        raise HTTPException(400, "Invalid item_type")

    if price_paise <= 0:
        raise HTTPException(400, "Item is free or price not set")

    # Create Razorpay order
    rz = _razorpay_client()
    rz_order = rz.order.create({
        "amount": price_paise,
        "currency": "INR",
        "notes": {"item_type": body.item_type, "item_id": str(body.item_id), "user_id": str(profile.id)},
    })

    # Save pending payment record
    payment_row = {
        "user_id": profile.id,
        "amount": price_paise / 100,
        "currency": "INR",
        "status": "created",
        "gateway": "razorpay",
        "gateway_order_id": rz_order["id"],
        "notes": notes,
    }
    if body.item_type == "test_series":
        payment_row["test_series_id"] = int(body.item_id)
    elif body.item_type == "premium_collection":
        payment_row["collection_id"] = int(body.item_id)
    elif body.item_type == "subscription_plan":
        payment_row["subscription_plan"] = str(body.item_id)

    saved = admin.table("payments").insert(payment_row).execute()
    payment_id = saved.data[0]["id"]

    return {
        "order_id": rz_order["id"],
        "amount": price_paise,
        "currency": "INR",
        "payment_record_id": payment_id,
        "key_id": _settings.razorpay_key_id,
    }


@router.post("/verify")
async def verify_payment(
    body: VerifyPaymentRequest,
    profile: ProfileRow = Depends(require_auth),
):
    """Verify Razorpay signature and grant content access."""
    admin = get_admin_client()

    # Fetch payment record
    pay = admin.table("payments").select("*").eq("id", body.payment_record_id).eq("user_id", profile.id).single().execute()
    if not pay.data:
        raise HTTPException(404, "Payment record not found")

    payment = pay.data
    if payment["status"] == "paid":
        raise HTTPException(409, "Payment already verified")

    # Verify signature
    if not _verify_signature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature):
        admin.table("payments").update({"status": "failed"}).eq("id", body.payment_record_id).execute()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid payment signature")

    # Mark payment paid
    admin.table("payments").update({
        "status": "paid",
        "gateway_payment_id": body.razorpay_payment_id,
        "gateway_signature": body.razorpay_signature,
    }).eq("id", body.payment_record_id).execute()

    # Grant access
    if payment.get("test_series_id"):
        _grant_access(profile.id, body.payment_record_id, "test_series", payment["test_series_id"])
        # Create revenue split
        series = admin.table("test_series").select("creator_id").eq("id", payment["test_series_id"]).single().execute()
        if series.data:
            _create_revenue_split(body.payment_record_id, series.data["creator_id"], payment["amount"])

    elif payment.get("collection_id"):
        _grant_access(profile.id, body.payment_record_id, "collection", payment["collection_id"])
        coll = admin.table("premium_collections").select("creator_id").eq("id", payment["collection_id"]).single().execute()
        if coll.data:
            _create_revenue_split(body.payment_record_id, coll.data["creator_id"], payment["amount"])

    elif payment.get("subscription_plan"):
        # Activate subscription
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        plan_resp = admin.table("subscription_plans").select("id").eq("name", payment["subscription_plan"]).single().execute()
        plan_id = (plan_resp.data or {}).get("id")
        admin.table("subscriptions").insert({
            "user_id": profile.id,
            "plan_id": plan_id,
            "plan": payment["subscription_plan"],
            "start_date": now.isoformat(),
            "end_date": (now + timedelta(days=30)).isoformat(),
            "status": "active",
            "last_razorpay_payment_id": body.razorpay_payment_id,
        }).execute()

    return {"message": "Payment verified and access granted", "payment_id": body.payment_record_id}


@router.post("/webhook")
async def razorpay_webhook(request: Request):
    """Handle Razorpay event webhooks (idempotent)."""
    body_bytes = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    # Verify webhook signature
    secret = _settings.razorpay_webhook_secret.encode("utf-8")
    expected = hmac.new(secret, body_bytes, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid webhook signature")

    import json
    event = json.loads(body_bytes)
    event_type = event.get("event")
    logger.info("Razorpay webhook: %s", event_type)

    if event_type == "payment.captured":
        order_id = event.get("payload", {}).get("payment", {}).get("entity", {}).get("order_id")
        if order_id:
            admin = get_admin_client()
            admin.table("payments").update({"status": "paid"}).eq("gateway_order_id", order_id).eq("status", "created").execute()

    elif event_type == "refund.created":
        payment_id = event.get("payload", {}).get("refund", {}).get("entity", {}).get("payment_id")
        if payment_id:
            admin = get_admin_client()
            admin.table("payments").update({"status": "refunded"}).eq("gateway_payment_id", payment_id).execute()

    return {"status": "ok"}


@router.get("/history")
async def payment_history(profile: ProfileRow = Depends(require_auth)):
    """Get current user's payment history."""
    admin = get_admin_client()
    resp = (
        admin.table("payments")
        .select("id,amount,currency,status,gateway,created_at,test_series_id,collection_id,subscription_plan")
        .eq("user_id", profile.id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"payments": resp.data or []}
