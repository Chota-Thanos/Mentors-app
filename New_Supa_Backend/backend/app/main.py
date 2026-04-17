from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from .config import get_settings
from .routers import ai_quiz, ai_mains, ai_articles, payments, pdfs, live, analytics, compat, profiles

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)
_settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Mentors-App API (environment=%s)", _settings.environment)
    yield
    logger.info("Shutting down Mentors-App API")


app = FastAPI(
    title="Mentors-App API v2",
    description="UPSC Platform backend — AI generation, payments, live rooms, analytics",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _settings.environment != "production" else None,
    redoc_url="/redoc" if _settings.environment != "production" else None,
)

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.frontend_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(ai_quiz.router)
app.include_router(ai_mains.router)
app.include_router(ai_articles.router)
app.include_router(payments.router)
app.include_router(pdfs.router)
app.include_router(live.router)
app.include_router(analytics.router)
app.include_router(compat.router)
app.include_router(profiles.router)


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def root():
    return {
        "service": "Mentors-App API",
        "version": "2.0.0",
        "status": "ok",
        "environment": _settings.environment,
    }


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}
