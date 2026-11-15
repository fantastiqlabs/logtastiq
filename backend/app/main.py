from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.reports import router as reports_router
from app.core.config import Settings, get_settings
from app.core.database import Base, create_database
from app.models.cache_entry import CacheEntry  # noqa: F401 - register table metadata.
from app.services.report_service import ReportService
from app.services.sqlite_cache import SQLiteCache
from app.services.wcl_client import WCLClient


def create_app(
    settings: Settings | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    app_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        engine, sessions = create_database(app_settings.database_url)
        Base.metadata.create_all(engine)
        transport = http_transport
        http = httpx.AsyncClient(timeout=30.0, transport=transport)
        client = WCLClient(app_settings, http=http)
        cache = SQLiteCache(sessions, app_settings.cache_ttl_seconds)
        application.state.report_service = ReportService(client, cache)
        application.state.database_engine = engine
        try:
            yield
        finally:
            await http.aclose()
            engine.dispose()

    application = FastAPI(title=app_settings.app_name, version="0.2.0", lifespan=lifespan)
    application.state.settings = app_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[app_settings.frontend_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    application.include_router(health_router, prefix="/api")
    application.include_router(reports_router, prefix="/api")
    return application


app = create_app()
