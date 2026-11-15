import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.main import create_app


def test_public_config_returns_brand_values_without_credentials() -> None:
    settings = Settings(
        brand_portal_name="Example Logs",
        brand_tagline="A public tagline",
        brand_logo_url="/assets/logo.svg",
        brand_primary_color="#123456",
        brand_accent_color="#abcdef",
        wcl_client_id="private-client-id",
        wcl_client_secret="private-client-secret",
        database_url="sqlite://",
    )

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/config")

    assert response.status_code == 200
    assert response.json() == {"brand": {
        "portal_name": "Example Logs",
        "tagline": "A public tagline",
        "logo_url": "/assets/logo.svg",
        "primary_color": "#123456",
        "accent_color": "#abcdef",
    }}
    assert "private-client" not in response.text


@pytest.mark.parametrize("field", ["brand_primary_color", "brand_accent_color"])
def test_brand_colors_reject_non_hex_css_values(field: str) -> None:
    with pytest.raises(ValidationError):
        Settings(**{field: "red; background-image:url(https://example.invalid)"})


@pytest.mark.parametrize("logo_url", ["javascript:alert(1)", "//tracker.example/logo.svg", "http://example.com/logo.svg"])
def test_brand_logo_rejects_unsafe_urls(logo_url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(brand_logo_url=logo_url)
