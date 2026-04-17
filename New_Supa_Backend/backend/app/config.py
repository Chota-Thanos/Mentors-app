from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str

    # AI
    gemini_api_key: str = ""
    openai_api_key: str = ""
    ai_default_provider: str = "gemini"
    ai_default_model: str = "models/gemini-2.0-flash"

    # Razorpay
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    # Agora
    agora_app_id: str = ""
    agora_app_certificate: str = ""

    # Email
    resend_api_key: str = ""
    email_from: str = "noreply@mentorsapp.in"

    # App
    frontend_url: str = "http://localhost:3000"
    environment: str = "development"
    secret_key: str = "change-me-in-production"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
