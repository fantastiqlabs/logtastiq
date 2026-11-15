from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "logtastiq-api"}


@router.get("/config")
async def public_config(request: Request) -> dict[str, dict[str, str]]:
    settings = request.app.state.settings
    return {"brand": {
        "portal_name": settings.brand_portal_name,
        "tagline": settings.brand_tagline,
        "logo_url": settings.brand_logo_url,
        "primary_color": settings.brand_primary_color,
        "accent_color": settings.brand_accent_color,
    }}
