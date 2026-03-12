from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import premium, premium_compat, test_series

app = FastAPI(title="Unified UPSC API (Supabase Native)", version="2.0.0")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(premium.router)
app.include_router(premium.compat_router)
app.include_router(premium_compat.router)
app.include_router(test_series.router)

@app.get("/")
def read_root():
    return {"message": "Welcome to the Unified UPSC API (Supabase Native)"}
