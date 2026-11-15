from functools import lru_cache
import re
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Logtastiq"
    brand_portal_name: str = "Logtastiq"
    brand_tagline: str = "Turn Warcraft Logs into clear next steps."
    brand_logo_url: str = ""
    brand_primary_color: str = "#f2c14e"
    brand_accent_color: str = "#e7a7c3"
    wcl_client_id: str = ""
    wcl_client_secret: str = ""
    wcl_token_url: str = "https://www.warcraftlogs.com/oauth/token"
    wcl_graphql_url: str = "https://fresh.warcraftlogs.com/api/v2/client"
    # Keep this cache filename during the brand change to avoid an empty-cache reset.
    database_url: str = "sqlite:///./data/hellotherelogs.sqlite3"
    cache_ttl_seconds: int = 900
    frontend_origin: str = "http://localhost:8080"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("brand_primary_color", "brand_accent_color")
    @classmethod
    def validate_brand_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
            raise ValueError("Brand colors must be six-digit hexadecimal colors")
        return value

    @field_validator("brand_logo_url")
    @classmethod
    def validate_brand_logo_url(cls, value: str) -> str:
        if not value:
            return value
        parsed = urlparse(value)
        if value.startswith("/") and not value.startswith("//"):
            return value
        if parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password:
            return value
        raise ValueError("Brand logo must be a same-origin path or an HTTPS URL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
